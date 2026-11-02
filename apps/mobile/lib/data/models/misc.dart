import '../json.dart';
import 'lead.dart';
import 'task.dart';
import 'user.dart';

class AppNotification {
  const AppNotification({required this.id, required this.type, required this.title, this.body, this.href, required this.data, this.readAt, required this.createdAt});

  final String id;
  final String type;
  final String title;
  final String? body;
  final String? href;
  final Json data;
  final DateTime? readAt;
  final DateTime createdAt;

  bool get unread => readAt == null;

  static AppNotification parse(Json j) => AppNotification(
        id: str(j['id']),
        type: str(j['type'], 'system'),
        title: str(j['title']),
        body: strOrNull(j['body']),
        href: strOrNull(j['href']),
        data: obj(j['data']),
        readAt: date(j['readAt']),
        createdAt: date(j['createdAt']) ?? DateTime.now().toUtc(),
      );

  AppNotification markRead(DateTime at) =>
      AppNotification(id: id, type: type, title: title, body: body, href: href, data: data, readAt: readAt ?? at, createdAt: createdAt);
}

class NotificationPage {
  const NotificationPage(this.items, this.unreadCount);
  final List<AppNotification> items;
  final int unreadCount;
}

class TargetProgress {
  const TargetProgress({required this.metric, required this.period, required this.target, required this.achieved});
  final String metric;
  final String period;
  final int target;
  final int achieved;

  double get ratio => target <= 0 ? 0 : (achieved / target).clamp(0, 1.5).toDouble();

  String get label => switch (metric) {
        'revenue_inr' => 'Revenue',
        'deals_won' => 'Deals won',
        'calls' => 'Calls',
        'leads_converted' => 'Leads converted',
        _ => metric,
      };

  static TargetProgress parse(Json j) =>
      TargetProgress(metric: str(j['metric']), period: str(j['period']), target: toInt(j['target']), achieved: toInt(j['achieved']));
}

class TodayStats {
  const TodayStats({required this.callsToday, required this.talkSecToday, required this.leadsContactedToday, required this.wonInrThisMonth, this.rank});
  final int callsToday;
  final int talkSecToday;
  final int leadsContactedToday;
  final int wonInrThisMonth;
  final int? rank;

  static TodayStats parse(Json j) => TodayStats(
        callsToday: toInt(j['callsToday']),
        talkSecToday: toInt(j['talkSecToday']),
        leadsContactedToday: toInt(j['leadsContactedToday']),
        wonInrThisMonth: toInt(j['wonInrThisMonth']),
        rank: toIntOrNull(j['rank']),
      );
}

/// GET /me/today (MyTodaySchema).
class MyToday {
  const MyToday({
    required this.tasksDue,
    required this.followUps,
    required this.callsToMake,
    required this.newAssigned,
    required this.targets,
    required this.stats,
    required this.generatedAt,
  });

  final List<Task> tasksDue;
  final List<Lead> followUps;
  final List<Task> callsToMake;
  final List<Lead> newAssigned;
  final List<TargetProgress> targets;
  final TodayStats stats;
  final DateTime generatedAt;

  int get dueCount => tasksDue.length + callsToMake.length;

  static MyToday parse(Json j) => MyToday(
        tasksDue: listOf(j['tasksDue'], Task.parse),
        followUps: listOf(j['followUps'], Lead.parse),
        callsToMake: listOf(j['callsToMake'], Task.parse),
        newAssigned: listOf(j['newAssigned'], Lead.parse),
        targets: listOf(j['targets'], TargetProgress.parse),
        stats: TodayStats.parse(obj(j['stats'])),
        generatedAt: date(j['generatedAt']) ?? DateTime.now().toUtc(),
      );
}

/// Team Floor: one person on the plan.
class FloorPerson {
  const FloorPerson({
    required this.user,
    required this.status,
    required this.deskIndex,
    this.currentLeadName,
    this.activeCallStartedAt,
    required this.callsToday,
    required this.avgTalkSec,
    this.targetPct,
    this.lastSeenAt,
    this.seatId,
  });

  final UserSummary user;
  final PresenceStatus status;
  final int deskIndex;
  final String? currentLeadName;
  final DateTime? activeCallStartedAt;
  final int callsToday;
  final int avgTalkSec;
  final double? targetPct;
  final DateTime? lastSeenAt;
  final String? seatId;

  static FloorPerson parse(Json j) {
    final call = obj(j['activeCall']);
    return FloorPerson(
      user: UserSummary.parse(obj(j['user'])),
      status: PresenceStatus.parse(j['status']),
      deskIndex: toInt(j['deskIndex']),
      currentLeadName: strOrNull(j['currentLeadName']) ?? strOrNull(call['leadName']),
      activeCallStartedAt: date(call['startedAt']),
      callsToday: toInt(j['callsToday']),
      avgTalkSec: toInt(j['avgTalkSec']),
      targetPct: toDoubleOrNull(j['targetPct']),
      lastSeenAt: date(j['lastSeenAt']),
      seatId: strOrNull(j['seatId']),
    );
  }

  FloorPerson withStatus(PresenceStatus s) => FloorPerson(
        user: user,
        status: s,
        deskIndex: deskIndex,
        currentLeadName: s == PresenceStatus.onCall ? currentLeadName : null,
        activeCallStartedAt: s == PresenceStatus.onCall ? (activeCallStartedAt ?? DateTime.now().toUtc()) : null,
        callsToday: callsToday,
        avgTalkSec: avgTalkSec,
        targetPct: targetPct,
        lastSeenAt: lastSeenAt,
        seatId: seatId,
      );
}

/// A zone on the flat plan, in plan units (0..1 of the plan width/height).
class FloorZone {
  const FloorZone({required this.id, required this.kind, required this.label, required this.x, required this.y, required this.w, required this.h});
  final String id;
  final String kind; // work | cabin | meeting | reception | pantry | lounge
  final String label;
  final double x, y, w, h;

  static FloorZone parse(Json j) => FloorZone(
        id: str(j['id']),
        kind: str(j['kind'], 'work'),
        label: str(j['label'] ?? j['name']),
        x: toDoubleOrNull(j['x']) ?? 0,
        y: toDoubleOrNull(j['y']) ?? 0,
        w: toDoubleOrNull(j['w'] ?? j['width']) ?? 0.2,
        h: toDoubleOrNull(j['h'] ?? j['height']) ?? 0.2,
      );
}

class FloorSeat {
  const FloorSeat({required this.id, required this.index, required this.x, required this.y, this.zoneId, this.userId});
  final String id;
  final int index;
  final double x, y;
  final String? zoneId;
  final String? userId;

  static FloorSeat parse(Json j) => FloorSeat(
        id: str(j['id']),
        index: toInt(j['index'] ?? j['deskIndex']),
        x: toDoubleOrNull(j['x']) ?? 0,
        y: toDoubleOrNull(j['y']) ?? 0,
        zoneId: strOrNull(j['zoneId']),
        userId: strOrNull(j['userId']),
      );
}

/// The published floor of the company (seat map placed by the Super Admin on the AI-made file,
/// SPEC 29.5) or the default template. The app draws it flat.
class FloorPlan {
  const FloorPlan({required this.source, required this.name, required this.aspect, required this.zones, required this.seats, this.preparing = false});

  /// published | template
  final String source;
  final String name;

  /// width / height of the plan.
  final double aspect;
  final List<FloorZone> zones;
  final List<FloorSeat> seats;

  /// A custom floor was requested and is being prepared (shows the note).
  final bool preparing;

  bool get isPublished => source == 'published';

  static FloorPlan parse(Json j) => FloorPlan(
        source: str(j['source'], 'template'),
        name: str(j['name'], 'Sales floor'),
        aspect: toDoubleOrNull(j['aspect']) ?? 1.4,
        zones: listOf(j['zones'], FloorZone.parse),
        seats: listOf(j['seats'], FloorSeat.parse),
        preparing: toBool(j['preparing']) || str(j['requestStatus']) == 'in_progress',
      );
}

class TeamFloorSnapshot {
  const TeamFloorSnapshot({required this.people, required this.kpis, required this.generatedAt});
  final List<FloorPerson> people;
  final Map<String, int> kpis;
  final DateTime generatedAt;

  static TeamFloorSnapshot parse(Json j) => TeamFloorSnapshot(
        people: listOf(j['employees'], FloorPerson.parse),
        kpis: obj(j['kpis']).map((k, v) => MapEntry(k, toInt(v))),
        generatedAt: date(j['generatedAt']) ?? DateTime.now().toUtc(),
      );

  TeamFloorSnapshot applyStatus(String userId, PresenceStatus status) => TeamFloorSnapshot(
        people: [for (final p in people) p.user.id == userId ? p.withStatus(status) : p],
        kpis: kpis,
        generatedAt: generatedAt,
      );
}

class AttendanceSession {
  const AttendanceSession({required this.id, required this.checkInAt, this.checkOutAt, this.checkInLat, this.checkInLng, this.checkOutLat, this.checkOutLng, this.address});
  final String id;
  final DateTime checkInAt;
  final DateTime? checkOutAt;
  final double? checkInLat, checkInLng, checkOutLat, checkOutLng;
  final String? address;

  bool get open => checkOutAt == null;

  Duration duration(DateTime now) => (checkOutAt ?? now).difference(checkInAt);

  static AttendanceSession parse(Json j) {
    final inLoc = obj(j['checkInLocation']);
    final outLoc = obj(j['checkOutLocation']);
    return AttendanceSession(
      id: str(j['id']),
      checkInAt: date(j['checkInAt']) ?? DateTime.now().toUtc(),
      checkOutAt: date(j['checkOutAt']),
      checkInLat: toDoubleOrNull(j['checkInLat'] ?? inLoc['lat']),
      checkInLng: toDoubleOrNull(j['checkInLng'] ?? inLoc['lng']),
      checkOutLat: toDoubleOrNull(j['checkOutLat'] ?? outLoc['lat']),
      checkOutLng: toDoubleOrNull(j['checkOutLng'] ?? outLoc['lng']),
      address: strOrNull(j['address']),
    );
  }
}

class LocationFix {
  const LocationFix({required this.lat, required this.lng, required this.accuracy, required this.at, this.speed, this.battery});
  final double lat;
  final double lng;
  final double accuracy;
  final DateTime at;
  final double? speed;
  final int? battery;

  Json toJson() => {
        'lat': lat,
        'lng': lng,
        'accuracyM': accuracy,
        'recordedAt': iso(at),
        if (speed != null) 'speedMps': speed,
        if (battery != null) 'batteryPct': battery,
      };

  static LocationFix parse(Json j) => LocationFix(
        lat: toDoubleOrNull(j['lat']) ?? 0,
        lng: toDoubleOrNull(j['lng']) ?? 0,
        accuracy: toDoubleOrNull(j['accuracyM'] ?? j['accuracy']) ?? 0,
        at: date(j['recordedAt'] ?? j['at']) ?? DateTime.now().toUtc(),
        speed: toDoubleOrNull(j['speedMps']),
        battery: toIntOrNull(j['batteryPct']),
      );
}

class AttendanceDay {
  const AttendanceDay({required this.sessions, required this.fieldStaff, required this.consentGiven, this.trail = const []});
  final List<AttendanceSession> sessions;
  final bool fieldStaff;
  final bool consentGiven;
  final List<LocationFix> trail;

  AttendanceSession? get openSession => sessions.where((s) => s.open).firstOrNull;
  bool get checkedIn => openSession != null;

  Duration total(DateTime now) => sessions.fold(Duration.zero, (sum, s) => sum + s.duration(now));

  static AttendanceDay parse(Json j) => AttendanceDay(
        sessions: listOf(j['sessions'], AttendanceSession.parse),
        fieldStaff: toBool(j['fieldStaff'], true),
        consentGiven: toBool(j['consentGiven']) || j['consentAt'] != null,
        trail: listOf(j['trail'] ?? j['points'], LocationFix.parse),
      );
}

/// GET /app/config: public app configuration (D-058). Firebase options are public app values.
class AppConfig {
  const AppConfig({this.firebase, this.latestVersionName, this.latestVersionCode, this.apkUrl, this.releaseNotes, this.minSupportedVersionCode});

  final Map<String, String>? firebase;
  final String? latestVersionName;
  final int? latestVersionCode;
  final String? apkUrl;
  final String? releaseNotes;
  final int? minSupportedVersionCode;

  bool get pushConfigured {
    final f = firebase;
    return f != null && (f['apiKey'] ?? '').isNotEmpty && (f['appId'] ?? '').isNotEmpty && (f['projectId'] ?? '').isNotEmpty && (f['messagingSenderId'] ?? '').isNotEmpty;
  }

  static AppConfig parse(Json j) {
    final fb = obj(j['firebase'] ?? j['firebaseOptions'] ?? obj(j['push'])['firebase']);
    final rel = obj(j['android'] ?? j['latestRelease'] ?? j['release']);
    final latest = obj(rel['latest']).isNotEmpty ? obj(rel['latest']) : rel;
    return AppConfig(
      firebase: fb.isEmpty ? null : fb.map((k, v) => MapEntry(k, '$v')),
      latestVersionName: strOrNull(latest['versionName']),
      latestVersionCode: toIntOrNull(latest['versionCode']),
      apkUrl: strOrNull(latest['downloadUrl'] ?? latest['url'] ?? latest['apkUrl']),
      releaseNotes: strOrNull(latest['notes'] ?? latest['releaseNotes']),
      minSupportedVersionCode: toIntOrNull(rel['minVersionCode'] ?? j['minVersionCode']),
    );
  }
}

/// My performance: targets, rank and calls per day for the chart.
class Performance {
  const Performance({required this.targets, required this.stats, required this.callsPerDay, this.rank, this.teamSize});
  final List<TargetProgress> targets;
  final TodayStats stats;

  /// Oldest first: (day, calls, connected).
  final List<DayCalls> callsPerDay;
  final int? rank;
  final int? teamSize;
}

class DayCalls {
  const DayCalls(this.day, this.calls, this.connected, this.talkSec);
  final DateTime day;
  final int calls;
  final int connected;
  final int talkSec;
}
