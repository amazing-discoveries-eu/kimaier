import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:kimaier/models/settings.dart';
import 'package:kimaier/services/kimai_client.dart';

void main() {
  test('resolves a project and a global activity by name', () async {
    final client = MockClient((request) async {
      switch (request.url.path) {
        case '/api/projects':
          return http.Response('[{"id":12,"name":"Kimaier"}]', 200);
        case '/api/activities':
          expect(request.url.queryParameters['project'], '12');
          return http.Response(
            '[{"id":34,"name":"Development","project":null}]',
            200,
          );
        default:
          return http.Response('', 404);
      }
    });
    final kimai = KimaiClient(client);

    final resolved = await kimai.resolveActivity(
      const AppSettings(
        apiUrl: 'https://kimai.example.test',
        apiToken: 'token',
        project: 'kimaier',
        activity: 'development',
      ),
    );

    expect(resolved.projectId, 12);
    expect(resolved.activityId, 34);
  });
}
