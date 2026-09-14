import 'package:flutter_test/flutter_test.dart';
import 'package:kimaier/models/settings.dart';
import 'package:kimaier/models/work_statistics.dart';

void main() {
  test('calculates the values shown by the former statistics page', () {
    final now = DateTime(2026, 9, 14, 12);
    final statistics = WorkStatistics.calculate(
      const AppSettings(
        weekHours: 40,
        workDays: ['Mo', 'Tu', 'We', 'Th', 'Fr'],
        // The former app counts the full current-month target even when the
        // configured employment start is later in that month.
        workStart: '2026-09-10',
      ),
      [
        TimesheetEntry(
          begin: DateTime(2026, 9, 11, 8),
          end: DateTime(2026, 9, 11, 16),
        ),
        TimesheetEntry(begin: DateTime(2026, 9, 14, 8)),
      ],
      now,
    );

    expect(statistics.todaySeconds, 4 * 3600);
    expect(statistics.weekSeconds, 4 * 3600);
    expect(statistics.monthSeconds, 12 * 3600);
    expect(statistics.monthTargetSeconds, 176 * 3600);
    expect(statistics.leftSeconds, 164 * 3600);
    expect(statistics.overtimeSeconds, -68 * 3600);
  });
}
