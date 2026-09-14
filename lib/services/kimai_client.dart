import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/settings.dart';
import '../models/work_statistics.dart';

class KimaiClient {
  KimaiClient([http.Client? client]) : _client = client ?? http.Client();
  final http.Client _client;

  Map<String, String> _headers(AppSettings s) => {
    'Authorization': 'Bearer ${s.apiToken}',
    'Content-Type': 'application/json',
  };
  Uri _uri(AppSettings s, String path) =>
      Uri.parse('${s.apiUrl.replaceFirst(RegExp(r'/+$'), '')}$path');
  void _check(http.Response response) {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Exception('Kimai returned ${response.statusCode}');
    }
  }

  Future<List<dynamic>> _active(AppSettings s) async {
    final response = await _client.get(
      _uri(s, '/api/timesheets/active'),
      headers: _headers(s),
    );
    _check(response);
    return jsonDecode(response.body) as List<dynamic>;
  }

  Future<DateTime?> activeSince(AppSettings s) async {
    final items = await _active(s);
    if (items.isEmpty) return null;
    return DateTime.parse(
      (items.first as Map<String, dynamic>)['begin'] as String,
    );
  }

  Future<DateTime?> toggle(AppSettings s) async {
    final items = await _active(s);
    if (items.isNotEmpty) {
      final id = (items.first as Map<String, dynamic>)['id'];
      final response = await _client.patch(
        _uri(s, '/api/timesheets/$id/stop'),
        headers: _headers(s),
      );
      _check(response);
      return null;
    }
    final begin = DateTime.now().toUtc();
    final response = await _client.post(
      _uri(s, '/api/timesheets'),
      headers: _headers(s),
      body: jsonEncode({
        'begin': begin.toIso8601String(),
        'project': s.projectId,
        'activity': s.activityId,
      }),
    );
    _check(response);
    return begin;
  }

  Future<List<TimesheetEntry>> timesheets(
    AppSettings s,
    DateTime begin,
    DateTime end,
  ) async {
    final uri = _uri(s, '/api/timesheets').replace(
      queryParameters: {
        'begin': _apiDateTime(begin),
        'end': _apiDateTime(end),
        'size': '20000',
        'order': 'ASC',
      },
    );
    final response = await _client.get(uri, headers: _headers(s));
    _check(response);
    return (jsonDecode(response.body) as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(TimesheetEntry.fromJson)
        .toList();
  }

  Future<AppSettings> resolveActivity(AppSettings s) async {
    final projectResponse = await _client.get(
      _uri(s, '/api/projects'),
      headers: _headers(s),
    );
    _check(projectResponse);
    final projects = jsonDecode(projectResponse.body) as List<dynamic>;
    final project = projects
        .cast<Map<String, dynamic>>()
        .where(
          (item) =>
              '${item['name']}'.trim().toLowerCase() ==
              s.project.trim().toLowerCase(),
        )
        .firstOrNull;
    if (project == null) {
      throw Exception('Project "${s.project}" not found');
    }
    final projectId = (project['id'] as num).toInt();

    final activitiesUri = _uri(
      s,
      '/api/activities',
    ).replace(queryParameters: {'project': '$projectId'});
    final activityResponse = await _client.get(
      activitiesUri,
      headers: _headers(s),
    );
    _check(activityResponse);
    final activities = jsonDecode(activityResponse.body) as List<dynamic>;
    final matchingActivities = activities
        .cast<Map<String, dynamic>>()
        .where(
          (item) =>
              '${item['name']}'.trim().toLowerCase() ==
              s.activity.trim().toLowerCase(),
        )
        .toList();
    final activity =
        matchingActivities
            .where((item) => item['project'] == projectId)
            .firstOrNull ??
        matchingActivities
            .where((item) => item['project'] == null)
            .firstOrNull ??
        matchingActivities.firstOrNull;
    if (activity == null) {
      throw Exception(
        'Activity "${s.activity}" not found for project "${s.project}"',
      );
    }
    return s.copyWith(
      projectId: projectId,
      activityId: (activity['id'] as num).toInt(),
    );
  }

  void close() => _client.close();

  String _apiDateTime(DateTime value) {
    final local = value.toLocal();
    String two(int number) => number.toString().padLeft(2, '0');
    return '${local.year.toString().padLeft(4, '0')}-'
        '${two(local.month)}-${two(local.day)}T'
        '${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
  }
}
