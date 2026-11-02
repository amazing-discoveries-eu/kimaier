# Kimaier
---

Simple desktop time tracking tool that uses [kimai](https://www.kimai.org/de/).

It is assumed that the projects and activities do not change often.

Overtime is calculated from the optional **Count from** date in Settings. When
empty, the configured **Work start** date is used, including previous years.
The total duration of completed months is cached locally in `timesheets.sqlite` in
the application's local data directory, separately for each Kimai server, user and
calculation start date. Newly completed months are added automatically; the current month
is fetched directly from Kimai. After correcting or deleting older entries, use
**Reload history** in Settings to rebuild the cached total. A failed reload keeps
the previous cache intact. Target hours use the currently configured weekly hours
and work days throughout the period.

## Fill missing historical times

Requires Python 3.10+ with timezone data, without third-party Python packages.
Run a preview using the installed app's settings:

```sh
python3 scripts/fill_missing_times.py
```

Use `--settings /path/to/kimaier.dat` for another settings file. The file must
contain the saved Kimaier `user` object (a plain settings JSON object also works).
The token can alternatively be supplied using `KIMAI_API_TOKEN`.

The script balances the period from `work_start` through the inclusive end date
specified by `--until YYYY-MM-DD`. The default and maximum
end date is December 31 of the previous year; the current year is excluded.
Existing time across all projects, including weekends and overtime, is counted
towards the configured target. Existing bookings are skipped and never stop the
normal planning process or get overwritten.

Additions are created chronologically on completely empty configured work days.
Saturday and Sunday are always excluded from new entries, even if selected in
`work_days`; the configured target and existing weekend bookings still count
towards the balance. Each addition is limited
to the daily target (`week_hours` divided by the number of `work_days`). The
last addition may be shorter to reach an exact zero balance for the period.
Partially booked days, zero-duration entries and days touched by a booking
crossing midnight are not topped up. If existing time already exceeds the target,
or insufficient empty days remain, the script reports that exact balancing is
impossible without changing existing entries and writes nothing. Running entries
also prevent an exact balance calculation.

The script uses `project_id`, `activity_id` and the Kimai user's timezone.
Like the current `Statistics.vue` implementation, this calculation does not
deduct holidays or absences; the legacy `state` setting is not used. Current
weekly hours and work days apply to the entire historical period.

Preview, then apply for a chosen end date:

```sh
python3 scripts/fill_missing_times.py --until 2025-12-31
python3 scripts/fill_missing_times.py --until 2025-12-31 --apply
```

New entries are marked `Kimaier: historical target top-up` and non-billable.
Each entry starts at 09:00 (`--day-start HH:MM` overrides this) and must fit
entirely within its day. Before every write, the complete period is checked for
concurrent changes; if the data changed after planning, the script stops to avoid
using an outdated balance. Existing entries are never edited. If Kimai changes
a new entry's duration or timestamps, the script attempts to delete that new
entry and stops. Writes are not retried automatically. A failed run can leave
earlier successful additions in place; rerunning recalculates the remaining
balance from Kimai. Afterwards, use **Reload history** in Kimaier Settings.

To remove entries created by this script within the same inclusive date limits:

```sh
python3 scripts/fill_missing_times.py --delete --until 2025-12-31
python3 scripts/fill_missing_times.py --delete --until 2025-12-31 --apply
```

Only entries whose description exactly matches `Kimaier: historical target top-up`
and whose start and end are within `work_start` through `--until` are selected.
Other bookings are preserved. Each selected entry is checked again before deletion;
changed entries stop deletion. Earlier successful deletions remain in place if a
later request fails. Refresh Kimaier's history afterwards.

Test the script without accessing Kimai:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

![start](/docs/start.png) | ![pause](/docs/pause.png) | ![stats](/docs/stats.png) | ![settings](/docs/settings.png)

---

Control icons are from [fontawesome](https://fontawesome.com) which are license under [creativecommons v4.0](https://creativecommons.org/licenses/by/4.0/)

**When screen in dev mode is blank run it with: `WEBKIT_DISABLE_COMPOSITING_MODE=1 npm run tauri dev`
