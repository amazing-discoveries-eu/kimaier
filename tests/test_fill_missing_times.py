import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout
from io import StringIO
from datetime import date, time
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import fill_missing_times as fill

ZONE = ZoneInfo('Europe/Berlin')
SETTINGS = {
    'api_url': 'https://kimai.example', 'api_token': 'test',
    'work_start': '2025-12-29', 'week_hours': 40,
    'work_days': ['Mo', 'Tu', 'We', 'Th', 'Fr'], 'project_id': 1, 'activity_id': 2,
}
END = date(2025, 12, 31)


def row(id=1, day='2025-12-29', begin='09:00:00', end='17:00:00', duration=28800):
    return {'id': id, 'begin': f'{day}T{begin}+0100', 'end': f'{day}T{end}+0100', 'duration': duration}


class FakeApi:
    def __init__(self, rows=(), rounded=False, changed=False):
        self.rows = list(rows)
        self.posts = []
        self.deletes = []
        self.rounded = rounded
        self.changed = changed

    def timesheets(self, start, end):
        return [r for r in self.rows if str(start) <= r['begin'][:10] <= str(end)] + ([row(99)] if self.changed else [])

    def request(self, method, path, payload=None):
        if method == 'DELETE':
            self.deletes.append(path)
            return None, {}
        assert method == 'POST'
        self.posts.append(payload)
        begin, finish = (fill.datetime.fromisoformat(payload[k]) for k in ('begin', 'end'))
        created = dict(payload, id=100 + len(self.posts), duration=int((finish - begin).total_seconds()) + int(self.rounded))
        created['begin'] += '+0100'
        created['end'] += '+0100'
        self.rows.append(created)
        return created, {}


class FillTests(unittest.TestCase):
    def test_delete_selects_only_marked_entries_within_inclusive_period(self):
        entries = [dict(row(1), description=fill.MARKER), row(2),
                   dict(row(3, day='2026-01-01'), description=fill.MARKER),
                   dict(row(4, day='2025-12-28'), description=fill.MARKER),
                   dict(row(5), description=fill.MARKER + ' edited')]
        self.assertEqual([r['id'] for r in fill.deletion_candidates(
            entries, date(2025, 12, 29), END, ZONE)], [1])

    def test_delete_rechecks_entry_before_removal(self):
        entry = dict(row(), description=fill.MARKER)
        calls = []
        class Api:
            def request(self, method, path):
                calls.append((method, path))
                return entry, {}
        fill.delete_entries(Api(), [entry])
        self.assertEqual(calls, [('GET', 'timesheets/1'), ('DELETE', 'timesheets/1')])

    def test_delete_stops_if_entry_was_edited(self):
        entry = dict(row(), description=fill.MARKER)
        calls = []
        class Api:
            def request(self, method, path):
                calls.append(method)
                return dict(entry, description='manual edit'), {}
        with self.assertRaises(fill.FillError):
            fill.delete_entries(Api(), [entry])
        self.assertEqual(calls, ['GET'])

    def test_api_fetches_every_page(self):
        api = object.__new__(fill.Api)
        calls = []
        def request(method, path, payload=None):
            calls.append(path)
            count = 500 if len(calls) == 1 else 1
            first = 0 if len(calls) == 1 else 500
            return [row(id=i) for i in range(first, first + count)], {'X-Total-Pages': '2'}
        api.request = request
        self.assertEqual(len(api.timesheets(date(2025, 1, 1), END)), 501)
        self.assertIn('page=2', calls[1])
        self.assertIn('size=500', calls[0])

    def test_cli_preview_never_posts(self):
        api = FakeApi()
        original = api.request
        api.request = lambda method, path, payload=None: (
            ({'id': 5, 'timezone': 'Europe/Berlin'}, {})
            if path == 'users/me' else original(method, path, payload)
        )
        class Clock(fill.datetime):
            @classmethod
            def now(cls, tz=None):
                return cls(2026, 11, 2, tzinfo=tz)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'settings.json'
            path.write_text(json.dumps({'user': SETTINGS}))
            with patch.object(fill, 'Api', return_value=api), patch.object(fill, 'datetime', Clock), patch.object(sys, 'argv', ['fill', '--settings', str(path), '--until', '2025-12-31']), redirect_stdout(StringIO()) as output:
                self.assertEqual(fill.main(), 0)
            self.assertIn('Preview only', output.getvalue())
            self.assertIn('fill: 24:00:00', output.getvalue())
        self.assertEqual(api.posts, [])

    def test_default_cutoff_is_previous_year_and_current_year_is_rejected(self):
        self.assertEqual(fill.period_end(None, date(2026, 11, 2)), END)
        with self.assertRaises(fill.FillError):
            fill.period_end(date(2026, 1, 1), date(2026, 11, 2))

    def test_settings_file_supports_tauri_user_object(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'kimaier.dat'
            path.write_text(json.dumps({'user': SETTINGS}))
            self.assertEqual(fill.load_settings(path), SETTINGS)

    def test_work_start_and_weekdays_are_respected(self):
        settings = dict(SETTINGS, work_start='2025-12-30', work_days=['Tu', 'Th'], week_hours=16)
        self.assertEqual(fill.targets(settings, END), {date(2025, 12, 30): 28800})

    def test_fractional_daily_seconds_do_not_accumulate_rounding_error(self):
        settings = dict(SETTINGS, work_start='2025-12-01', week_hours='0.001', work_days=['Mo', 'Tu', 'We'])
        targets = fill.targets(settings, date(2025, 12, 3))
        self.assertEqual(sum(targets.values()), 4)  # 3.6 seconds rounded once

    def test_fills_empty_days_to_exact_target(self):
        plan, target, worked = fill.build_plan(SETTINGS, [], END, ZONE)
        self.assertEqual(target, 24 * 3600)
        self.assertEqual(worked, 0)
        self.assertEqual(sum(p.seconds for p in plan), target)
        self.assertEqual(len(plan), 3)
        self.assertTrue(all(p.day.year == 2025 for p in plan))

    def test_weekends_are_never_filled_even_when_configured(self):
        settings = dict(SETTINGS, work_start='2025-12-27',
                        work_days=['Mo', 'Tu', 'We', 'Sa', 'Su'], week_hours=40)
        rows = [row(day='2025-12-29', begin='00:00:00', end='23:00:00', duration=82800),
                row(2, day='2025-12-30', end='18:00:00', duration=32400)]
        plan, target, worked = fill.build_plan(settings, rows, END, ZONE)
        self.assertEqual([p.day for p in plan], [date(2025, 12, 31)])
        self.assertTrue(all(p.day.weekday() < 5 for p in plan))
        self.assertEqual(worked + sum(p.seconds for p in plan), target)

    def test_existing_bookings_are_skipped_and_do_not_stop_planning(self):
        rows = [row(day='2025-12-30')]
        plan, target, worked = fill.build_plan(SETTINGS, rows, END, ZONE)
        self.assertEqual([p.day for p in plan], [date(2025, 12, 29), date(2025, 12, 31)])
        self.assertEqual(worked + sum(p.seconds for p in plan), target)
        api = FakeApi(rows)
        fill.apply_plan(api, SETTINGS, plan, ZONE, rows, END)
        self.assertEqual(len(api.posts), 2)
        self.assertEqual(api.rows[0], rows[0])

    def test_overtime_reduces_final_addition_to_exact_zero(self):
        rows = [row(day='2025-12-30', end='19:00:00', duration=36000)]
        plan, target, worked = fill.build_plan(SETTINGS, rows, END, ZONE)
        self.assertEqual([p.seconds for p in plan], [28800, 21600])
        self.assertEqual(worked + sum(p.seconds for p in plan) - target, 0)

    def test_partial_and_zero_duration_bookings_are_not_topped_up(self):
        for duration in (0, 3600):
            with self.assertRaisesRegex(fill.FillError, 'not enough completely empty'):
                fill.build_plan(SETTINGS, [row(duration=duration)], END, ZONE)

    def test_weekend_time_counts_without_stopping(self):
        settings = dict(SETTINGS, work_start='2025-12-27')
        plan, target, worked = fill.build_plan(settings, [row(day='2025-12-27')], END, ZONE)
        self.assertEqual(len(plan), 2)
        self.assertEqual(worked + sum(p.seconds for p in plan), target)

    def test_existing_positive_balance_cannot_be_removed(self):
        with self.assertRaisesRegex(fill.FillError, 'exceeds the target'):
            fill.build_plan(SETTINGS, [row(duration=100000)], END, ZONE)

    def test_running_entry_prevents_exact_balance_calculation(self):
        with self.assertRaises(fill.FillError):
            fill.build_plan(SETTINGS, [dict(row(), end=None)], END, ZONE)

    def test_cross_midnight_entries_occupy_both_days(self):
        settings = dict(SETTINGS, week_hours=5)
        entry = dict(row(begin='00:00:00', duration=10800), end='2025-12-30T01:00:00+0100')
        plan, _, _ = fill.build_plan(settings, [entry], END, ZONE)
        self.assertEqual(plan, [])

    def test_explicit_end_excludes_later_bookings_and_days(self):
        end = date(2025, 12, 30)
        plan, target, worked = fill.build_plan(SETTINGS, [row(day='2025-12-31')], end, ZONE)
        self.assertEqual(len(plan), 2)
        self.assertEqual(target, 57600)
        self.assertEqual(worked, 0)
        self.assertTrue(all(p.day <= end for p in plan))

    def test_apply_is_repeatable_without_duplicates(self):
        api = FakeApi()
        plan, _, _ = fill.build_plan(SETTINGS, [], END, ZONE)
        fill.apply_plan(api, SETTINGS, plan, ZONE, [], END)
        self.assertEqual(len(api.posts), 3)
        again, _, _ = fill.build_plan(SETTINGS, api.rows, END, ZONE)
        self.assertEqual(again, [])
        self.assertTrue(all(p['project'] == 1 and p['activity'] == 2 for p in api.posts))

    def test_server_rounding_is_undone_and_stops(self):
        api = FakeApi(rounded=True)
        plan, _, _ = fill.build_plan(SETTINGS, [], END, ZONE)
        with self.assertRaises(fill.FillError):
            fill.apply_plan(api, SETTINGS, plan, ZONE, [], END)
        self.assertEqual(len(api.posts), 1)
        self.assertEqual(api.deletes, ['timesheets/101'])

    def test_concurrent_edits_abort_before_posting(self):
        api = FakeApi(changed=True)
        plan, _, _ = fill.build_plan(SETTINGS, [], END, ZONE)
        with self.assertRaises(fill.FillError):
            fill.apply_plan(api, SETTINGS, plan, ZONE, [], END)
        self.assertEqual(api.posts, [])

    def test_no_cross_midnight_additions(self):
        with self.assertRaises(fill.FillError):
            fill.build_plan(SETTINGS, [], END, ZONE, time(20))

    def test_new_weekend_booking_during_apply_stops_later_writes(self):
        settings = dict(SETTINGS, work_start='2025-12-26')
        api = FakeApi()
        plan, _, _ = fill.build_plan(settings, [], END, ZONE)
        original = api.timesheets
        def timesheets(start, end):
            if api.posts:
                return original(start, end) + [row(50, day='2025-12-27')]
            return original(start, end)
        api.timesheets = timesheets
        with self.assertRaisesRegex(fill.FillError, 'data changed'):
            fill.apply_plan(api, settings, plan, ZONE, [], END)
        self.assertEqual(len(api.posts), 1)
        self.assertEqual(api.posts[0]['begin'][:10], '2025-12-26')


if __name__ == '__main__':
    unittest.main()
