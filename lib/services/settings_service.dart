import 'dart:convert';
import 'dart:io';
import 'package:path_provider/path_provider.dart';
import '../models/settings.dart';

class SettingsService {
  Future<File> get _file async => File(
    '${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}settings.json',
  );

  Future<AppSettings> load() async {
    final support = await getApplicationSupportDirectory();
    final home = Platform.environment['HOME'];
    final candidates = <File>[
      await _file,
      File('${support.path}${Platform.pathSeparator}kimaier.dat'),
      if (Platform.isLinux && home != null) ...[
        File('$home/.local/share/kimaier/kimaier.dat'),
        File('$home/.config/Kimaier/settings.json'),
      ],
    ];
    for (final file in candidates) {
      if (!await file.exists()) continue;
      try {
        final value = jsonDecode(await file.readAsString());
        final json = Map<String, dynamic>.from(
          value is Map && value['user'] is Map
              ? value['user'] as Map
              : value as Map,
        );
        final settings = AppSettings.fromJson(json);
        if (settings.apiUrl.isNotEmpty || settings.apiToken.isNotEmpty) {
          return settings;
        }
      } on Object {
        continue;
      }
    }
    return const AppSettings();
  }

  Future<void> save(AppSettings settings) async {
    final file = await _file;
    await file.parent.create(recursive: true);
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(settings.toJson()),
    );
  }
}
