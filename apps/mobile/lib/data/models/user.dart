import '../json.dart';

/// Presence as the server reports it (SPEC 29.2). Wire values follow `EMPLOYEE_STATUSES` plus the
/// self-set statuses of change #19 (break, lunch, meeting, field visit).
enum PresenceStatus {
  available('idle', 'Available'),
  onCall('on_call', 'On call'),
  busy('busy', 'Busy'),
  breakTime('break', 'Break'),
  lunch('lunch', 'Lunch'),
  meeting('meeting', 'Meeting'),
  fieldVisit('field_visit', 'Field visit'),
  away('away', 'Away'),
  offline('offline', 'Offline');

  const PresenceStatus(this.wire, this.label);
  final String wire;
  final String label;

  static PresenceStatus parse(Object? v) =>
      PresenceStatus.values.firstWhere((s) => s.wire == v, orElse: () => PresenceStatus.offline);

  /// Statuses an employee picks in the status sheet. On call and Busy are set by the system.
  static const selfService = [available, breakTime, lunch, meeting, fieldVisit, offline];
}

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

/// One working-hours slot "09:30"-"18:30" in the workspace timezone.
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

  static BusinessHours? parse(Object? raw) {
    if (raw is! Map) return null;
    final j = obj(raw);
    return BusinessHours({
      for (final k in weekdayKeys)
        k: listOf(j[k], (s) => TimeSlot(str(s['start'], '00:00'), str(s['end'], '00:00'))),
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

/// Company branding (SPEC 29.4). Falls back to the classic fields of WorkspaceSchema.
class Branding {
  const Branding({this.displayName, this.logoUrl, this.logoDarkUrl, this.brandColor});

  final String? displayName;
  final String? logoUrl;
  final String? logoDarkUrl;
  final String? brandColor;

  static Branding parse(Json workspace) {
    final b = obj(workspace['branding']);
    return Branding(
      displayName: strOrNull(b['displayName']) ?? strOrNull(workspace['displayName']),
      logoUrl: strOrNull(b['logoLightUrl']) ?? strOrNull(b['logoUrl']) ?? strOrNull(workspace['logoUrl']),
      logoDarkUrl: strOrNull(b['logoDarkUrl']) ?? strOrNull(workspace['logoDarkUrl']),
      brandColor: strOrNull(b['brandColor']) ?? strOrNull(workspace['brandColor']) ?? strOrNull(workspace['accentColor']),
    );
  }

  Json toJson() => {'displayName': displayName, 'logoLightUrl': logoUrl, 'logoDarkUrl': logoDarkUrl, 'brandColor': brandColor};
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
    this.workingHours,
    this.lastSeenAt,
    this.isFieldStaff = false,
  });

  final UserSummary summary;
  final String email;
  final String? phone;
  final String? title;
  final String? teamId;
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
        workingHours: BusinessHours.parse(j['workingHours']),
        lastSeenAt: date(j['lastSeenAt']),
        isFieldStaff: toBool(j['isFieldStaff']) || toBool(obj(j['attendance'])['fieldStaff']),
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

  UserSettings copyWith({ThemePreference? themeMode, bool? pushEnabled, bool? inAppEnabled, String? emailDigest}) => UserSettings(
        themeMode: themeMode ?? this.themeMode,
        darkFrom: darkFrom,
        darkTo: darkTo,
        pushEnabled: pushEnabled ?? this.pushEnabled,
        inAppEnabled: inAppEnabled ?? this.inAppEnabled,
        emailDigest: emailDigest ?? this.emailDigest,
        reducedMotion: reducedMotion,
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
