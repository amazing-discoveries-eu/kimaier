import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

class UpdateService {
  Future<String> check() async {
    final currentVersion = (await PackageInfo.fromPlatform()).version;
    final response = await http.get(
      Uri.parse(
        'https://api.github.com/repos/jb-alvarado/kimaier/releases/latest',
      ),
      headers: {'Accept': 'application/vnd.github+json'},
    );
    if (response.statusCode != 200) {
      throw Exception('GitHub returned ${response.statusCode}');
    }
    final release = jsonDecode(response.body) as Map<String, dynamic>;
    final latest = '${release['tag_name']}'.replaceFirst(RegExp(r'^v'), '');
    if (_compare(latest, currentVersion) <= 0) {
      return 'Kimaier is up to date.';
    }
    final uri = Uri.parse(release['html_url'] as String);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw Exception('Could not open $uri');
    }
    return 'Version $latest is available.';
  }

  int _compare(String left, String right) {
    final a = left.split('.').map((v) => int.tryParse(v) ?? 0).toList();
    final b = right.split('.').map((v) => int.tryParse(v) ?? 0).toList();
    for (var i = 0; i < 3; i++) {
      final result = (i < a.length ? a[i] : 0).compareTo(
        i < b.length ? b[i] : 0,
      );
      if (result != 0) return result;
    }
    return 0;
  }
}
