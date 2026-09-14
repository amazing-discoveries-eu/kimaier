import 'settings.dart';

class TimesheetEntry {
  const TimesheetEntry({required this.begin, this.end, this.duration});

  final DateTime begin;
  final DateTime? end;
  final int? duration;

  factory TimesheetEntry.fromJson(Map<String, dynamic> json) => TimesheetEntry(
    begin: DateTime.parse(json['begin'] as String),
    end: json['end'] == null ? null : DateTime.parse(json['end'] as String),
    duration: (json['duration'] as num?)?.toInt(),
  );

  int secondsAt(DateTime now, {bool preferDuration = false}) {
    if (preferDuration && duration != null) return duration!.clamp(0, 1 << 53);
    return ((end ?? now).difference(begin).inSeconds).clamp(0, 1 << 53);
  }
}

class WorkStatistics {
  const WorkStatistics({
    required this.todaySeconds,
    required this.weekSeconds,
    required this.monthSeconds,
    required this.monthTargetSeconds,
    required this.leftSeconds,
    required this.overtimeSeconds,
  });

  final int todaySeconds;
  final int weekSeconds;
  final int monthSeconds;
  final int monthTargetSeconds;
  final int leftSeconds;
  final int overtimeSeconds;

  factory WorkStatistics.calculate(
    AppSettings settings,
    List<TimesheetEntry> entries,
    DateTime now,
  ) {
    final localNow = now.toLocal();
    final today = _date(localNow);
    final week = today.subtract(Duration(days: today.weekday - 1));
    final month = DateTime(today.year, today.month);
    final year = DateTime(today.year);
    final configuredStart = DateTime.tryParse(settings.workStart)?.toLocal();
    final workStart = configuredStart != null && configuredStart.isAfter(year)
        ? configuredStart
        : year;

    int secondsSince(DateTime start) => entries
        .where((entry) => !_date(entry.begin.toLocal()).isBefore(start))
        .fold(0, (total, entry) => total + entry.secondsAt(now));

    final todaySeconds = secondsSince(today);
    final weekSeconds = secondsSince(week);
    final monthSeconds = secondsSince(month);
    final previousMonthSeconds = entries
        .where(
          (entry) =>
              !entry.begin.toLocal().isBefore(workStart) &&
              entry.begin.toLocal().isBefore(month),
        )
        .fold(
          0,
          (total, entry) => total + entry.secondsAt(now, preferDuration: true),
        );
    final monthTargetSeconds = _targetSeconds(
      settings,
      month,
      DateTime(month.year, month.month + 1).subtract(const Duration(days: 1)),
    );
    var previousTargetSeconds = 0;
    for (
      var targetMonth = DateTime(workStart.year, workStart.month);
      targetMonth.isBefore(month);
      targetMonth = DateTime(targetMonth.year, targetMonth.month + 1)
    ) {
      previousTargetSeconds += _targetSeconds(
        settings,
        targetMonth,
        DateTime(
          targetMonth.year,
          targetMonth.month + 1,
        ).subtract(const Duration(days: 1)),
      );
    }
    final targetToDate =
        previousTargetSeconds + _targetSeconds(settings, month, today);

    return WorkStatistics(
      todaySeconds: todaySeconds,
      weekSeconds: weekSeconds,
      monthSeconds: monthSeconds,
      monthTargetSeconds: monthTargetSeconds,
      leftSeconds: monthTargetSeconds - monthSeconds,
      overtimeSeconds: previousMonthSeconds + monthSeconds - targetToDate,
    );
  }

  static DateTime queryStart(AppSettings settings, DateTime now) {
    final today = _date(now.toLocal());
    final candidates = <DateTime>[
      DateTime(today.year),
      DateTime(today.year, today.month),
      today.subtract(Duration(days: today.weekday - 1)),
    ];
    final configuredStart = DateTime.tryParse(settings.workStart)?.toLocal();
    if (configuredStart != null && configuredStart.year == today.year) {
      candidates.add(_date(configuredStart));
    }
    candidates.sort();
    return candidates.first;
  }

  static int _targetSeconds(
    AppSettings settings,
    DateTime begin,
    DateTime end,
  ) {
    if (settings.workDays.isEmpty || settings.weekHours <= 0) return 0;
    final secondsPerDay = (settings.weekHours * 3600 / settings.workDays.length)
        .round();
    var total = 0;
    for (
      var date = _date(begin);
      !date.isAfter(_date(end));
      date = date.add(const Duration(days: 1))
    ) {
      if (settings.workDays.contains(_dayNames[date.weekday - 1])) {
        total += secondsPerDay;
      }
    }
    return total;
  }

  static DateTime _date(DateTime value) =>
      DateTime(value.year, value.month, value.day);

  static const _dayNames = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
}
