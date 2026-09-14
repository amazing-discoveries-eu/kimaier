import 'package:flutter_test/flutter_test.dart';
import 'package:kimaier/models/settings.dart';

void main() {
  test('imports every legacy setting and falls back to api_pass', () {
    final settings = AppSettings.fromJson({
      'name': 'Work',
      'api_url': 'https://kimai.example.test',
      'api_token': '',
      'api_pass': 'legacy-token',
      'project': 'Kimaier',
      'activity': 'Development',
      'project_id': 12,
      'activity_id': 34,
      'week_hours': 40,
      'state': 'active',
      'work_days': ['Mo', 'Tu', 'We', 'Th', 'Fr'],
      'work_start': '2026-01-01',
    });

    expect(settings.name, 'Work');
    expect(settings.apiToken, 'legacy-token');
    expect(settings.projectId, 12);
    expect(settings.activityId, 34);
    expect(settings.weekHours, 40);
    expect(settings.state, 'active');
    expect(settings.workDays, ['Mo', 'Tu', 'We', 'Th', 'Fr']);
    expect(settings.workStart, '2026-01-01');
  });
}
