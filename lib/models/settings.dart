class AppSettings {
  const AppSettings({
    this.name = '',
    this.apiUrl = '',
    this.apiToken = '',
    this.project = '',
    this.activity = '',
    this.projectId = 0,
    this.activityId = 0,
    this.weekHours = 0,
    this.state = '',
    this.workDays = const [],
    this.workStart = '',
  });

  final String name;
  final String apiUrl;
  final String apiToken;
  final String project;
  final String activity;
  final int projectId;
  final int activityId;
  final double weekHours;
  final String state;
  final List<String> workDays;
  final String workStart;

  factory AppSettings.fromJson(Map<String, dynamic> json) => AppSettings(
    name: json['name'] as String? ?? '',
    apiUrl: json['api_url'] as String? ?? '',
    apiToken: (json['api_token'] as String?)?.isNotEmpty == true
        ? json['api_token'] as String
        : json['api_pass'] as String? ?? '',
    project: json['project'] as String? ?? '',
    activity: json['activity'] as String? ?? '',
    projectId: (json['project_id'] as num?)?.toInt() ?? 0,
    activityId: (json['activity_id'] as num?)?.toInt() ?? 0,
    weekHours: (json['week_hours'] as num?)?.toDouble() ?? 0,
    state: json['state'] as String? ?? '',
    workDays: List<String>.from(json['work_days'] as List? ?? const []),
    workStart: json['work_start'] as String? ?? '',
  );

  Map<String, dynamic> toJson() => {
    'name': name,
    'api_url': apiUrl,
    'api_token': apiToken,
    'project': project,
    'activity': activity,
    'project_id': projectId,
    'activity_id': activityId,
    'week_hours': weekHours,
    'state': state,
    'work_days': workDays,
    'work_start': workStart,
  };

  AppSettings copyWith({
    String? name,
    String? apiUrl,
    String? apiToken,
    String? project,
    String? activity,
    int? projectId,
    int? activityId,
    double? weekHours,
    String? state,
    List<String>? workDays,
    String? workStart,
  }) => AppSettings(
    name: name ?? this.name,
    apiUrl: apiUrl ?? this.apiUrl,
    apiToken: apiToken ?? this.apiToken,
    project: project ?? this.project,
    activity: activity ?? this.activity,
    projectId: projectId ?? this.projectId,
    activityId: activityId ?? this.activityId,
    weekHours: weekHours ?? this.weekHours,
    state: state ?? this.state,
    workDays: workDays ?? this.workDays,
    workStart: workStart ?? this.workStart,
  );
}
