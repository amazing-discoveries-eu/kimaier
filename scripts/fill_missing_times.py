#!/usr/bin/env python3
"""Balance historical target hours by adding time on completely empty workdays. Preview unless --apply."""
from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from fractions import Fraction
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
from zoneinfo import ZoneInfo

DAYS = ('Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su')
MARKER = 'Kimaier: historical target top-up'


class FillError(Exception):
    pass


class NoRedirect(HTTPRedirectHandler):
    # Do not forward the API token to a redirect destination.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Api:
    def __init__(self, settings):
        self.base = settings['api_url'].rstrip('/')
        if urlsplit(self.base).scheme not in ('https', 'http'):
            raise FillError('api_url must be an HTTP(S) URL.')
        self.token = os.environ.get('KIMAI_API_TOKEN') or settings.get('api_token') or settings.get('api_pass')
        if not self.token:
            raise FillError('Missing api_token (or KIMAI_API_TOKEN environment variable).')
        self.opener = build_opener(NoRedirect())

    def request(self, method, path, payload=None):
        body = None if payload is None else json.dumps(payload).encode()
        request = Request(f'{self.base}/api/{path}', data=body, method=method, headers={
            'Authorization': f'Bearer {self.token}',
            'Accept': 'application/json', 'Content-Type': 'application/json',
        })
        try:
            with self.opener.open(request, timeout=60) as response:
                raw = response.read()
                return (json.loads(raw) if raw else None), response.headers
        except HTTPError as error:
            raise FillError(f'{method} {path.split("?")[0]}: HTTP {error.code}. No automatic retry.') from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise FillError(f'{method} request failed. Check Kimai before rerunning; a write may have succeeded.') from error

    def timesheets(self, start, end):
        result, page, pages = [], 1, 0
        while True:
            params = urlencode({'begin': f'{start}T00:00:00', 'end': f'{end}T23:59:59',
                                'page': page, 'size': 500, 'order': 'ASC'})
            try:
                rows, headers = self.request('GET', f'timesheets?{params}')
            except FillError as error:
                if page > 1 and not pages and isinstance(error.__cause__, HTTPError) and error.__cause__.code == 404:
                    break
                raise
            if not isinstance(rows, list):
                raise FillError('Invalid timesheet response.')
            result.extend(rows)
            pages = int(headers.get('X-Total-Pages', 0))
            if not rows or (page >= pages if pages else len(rows) < 500):
                break
            page += 1
        if len({row['id'] for row in result}) != len(result):
            raise FillError('Duplicate entries during pagination. Run again without concurrent edits.')
        return result


def default_settings():
    if sys.platform == 'darwin':
        root = Path.home() / 'Library/Application Support'
    elif sys.platform == 'win32':
        root = Path(os.environ.get('APPDATA', Path.home() / 'AppData/Roaming'))
    else:
        root = Path(os.environ.get('XDG_DATA_HOME', Path.home() / '.local/share'))
    return root / 'kimaier/kimaier.dat'


def load_settings(path):
    document = json.loads(path.read_text())
    settings = document.get('user', document)
    for key in ('api_url', 'work_start', 'week_hours', 'work_days', 'project_id', 'activity_id'):
        if not settings.get(key):
            raise FillError(f'Missing setting: {key}')
    days = settings['work_days']
    if not isinstance(days, list) or len(set(days)) != len(days) or not set(days) <= set(DAYS):
        raise FillError('work_days must contain unique Kimaier weekday names (Mo, Tu, …).')
    hours = Decimal(str(settings['week_hours']))
    if not hours.is_finite() or not 0 < hours <= 24 * len(days):
        raise FillError('Invalid weekly hours.')
    if any(type(settings[key]) is not int or settings[key] <= 0 for key in ('project_id', 'activity_id')):
        raise FillError('Save valid project/activity settings in Kimaier first.')
    date.fromisoformat(settings['work_start'])
    return settings


def period_end(until, today):
    limit = date(today.year - 1, 12, 31)
    if until is not None and until > limit:
        raise FillError(f'End date must be at most {limit}; the current year is excluded.')
    return until or limit


def targets(settings, end):
    """Match Statistics.vue: equal hours per configured weekday, no holiday deduction."""
    current = date.fromisoformat(settings['work_start'])
    day_seconds = Fraction(Decimal(str(settings['week_hours']))) * 3600 / len(settings['work_days'])
    result, accrued, rounded, month = {}, Fraction(0), 0, None
    while current <= end:
        if (current.year, current.month) != month:
            accrued, rounded, month = Fraction(0), 0, (current.year, current.month)
        if DAYS[current.weekday()] in settings['work_days']:
            accrued += day_seconds
            total = int(accrued + Fraction(1, 2))
            result[current] = total - rounded
            rounded = total
        current += timedelta(days=1)
    return result


def parse_entry(row, zone):
    try:
        begin = datetime.fromisoformat(row['begin'])
        end = datetime.fromisoformat(row['end']) if row['end'] else None
        duration = row['duration']
        if begin.tzinfo is None or end is None or end.tzinfo is None:
            raise ValueError('running or timezone-less entry')
        begin, end = begin.astimezone(zone), end.astimezone(zone)
        if end.timestamp() < begin.timestamp() or type(duration) is not int or duration < 0:
            raise ValueError('invalid duration')
        return begin, end, duration
    except (KeyError, TypeError, ValueError) as error:
        raise FillError(f'Cannot safely process timesheet {row.get("id")}: {error}') from error


@dataclass(frozen=True)
class Addition:
    day: date
    begin: str
    end: str
    seconds: int


def first_occupied_day(rows, start, end, zone):
    """Any booking counts, including zero-duration, running and non-workday entries."""
    first = None
    for row in rows:
        try:
            begin = datetime.fromisoformat(row['begin'])
            if begin.tzinfo is None:
                raise ValueError('missing timezone')
            begin = begin.astimezone(zone)
            day = begin.date()
            if day < start:
                finish = datetime.fromisoformat(row['end']) if row.get('end') else None
                if finish is not None and finish.tzinfo is None:
                    raise ValueError('missing timezone')
                # A previous booking ending exactly at midnight does not occupy this day.
                if finish is not None and finish.timestamp() <= datetime.combine(start, time(), zone).timestamp():
                    continue
                day = start
            if start <= day <= end and (first is None or day < first):
                first = day
        except (KeyError, TypeError, ValueError) as error:
            raise FillError(f'Invalid timestamp in timesheet {row.get("id")}.') from error
    return first


def build_plan(settings, rows, end, zone, day_start=time(9)):
    start = date.fromisoformat(settings['work_start'])
    daily_targets = targets(settings, end)
    occupied = set()
    worked = 0
    for row in rows:
        begin, finish, seconds = parse_entry(row, zone)
        if start <= begin.date() <= end:
            worked += seconds
        last = finish.date()
        if finish > begin and finish.timetz().replace(tzinfo=None) == time():
            last -= timedelta(days=1)
        day = max(start, begin.date())
        while day <= min(end, last):
            occupied.add(day)
            day += timedelta(days=1)
    target = sum(daily_targets.values())
    if worked > target:
        raise FillError(f'Existing time exceeds the target by {hms(worked - target)}. Cannot reach zero without changing existing entries.')
    remaining = target - worked
    plan = []
    for day, daily_target in daily_targets.items():
        seconds = min(daily_target, remaining)
        if day.weekday() >= 5 or day in occupied or not seconds:
            continue
        begin = datetime.combine(day, day_start, zone)
        finish = datetime.fromtimestamp(begin.timestamp() + seconds, zone)
        if finish.date() != day or begin.utcoffset() != finish.utcoffset() or begin.fold or finish.fold:
            raise FillError(f'Target time on {day} would cross midnight or a DST change. Choose another --day-start.')
        plan.append(Addition(day, begin.strftime('%Y-%m-%dT%H:%M:%S'),
                             finish.strftime('%Y-%m-%dT%H:%M:%S'), seconds))
        remaining -= seconds
    if remaining:
        raise FillError(f'Cannot balance exactly: {hms(remaining)} is missing but there are not enough completely empty workdays. No entries written.')
    return plan, target, worked


def signature(rows):
    return sorted((row['id'], row['begin'], row['end'], row['duration']) for row in rows)


def apply_plan(api, settings, plan, zone, rows, end):
    start = date.fromisoformat(settings['work_start'])
    expected = list(rows)
    for addition in plan:
        key = str(addition.day)
        # Recheck the complete balance, not just the destination day: a concurrent
        # booking anywhere in the period would otherwise invalidate the zero target.
        current = api.timesheets(start - timedelta(days=1), end)
        if signature(current) != signature(expected):
            raise FillError('Kimai data changed after planning. Re-run the preview to recalculate the balance.')
        if first_occupied_day(current, addition.day, addition.day, zone) is not None:
            raise FillError(f'Day {key} is no longer empty. Re-run the preview.')
        created, _ = api.request('POST', 'timesheets', {
            'project': settings['project_id'], 'activity': settings['activity_id'],
            'begin': addition.begin, 'end': addition.end,
            'description': MARKER, 'billable': False,
        })
        if not isinstance(created, dict) or not isinstance(created.get('id'), int):
            raise FillError(f'Unexpected write response for {key}; check Kimai before rerunning.')
        try:
            _, _, duration = parse_entry(created, ZoneInfo('UTC'))
            original_begin = datetime.fromisoformat(addition.begin)
            original_finish = datetime.fromisoformat(addition.end)
            # Compare local API timestamps; responses include offsets while requests do not.
            matches = (datetime.fromisoformat(created['begin']).replace(tzinfo=None) == original_begin and
                       datetime.fromisoformat(created['end']).replace(tzinfo=None) == original_finish and
                       duration == addition.seconds)
        except FillError:
            matches = False
        if not matches:
            try:
                api.request('DELETE', f'timesheets/{created["id"]}')
            except FillError as error:
                raise FillError(f'Kimai changed the duration. Could not undo entry {created["id"]}; check it manually.') from error
            raise FillError(f'Kimai changed the duration (e.g. rounding) on {key}. New entry undone; stopping.')
        expected.append(created)
        print(f'Created {created["id"]}: {addition.begin} – {addition.end}', flush=True)


def deletion_candidates(rows, start, end, zone):
    selected = []
    for row in rows:
        if row.get('description') != MARKER:
            continue
        begin, finish, _ = parse_entry(row, zone)
        if start <= begin.date() <= finish.date() <= end:
            selected.append(row)
    return selected


def delete_entries(api, entries):
    for entry in entries:
        current, _ = api.request('GET', f'timesheets/{entry["id"]}')
        fields = ('id', 'begin', 'end', 'duration', 'description', 'project', 'activity')
        if not isinstance(current, dict) or any(current.get(key) != entry.get(key) for key in fields):
            raise FillError(f'Timesheet {entry["id"]} changed since preview. Stopping deletion.')
        api.request('DELETE', f'timesheets/{entry["id"]}')
        print(f'Deleted {entry["id"]}: {entry["begin"]} – {entry["end"]}', flush=True)


def hms(seconds):
    sign = '-' if seconds < 0 else ''
    hours, rest = divmod(abs(seconds), 3600)
    minutes, seconds = divmod(rest, 60)
    return f'{sign}{hours}:{minutes:02}:{seconds:02}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--settings', type=Path, default=default_settings(), help='Kimaier kimaier.dat or equivalent JSON')
    parser.add_argument('--until', type=date.fromisoformat, help='Last date, at most December 31 of the previous year')
    parser.add_argument('--day-start', type=time.fromisoformat, default=time(9), help='Start time for each empty workday (default: 09:00)')
    parser.add_argument('--delete', action='store_true', help='Delete only script-marked entries within work_start through --until')
    parser.add_argument('--apply', action='store_true', help='Apply displayed creations or deletions; otherwise preview only')
    args = parser.parse_args()
    try:
        settings = load_settings(args.settings)
        api = Api(settings)
        user, _ = api.request('GET', 'users/me')
        zone = ZoneInfo(user['timezone'])
        end = period_end(args.until, datetime.now(zone).date())
        start = date.fromisoformat(settings['work_start'])
        if start > end:
            print('No eligible days before the end of the previous year.')
            return 0
        if args.day_start.tzinfo is not None or args.day_start.microsecond:
            raise FillError('--day-start must be a local time without fractional seconds or timezone.')
        # Include the previous day to detect bookings crossing into the first eligible day.
        rows = api.timesheets(start - timedelta(days=1), end)
        if args.delete:
            entries = deletion_candidates(rows, start, end, zone)
            print(f'Delete preview: {start} – {end}; entries: {len(entries)}')
            for entry in entries:
                print(f'{entry["id"]}: {entry["begin"]} – {entry["end"]}')
            if not args.apply:
                print('Preview only. Use --delete --apply to delete these entries. No Kimai data changed.')
            elif entries:
                delete_entries(api, entries)
                print('Finished. Use Reload history in Kimaier Settings to refresh the cache.')
            return 0
        plan, target, worked = build_plan(settings, rows, end, zone, args.day_start)
        added = sum(item.seconds for item in plan)
        print(f'User {user["id"]}; period {start} – {end}; timezone {zone}')
        print(f'Target: {hms(target)}; existing: {hms(worked)}; fill: {hms(added)}; new entries: {len(plan)}')
        print(f'Resulting balance: {hms(worked + added - target)}')
        for item in plan:
            print(f'{item.begin} – {item.end}  +{hms(item.seconds)}')
        if not args.apply:
            print('Preview only. Use --apply to create these entries. No Kimai data changed.')
        elif plan:
            apply_plan(api, settings, plan, zone, rows, end)
            print('Finished. Use Reload history in Kimaier Settings to refresh the cache.')
        return 0
    except (FillError, OSError, ValueError, KeyError, TypeError, ArithmeticError) as error:
        print(f'Error: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
