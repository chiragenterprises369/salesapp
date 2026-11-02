import '../json.dart';

/// Live status (D-062, SPEC 29.2). Wire values follow `PRESENCE_STATUSES` of the change #19
/// contract (`schemas/presence.ts`). [busy] only appears when the server sends the coarse
/// `EmployeeStatus` (User.status / UserSummary.status) without the detailed presence.
enum PresenceStatus {
  available('available', 'Available'),
  onCall('on_call', 'On call'),
  meeting('in_meeting', 'In a meeting'),
  breakTime('on_break', 'On break'),
  lunch('lunch', 'Lunch'),
  fieldVisit('field_visit', 'Field visit'),
  away('away', 'Away'),
  busy('busy', 'Busy'),
  offline('offline', 'Offline');

  const PresenceStatus(this.wire, this.label);
  final String wire;
  final String label;

  /// Detailed or coarse wire value. Legacy values: `idle` = available, `break` = on break,
  /// `meeting` = in a meeting.
  static PresenceStatus parse(Object? v) => switch (v) {
        'idle' => available,
        'break' => breakTime,
        'meeting' => meeting,
        _ => PresenceStatus.values.firstWhere((s) => s.wire == v, orElse: () => PresenceStatus.offline),
      };

  /// Detailed presence when the server sent it, else the coarse status.
  static PresenceStatus best(Object? presence, Object? coarse) => presence is String && presence.isNotEmpty ? parse(presence) : parse(coarse);

  /// Statuses an employee picks in the status sheet (ManualPresenceStatus). On call is set by the
  /// phone, Offline after 45 s without a heartbeat.
  static const selfService = [available, breakTime, lunch, meeting, fieldVisit, away, offline];

  bool get isManual => selfService.contains(this);
}

/// Screen the app has open, sent with every heartbeat (`APP_SCREENS`).
const appScreens = {'home', 'leads', 'lead_detail', 'board', 'calls', 'call', 'inbox', 'conversation', 'tasks', 'team_floor', 'attendance', 'reports', 'settings', 'other'};

const screenLabels = {
  'home': 'Home',
  'leads': 'Leads',
  'lead_detail': 'a lead',
  'board': 'the board',
  'calls': 'Calls',
  'call': 'a call',
  'inbox': 'Inbox',
  'conversation': 'a chat',
  'tasks': 'Tasks',
  'team_floor': 'Team Floor',
  'attendance': 'Attendance',
  'reports': 'Reports',
  'settings': 'Settings',
  'other': 'the app',
};

const zoneSourceLabels = {'ble': 'Beacon', 'wifi': 'Office Wi-Fi', 'qr': 'QR scan', 'nfc': 'NFC tag', 'manual': 'Picked by them'};

class AvatarConfig {
  const AvatarConfig({required this.skinTone, required this.hairColor, required this.hairStyle, required this.outfitColor});

  final String skinTone;
  final String hairColor;
  final String hairStyle;
  final String outfitColor;

  static AvatarConfig? parse(Object? raw) {
    if (raw is! Map) return null;
    final j = obj(raw);
    return AvatarConfig(
      skinTone: str(j['skinTone'], '#C68642'),
      hairColor: str(j['hairColor'], '#2B1B12'),
      hairStyle: str(j['hairStyle'], 'short'),
      outfitColor: str(j['outfitColor'], '#4F46E5'),
    );
  }

  Json toJson() => {'skinTone': skinTone, 'hairColor': hairColor, 'hairStyle': hairStyle, 'outfitColor': outfitColor};
}

class UserSummary {
  const UserSummary({required this.id, required this.name, required this.role, required this.status, this.avatar});

  final String id;
  final String name;
  final String role;
  final PresenceStatus status;
  final AvatarConfig? avatar;

  static UserSummary parse(Json j) => UserSummary(
        id: str(j['id']),
        name: str(j['name'], 'Unknown'),
        role: str(j['role'], 'employee'),
        status: PresenceStatus.parse(j['status']),
        avatar: AvatarConfig.parse(j['avatar']),
      );

  static UserSummary? parseOrNull(Object? raw) => raw is Map ? parse(obj(raw)) : null;

  Json toJson() => {'id': id, 'name': name, 'role': role, 'status': status.wire, 'avatar': avatar?.toJson()};
}

/// Where someone is in the office (Presence.location): room or zone level, with the signal that
/// placed them there and how sure the server is.
class ZoneLocation {
  const ZoneLocation({this.zoneId, this.zoneName, required this.source, required this.confidence, this.since, this.at});

  final String? zoneId;
  final String? zoneName;

  /// ble | wifi | qr | nfc | manual
  final String source;

  /// 0..1
  final double confidence;
  final DateTime? since;
  final DateTime? at;

  String get sourceLabel => zoneSourceLabels[source] ?? source;
  String get confidenceLabel => confidence >= 0.8 ? 'high' : (confidence >= 0.5 ? 'medium' : 'low');

  static ZoneLocation? parse(Object? raw) {
    if (raw is! Map) return null;
    final j = obj(raw);
    return ZoneLocation(
      zoneId: strOrNull(j['zoneId']),
      zoneName: strOrNull(j['zoneName']),
      source: str(j['source'], 'manual'),
      confidence: toDoubleOrNull(j['confidence']) ?? 0,
      since: date(j['since']),
      at: date(j['at']),
    );
  }
}

/// What someone is doing right now (PresenceActivity).
class PresenceActivity {
  const PresenceActivity({this.callId, this.callStartedAt, this.leadId, this.leadName, this.client, this.clientActivity, this.note, this.screen});

  final String? callId;
  final DateTime? callStartedAt;
  final String? leadId;
  final String? leadName;
  final String? client;
  final String? clientActivity;
  final String? note;
  final String? screen;

  String? get screenLabel => screen == null ? null : screenLabels[screen] ?? screen;

  static PresenceActivity parse(Object? raw) {
    final j = obj(raw);
    return PresenceActivity(
      callId: strOrNull(j['callId']),
      callStartedAt: date(j['callStartedAt']),
      leadId: strOrNull(j['leadId']),
      leadName: strOrNull(j['leadName']),
      client: strOrNull(j['client']),
      clientActivity: strOrNull(j['clientActivity']),
      note: strOrNull(j['note']),
      screen: strOrNull(j['screen']),
    );
  }
}

/// GET /me/presence, PUT /me/status, POST /me/presence/heartbeat and /zone (MyPresenceSchema).
class MyPresence {
  const MyPresence({
    required this.status,
    required this.version,
    required this.source,
    this.since,
    this.manualStatus,
    this.lastSeenAt,
    this.activity = const PresenceActivity(),
    this.location,
    this.heartbeatIntervalSec = 15,
    this.timeoutSec = 45,
    this.insideWorkingHours = true,
  });

  final PresenceStatus status;
  final int version;
  final String source;
  final DateTime? since;
  final PresenceStatus? manualStatus;
  final DateTime? lastSeenAt;
  final PresenceActivity activity;
  final ZoneLocation? location;
  final int heartbeatIntervalSec;
  final int timeoutSec;
  final bool insideWorkingHours;

  static MyPresence parse(Json j) => MyPresence(
        status: PresenceStatus.best(j['status'], j['employeeStatus']),
        version: toInt(j['version']),
        source: str(j['source'], 'system'),
        since: date(j['since']),
        manualStatus: strOrNull(j['manualStatus']) == null ? null : PresenceStatus.parse(j['manualStatus']),
        lastSeenAt: date(j['lastSeenAt']),
        activity: PresenceActivity.parse(j['activity']),
        location: ZoneLocation.parse(j['location']),
        heartbeatIntervalSec: toInt(j['heartbeatIntervalSec'], 15),
        timeoutSec: toInt(j['timeoutSec'], 45),
        insideWorkingHours: toBool(j['insideWorkingHours'], true),
      );

  MyPresence copyWith({PresenceStatus? status, int? version, ZoneLocation? location}) => MyPresence(
        status: status ?? this.status,
        version: version ?? this.version,
        source: source,
        since: since,
        manualStatus: manualStatus,
        lastSeenAt: lastSeenAt,
        activity: activity,
        location: location ?? this.location,
        heartbeatIntervalSec: heartbeatIntervalSec,
        timeoutSec: timeoutSec,
        insideWorkingHours: insideWorkingHours,
      );
}

/// One working-hours slot "09:30"-"18:30" in the workspace timezone. An end at or before the
/// start runs past midnight and belongs to the start day (overnight slot, b302671).
class TimeSlot {
  const TimeSlot(this.start, this.end);
  final String start;
  final String end;

  int get startMinutes => _minutes(start);
  int get endMinutes => _minutes(end);

  static int _minutes(String hhmm) {
    final parts = hhmm.split(':');
    if (parts.length != 2) return 0;
    return (int.tryParse(parts[0]) ?? 0) * 60 + (int.tryParse(parts[1]) ?? 0);
  }

  Json toJson() => {'start': start, 'end': end};
}

const weekdayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/// Business hours per weekday key (mon..sun); an empty list means closed.
class BusinessHours {
  const BusinessHours(this.days);
  final Map<String, List<TimeSlot>> days;

  static const standard = BusinessHours({
    'mon': [TimeSlot('09:30', '18:30')],
    'tue': [TimeSlot('09:30', '18:30')],
    'wed': [TimeSlot('09:30', '18:30')],
    'thu': [TimeSlot('09:30', '18:30')],
    'fri': [TimeSlot('09:30', '18:30')],
    'sat': [TimeSlot('10:00', '14:00')],
    'sun': [],
  });

  /// Null for a missing or empty object (a user without own hours follows the company's).
  static BusinessHours? parse(Object? raw) {
    if (raw is! Map || raw.isEmpty) return null;
    final j = obj(raw);
    return BusinessHours({
      for (final k in weekdayKeys) k: listOf(j[k], (s) => TimeSlot(str(s['start'], '00:00'), str(s['end'], '00:00'))),
    });
  }

  List<TimeSlot> forWeekday(int isoWeekday) => days[weekdayKeys[(isoWeekday - 1) % 7]] ?? const [];

  Json toJson() => {for (final e in days.entries) e.key: e.value.map((s) => s.toJson()).toList()};
}

class Holiday {
  const Holiday(this.date, this.name);
  final String date; // YYYY-MM-DD
  final String name;
}

/// Company branding (SPEC 29.4, WorkspaceBrandingSchema). `colors.light` / `colors.dark` are
/// already contrast-safe on the server; the app runs the same guard again (harmless when safe).
/// Falls back to the legacy `logoUrl` / `accentColor` mirrors.
class Branding {
  const Branding({this.displayName, this.logoUrl, this.logoDarkUrl, this.brandColor, this.lightColor, this.darkColor, this.chartLight = const [], this.chartDark = const []});

  final String? displayName;
  final String? logoUrl;
  final String? logoDarkUrl;
  final String? brandColor;

  /// Brand colour adjusted for the light and the dark theme (contrast guard).
  final String? lightColor;
  final String? darkColor;
  final List<String> chartLight;
  final List<String> chartDark;

  static Branding parse(Json workspace) {
    final b = obj(workspace['branding']);
    final colors = obj(b['colors']);
    final chart = obj(b['chartColors']);
    return Branding(
      displayName: strOrNull(b['displayName']),
      logoUrl: strOrNull(obj(b['logoLight'])['url']) ?? strOrNull(workspace['logoUrl']),
      logoDarkUrl: strOrNull(obj(b['logoDark'])['url']),
      brandColor: strOrNull(b['brandColor']) ?? strOrNull(colors['base']) ?? strOrNull(workspace['accentColor']),
      lightColor: strOrNull(colors['light']),
      darkColor: strOrNull(colors['dark']),
      chartLight: strings(chart['light']),
      chartDark: strings(chart['dark']),
    );
  }
}

class Workspace {
  const Workspace({
    required this.id,
    required this.name,
    required this.timezone,
    required this.businessHours,
    required this.holidays,
    required this.branding,
    required this.showEmployeeRank,
    required this.features,
    required this.raw,
  });

  final String id;
  final String name;
  final String timezone;
  final BusinessHours businessHours;
  final List<Holiday> holidays;
  final Branding branding;
  final bool showEmployeeRank;
  final Map<String, bool> features;
  final Json raw;

  String get displayName => branding.displayName ?? name;

  /// Feature flag from the plan and the Super Admin switches. Unknown keys count as on so an
  /// older server does not hide screens.
  bool feature(String key) => features[key] ?? true;

  static Workspace parse(Json j) => Workspace(
        id: str(j['id']),
        name: str(j['name'], 'Company'),
        timezone: str(j['timezone'], 'Asia/Kolkata'),
        businessHours: BusinessHours.parse(j['businessHours']) ?? BusinessHours.standard,
        holidays: listOf(j['holidays'], (h) => Holiday(str(h['date']), str(h['name']))),
        branding: Branding.parse(j),
        showEmployeeRank: toBool(j['showEmployeeRank'], true),
        features: obj(j['features']).map((k, v) => MapEntry(k, v == true)),
        raw: j,
      );
}

class User {
  const User({
    required this.summary,
    required this.email,
    this.phone,
    this.title,
    this.teamId,
    this.roleName,
    this.workingHours,
    this.lastSeenAt,
    this.isFieldStaff = false,
  });

  final UserSummary summary;
  final String email;
  final String? phone;
  final String? title;
  final String? teamId;
  final String? roleName;
  final BusinessHours? workingHours;
  final DateTime? lastSeenAt;
  final bool isFieldStaff;

  String get id => summary.id;
  String get name => summary.name;
  String get firstName => name.split(' ').first;

  static User parse(Json j) => User(
        summary: UserSummary.parse(j),
        email: str(j['email']),
        phone: strOrNull(j['phone']),
        title: strOrNull(j['title']),
        teamId: strOrNull(j['teamId']),
        roleName: strOrNull(j['roleName']),
        workingHours: BusinessHours.parse(j['workingHours']),
        lastSeenAt: date(j['lastSeenAt']),
        isFieldStaff: toBool(j['isFieldStaff']),
      );
}

enum ThemePreference { system, light, dark, scheduled }

class UserSettings {
  const UserSettings({
    this.themeMode = ThemePreference.system,
    this.darkFrom = '19:00',
    this.darkTo = '07:00',
    this.pushEnabled = true,
    this.inAppEnabled = true,
    this.emailDigest = 'daily',
    this.reducedMotion = 'system',
  });

  final ThemePreference themeMode;
  final String darkFrom;
  final String darkTo;
  final bool pushEnabled;
  final bool inAppEnabled;
  final String emailDigest;

  /// system | on | off
  final String reducedMotion;

  static UserSettings parse(Object? raw) {
    final j = obj(raw);
    final theme = obj(j['theme']);
    final n = obj(j['notifications']);
    return UserSettings(
      themeMode: ThemePreference.values.firstWhere((m) => m.name == theme['mode'], orElse: () => ThemePreference.system),
      darkFrom: str(theme['darkFrom'], '19:00'),
      darkTo: str(theme['darkTo'], '07:00'),
      pushEnabled: toBool(n['push'], true),
      inAppEnabled: toBool(n['inApp'], true),
      emailDigest: str(n['emailDigest'], 'daily'),
      reducedMotion: str(j['reducedMotion'], 'system'),
    );
  }

  UserSettings copyWith({ThemePreference? themeMode, String? darkFrom, String? darkTo, bool? pushEnabled, bool? inAppEnabled, String? emailDigest, String? reducedMotion}) => UserSettings(
        themeMode: themeMode ?? this.themeMode,
        darkFrom: darkFrom ?? this.darkFrom,
        darkTo: darkTo ?? this.darkTo,
        pushEnabled: pushEnabled ?? this.pushEnabled,
        inAppEnabled: inAppEnabled ?? this.inAppEnabled,
        emailDigest: emailDigest ?? this.emailDigest,
        reducedMotion: reducedMotion ?? this.reducedMotion,
      );
}

/// GET /auth/me (MeResponseSchema).
class Me {
  const Me({
    required this.user,
    required this.roleKind,
    required this.roleName,
    required this.workspace,
    required this.permissions,
    required this.settings,
    required this.raw,
  });

  final User user;
  final String roleKind;
  final String roleName;
  final Workspace workspace;
  final Set<String> permissions;
  final UserSettings settings;
  final Json raw;

  bool can(String permission) => permissions.contains(permission);

  /// Effective working hours: the user's own, else the company's business hours.
  BusinessHours get workingHours => user.workingHours ?? workspace.businessHours;

  Me withSettings(UserSettings s) => Me(user: user, roleKind: roleKind, roleName: roleName, workspace: workspace, permissions: permissions, settings: s, raw: raw);

  static Me parse(Json j) {
    final role = obj(j['role']);
    return Me(
      user: User.parse(obj(j['user'])),
      roleKind: str(role['kind'], 'employee'),
      roleName: str(role['name'], 'Employee'),
      workspace: Workspace.parse(obj(j['workspace'])),
      permissions: strings(j['permissions']).toSet(),
      settings: UserSettings.parse(j['settings']),
      raw: j,
    );
  }
}
