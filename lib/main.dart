import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'models/settings.dart';
import 'models/work_statistics.dart';
import 'services/kimai_client.dart';
import 'services/settings_service.dart';
import 'services/update_service.dart';

void main() => runApp(const KimaierApp());

class KimaierApp extends StatelessWidget {
  const KimaierApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    themeMode: ThemeMode.system,
    theme: ThemeData(
      colorSchemeSeed: Colors.deepPurple,
      brightness: Brightness.light,
      useMaterial3: true,
    ),
    darkTheme: ThemeData(
      colorSchemeSeed: Colors.deepPurple,
      brightness: Brightness.dark,
      useMaterial3: true,
    ),
    home: const Home(),
  );
}

class Home extends StatefulWidget {
  const Home({super.key});
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  final kimai = KimaiClient();
  final settingsService = SettingsService();
  final updateService = UpdateService();
  final fields = {
    for (final k in [
      'api_url',
      'api_token',
      'project',
      'activity',
      'week_hours',
      'work_start',
    ])
      k: TextEditingController(),
  };
  AppSettings settings = const AppSettings();
  List<TimesheetEntry> statisticEntries = const [];
  DateTime? begin;
  int page = 0;
  String status = '';
  Timer? timer;
  Timer? statusTimer;
  int pollTicks = 0;
  bool polling = false;
  bool statisticsLoading = false;
  bool get running => begin != null;
  @override
  void initState() {
    super.initState();
    _load();
    timer = Timer.periodic(const Duration(seconds: 1), (_) async {
      if (!mounted) return;
      setState(() {});
      pollTicks++;
      if (pollTicks >= 60 && !polling) {
        pollTicks = 0;
        polling = true;
        await _active();
        if (page == 1) await _loadStatistics();
        polling = false;
      }
    });
  }

  Future<void> _load() async {
    try {
      final s = await settingsService.load();
      settings = s;
      for (final e in fields.entries) {
        e.value.text = '${s.toJson()[e.key] ?? ''}';
      }
      if (!mounted) return;
      setState(() => page = s.activityId == 0 ? 2 : 0);
      await _active();
    } catch (e) {
      _showStatus(_errorMessage(e));
    }
  }

  Future<void> _active() async {
    try {
      final active = await kimai.activeSince(settings);
      if (mounted) setState(() => begin = active);
    } catch (e) {
      _showStatus(_errorMessage(e));
    }
  }

  Future<void> _toggle() async {
    try {
      final active = await kimai.toggle(settings);
      if (mounted) setState(() => begin = active);
    } catch (e) {
      _showStatus(_errorMessage(e));
    }
  }

  Future<void> _save() async {
    final edited = settings.copyWith(
      apiUrl: fields['api_url']!.text.trim(),
      apiToken: fields['api_token']!.text.trim(),
      project: fields['project']!.text.trim(),
      activity: fields['activity']!.text.trim(),
      weekHours: double.tryParse(fields['week_hours']!.text) ?? 0,
      workStart: fields['work_start']!.text.trim(),
    );
    try {
      settings = await kimai.resolveActivity(edited);
      await settingsService.save(settings);
      if (!mounted) return;
      setState(() => page = 0);
      _showStatus('Saved.');
    } catch (e) {
      _showStatus(_errorMessage(e));
    }
  }

  Future<void> _update() async {
    _showStatus('Checking for updates…');
    try {
      final result = await updateService.check();
      _showStatus(result);
    } catch (e) {
      _showStatus(_errorMessage(e));
    }
  }

  Future<void> _loadStatistics() async {
    if (statisticsLoading) return;
    if (settings.apiUrl.isEmpty || settings.apiToken.isEmpty) {
      _showStatus('Please configure the Kimai connection first.');
      return;
    }
    statisticsLoading = true;
    if (mounted) setState(() {});
    try {
      final now = DateTime.now();
      final end = DateTime(now.year, now.month, now.day, 23, 59, 59);
      final entries = await kimai.timesheets(
        settings,
        WorkStatistics.queryStart(settings, now),
        end,
      );
      if (mounted) setState(() => statisticEntries = entries);
    } catch (e) {
      _showStatus(_errorMessage(e));
    } finally {
      statisticsLoading = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _openWebsite() async {
    final uri = Uri.tryParse(settings.apiUrl);
    if (uri == null ||
        !const {'http', 'https'}.contains(uri.scheme) ||
        uri.host.isEmpty) {
      _showStatus('Please enter a valid Kimai URL.');
      return;
    }
    try {
      if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
        _showStatus('Could not open the Kimai website.');
      }
    } catch (e) {
      _showStatus(_errorMessage(e));
    }
  }

  void _showStatus(String message) {
    if (!mounted) return;
    statusTimer?.cancel();
    setState(() => status = message);
    if (message.isEmpty) return;
    statusTimer = Timer(const Duration(seconds: 10), () {
      if (mounted && status == message) {
        setState(() => status = '');
      }
    });
  }

  String _errorMessage(Object error) =>
      error.toString().replaceFirst(RegExp(r'^Exception:\s*'), '');

  String get elapsed {
    final d = begin == null
        ? Duration.zero
        : DateTime.now().toUtc().difference(begin!.toUtc());
    return '${d.inHours.toString().padLeft(2, '0')}:${(d.inMinutes % 60).toString().padLeft(2, '0')}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';
  }

  String _duration(int seconds, {bool withSeconds = false}) {
    final sign = seconds < 0 ? '-' : '';
    final absolute = seconds.abs();
    final hours = absolute ~/ 3600;
    final minutes = absolute ~/ 60 % 60;
    final value =
        '$sign${hours.toString().padLeft(2, '0')}:'
        '${minutes.toString().padLeft(2, '0')}';
    if (!withSeconds) return value;
    return '$value:${(absolute % 60).toString().padLeft(2, '0')}';
  }

  String _hours(int seconds) {
    final value = seconds / 3600;
    return value == value.roundToDouble()
        ? value.toStringAsFixed(0)
        : value.toStringAsFixed(2);
  }

  @override
  void dispose() {
    timer?.cancel();
    statusTimer?.cancel();
    kimai.close();
    for (final c in fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Expanded(
              child: switch (page) {
                0 => _timer(),
                1 => _statistics(),
                _ => _settings(),
              },
            ),
            if (status.isNotEmpty) Text(status, textAlign: TextAlign.center),
            NavigationBar(
              height: 56,
              labelBehavior: NavigationDestinationLabelBehavior.alwaysHide,
              selectedIndex: page,
              onDestinationSelected: (i) {
                if (i == 3) {
                  _openWebsite();
                } else {
                  setState(() => page = i);
                  if (i == 1) _loadStatistics();
                }
              },
              destinations: const [
                NavigationDestination(
                  icon: Icon(Icons.timer_outlined),
                  selectedIcon: Icon(Icons.timer),
                  label: '',
                ),
                NavigationDestination(
                  icon: Icon(Icons.bar_chart_outlined),
                  selectedIcon: Icon(Icons.bar_chart),
                  label: '',
                ),
                NavigationDestination(
                  icon: Icon(Icons.settings_outlined),
                  selectedIcon: Icon(Icons.settings),
                  label: '',
                ),
                NavigationDestination(
                  icon: Icon(Icons.language, size: 24),
                  selectedIcon: Icon(Icons.language, size: 24),
                  label: '',
                ),
              ],
            ),
          ],
        ),
      ),
    ),
  );
  Widget _timer() => Column(
    mainAxisAlignment: MainAxisAlignment.center,
    children: [
      InkWell(
        customBorder: const CircleBorder(),
        onTap: _toggle,
        child: Container(
          width: 170,
          height: 170,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Theme.of(context).colorScheme.surfaceContainerHighest,
          ),
          child: Icon(
            running ? Icons.pause_circle_outline : Icons.play_circle_outline,
            size: 145,
            color: running ? Colors.orange : Colors.green,
          ),
        ),
      ),
      const SizedBox(height: 12),
      Text(
        elapsed,
        style: const TextStyle(
          fontSize: 36,
          fontFeatures: [FontFeature.tabularFigures()],
        ),
      ),
    ],
  );
  Widget _statistics() {
    final statistics = WorkStatistics.calculate(
      settings,
      statisticEntries,
      DateTime.now(),
    );
    final rows = [
      ('Today', _duration(statistics.todaySeconds, withSeconds: true)),
      ('Week', _duration(statistics.weekSeconds)),
      ('Month', _duration(statistics.monthSeconds)),
      ('Target', _hours(statistics.monthTargetSeconds)),
      ('Left', _duration(statistics.leftSeconds)),
      ('Overtime', _duration(statistics.overtimeSeconds)),
    ];
    return Center(
      child: statisticsLoading && statisticEntries.isEmpty
          ? const CircularProgressIndicator()
          : ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 260),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final row in rows)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '${row.$1}:',
                              style: const TextStyle(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          Text(
                            row.$2,
                            style: const TextStyle(
                              fontFeatures: [FontFeature.tabularFigures()],
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 8),
                  IconButton(
                    tooltip: 'Refresh statistics',
                    onPressed: statisticsLoading ? null : _loadStatistics,
                    icon: const Icon(Icons.refresh),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _settings() => ListView(
    children: [
      for (final e in fields.entries)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: TextField(
            controller: e.value,
            obscureText: e.key == 'api_token',
            keyboardType: e.key == 'week_hours' ? TextInputType.number : null,
            decoration: InputDecoration(
              labelText: e.key.replaceAll('_', ' '),
              border: const OutlineInputBorder(),
            ),
          ),
        ),
      Wrap(
        children: [
          for (final d in ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'])
            FilterChip(
              label: Text(d),
              selected: settings.workDays.contains(d),
              showCheckmark: false,
              onSelected: (v) => setState(() {
                final days = List<String>.from(settings.workDays);
                v ? days.add(d) : days.remove(d);
                settings = settings.copyWith(workDays: days);
              }),
            ),
        ],
      ),
      const SizedBox(height: 8),
      FilledButton.icon(
        onPressed: _save,
        icon: const Icon(Icons.save),
        label: const Text('Save'),
      ),
      OutlinedButton.icon(
        onPressed: _update,
        icon: const Icon(Icons.system_update),
        label: const Text('Check update'),
      ),
    ],
  );
}
