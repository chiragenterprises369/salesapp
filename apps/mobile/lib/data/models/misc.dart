import 'dart:math' as math;

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

// ---------------------------------------------------------------- Team Floor

/// Team Floor: one person (TeamFloorEmployee with the change #19 `presence`).
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
    this.version = 0,
    this.source,
    this.since,
    this.zone,
    this.activity = const PresenceActivity(),
    this.isFieldStaff = false,
    this.checkedIn = false,
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

  /// Presence.version; events at or below it are stale and ignored.
  final int version;
  final String? source;
  final DateTime? since;

  /// Room or zone in the office (BLE, Wi-Fi, QR, NFC or manual), null when unknown.
  final ZoneLocation? zone;
  final PresenceActivity activity;
  final bool isFieldStaff;
  final bool checkedIn;

  static FloorPerson parse(Json j) {
    final call = obj(j['activeCall']);
    final p = obj(j['presence']);
    final activity = PresenceActivity.parse(p['activity']);
    return FloorPerson(
      user: UserSummary.parse(obj(j['user'])),
      status: PresenceStatus.best(p['status'], j['status']),
      deskIndex: toInt(j['deskIndex']),
      currentLeadName: strOrNull(j['currentLeadName']) ?? strOrNull(call['leadName']) ?? activity.leadName,
      activeCallStartedAt: date(call['startedAt']) ?? activity.callStartedAt,
      callsToday: toInt(j['callsToday']),
      avgTalkSec: toInt(j['avgTalkSec']),
      targetPct: toDoubleOrNull(j['targetPct']),
      lastSeenAt: date(p['lastSeenAt']) ?? date(j['lastSeenAt']),
      seatId: strOrNull(p['seatId']) ?? strOrNull(j['seatId']),
      version: toInt(p['version']),
      source: strOrNull(p['source']),
      since: date(p['since']),
      zone: ZoneLocation.parse(p['location']),
      activity: activity,
      isFieldStaff: toBool(p['isFieldStaff']),
      checkedIn: toBool(p['checkedIn']),
    );
  }

  FloorPerson copyWith({PresenceStatus? status, int? version, ZoneLocation? zone, bool clearZone = false, String? leadName, DateTime? callStartedAt, PresenceActivity? activity, DateTime? since}) {
    final s = status ?? this.status;
    return FloorPerson(
      user: user,
      status: s,
      deskIndex: deskIndex,
      currentLeadName: s == PresenceStatus.onCall ? (leadName ?? currentLeadName) : null,
      activeCallStartedAt: s == PresenceStatus.onCall ? (callStartedAt ?? activeCallStartedAt ?? DateTime.now().toUtc()) : null,
      callsToday: callsToday,
      avgTalkSec: avgTalkSec,
      targetPct: targetPct,
      lastSeenAt: lastSeenAt,
      seatId: seatId,
      version: version ?? this.version,
      source: source,
      since: since ?? this.since,
      zone: clearZone ? null : (zone ?? this.zone),
      activity: activity ?? this.activity,
      isFieldStaff: isFieldStaff,
      checkedIn: checkedIn,
    );
  }
}

/// A plan point, normalised to 0..1 of the plan width (x) and depth (y).
class PlanPoint {
  const PlanPoint(this.x, this.y);
  final double x;
  final double y;
}

/// A room or zone on the flat plan.
class FloorZone {
  const FloorZone({required this.id, required this.kind, required this.label, required this.polygon});
  final String id;

  /// work | cabin | meeting | reception | pantry | other
  final String kind;
  final String label;
  final List<PlanPoint> polygon;

  double get minX => polygon.map((p) => p.x).reduce(math.min);
  double get minY => polygon.map((p) => p.y).reduce(math.min);

  static String normaliseKind(String k) => switch (k) {
        'work_area' || 'work' => 'work',
        'cabin' => 'cabin',
        'meeting_room' || 'meeting' => 'meeting',
        'reception' => 'reception',
        'pantry_lounge' || 'pantry' || 'lounge' => 'pantry',
        _ => 'other',
      };
}

class FloorSeat {
  const FloorSeat({required this.id, required this.index, required this.x, required this.y, this.zoneId, this.userId, this.kind = 'desk', this.label});
  final String id;

  /// Desk order (seats without a fixed person are filled in this order).
  final int index;
  final double x, y;
  final String? zoneId;
  final String? userId;

  /// desk | cabin | meeting | lounge | reception
  final String kind;
  final String? label;
}

/// The company's floor drawn flat: the published seat map of the custom floor (from the
/// AI-made file the Super Admin uploaded, SPEC 29.5 and 29.11) or the default template.
class FloorPlan {
  const FloorPlan({required this.source, required this.name, required this.aspect, required this.zones, required this.seats, this.preparing = false, this.requestStatus, this.version});

  /// custom | template
  final String source;
  final String name;

  /// width / depth of the plan.
  final double aspect;
  final List<FloorZone> zones;
  final List<FloorSeat> seats;

  /// A custom floor was requested and is being prepared (shows the note).
  final bool preparing;
  final String? requestStatus;
  final int? version;

  bool get isPublished => source == 'custom';

  FloorZone? zone(String? id) => id == null ? null : zones.where((z) => z.id == id).firstOrNull;

  /// The seat of [person]: the server's seatId, else the person's desk index in desk order.
  FloorSeat? seatFor(FloorPerson person, {Set<String> taken = const {}}) {
    if (person.seatId != null) {
      final s = seats.where((x) => x.id == person.seatId).firstOrNull;
      if (s != null) return s;
    }
    final fixed = seats.where((x) => x.userId == person.user.id).firstOrNull;
    if (fixed != null) return fixed;
    final desks = seats.where((x) => x.userId == null && !taken.contains(x.id)).toList()..sort((a, b) => a.index.compareTo(b.index));
    return person.deskIndex >= 0 && person.deskIndex < desks.length ? desks[person.deskIndex] : null;
  }

  /// GET /team-floor/layout (TeamFloorLayoutSchema): seat map in metres, x/z on the floor.
  static FloorPlan fromLayout(Json j, {Json? template}) {
    final req = obj(j['request']);
    final reqStatus = strOrNull(req['status']);
    final preparing = reqStatus == 'submitted' || reqStatus == 'in_progress';
    final floor = obj(j['floor']);
    final seatMap = obj(floor['seatMap']);
    if (str(j['source']) != 'custom' || listOf(seatMap['seats'], (s) => s).isEmpty) {
      final t = FloorPlan.fromTemplate(template ?? const {});
      return FloorPlan(source: 'template', name: t.name, aspect: t.aspect, zones: t.zones, seats: t.seats, preparing: preparing, requestStatus: reqStatus);
    }
    return FloorPlan.fromSeatMap(seatMap, name: 'Your office', version: toIntOrNull(floor['version'] ?? j['version']), requestStatus: reqStatus);
  }

  /// SeatMapSchema: seats `position [x, y, z]`, zones `polygon [[x, z], ...]` in metres.
  static FloorPlan fromSeatMap(Json m, {String name = 'Your office', int? version, String? requestStatus}) {
    final rawSeats = listOf(m['seats'], (s) => s);
    final rawZones = listOf(m['zones'], (z) => z);
    final xs = <double>[];
    final ys = <double>[];
    List<double> vec(Object? v) => v is List ? v.map((e) => toDoubleOrNull(e) ?? 0).toList() : const [];
    for (final s in rawSeats) {
      final p = vec(s['position']);
      if (p.length >= 3) {
        xs.add(p[0]);
        ys.add(p[2]);
      }
    }
    for (final z in rawZones) {
      for (final pt in (z['polygon'] is List ? z['polygon'] as List : const [])) {
        final p = vec(pt);
        if (p.length >= 2) {
          xs.add(p[0]);
          ys.add(p[1]);
        }
      }
    }
    if (xs.isEmpty) return FloorPlan.fromTemplate(const {});
    const margin = 0.6;
    final minX = xs.reduce(math.min) - margin, maxX = xs.reduce(math.max) + margin;
    final minY = ys.reduce(math.min) - margin, maxY = ys.reduce(math.max) + margin;
    final w = math.max(maxX - minX, 1.0), h = math.max(maxY - minY, 1.0);
    PlanPoint norm(double x, double y) => PlanPoint((x - minX) / w, (y - minY) / h);
    final zones = [
      for (final z in rawZones)
        FloorZone(
          id: str(z['id']),
          kind: FloorZone.normaliseKind(str(z['kind'], 'other')),
          label: str(z['name'] ?? z['label']),
          polygon: [for (final pt in (z['polygon'] as List? ?? const [])) if (vec(pt).length >= 2) norm(vec(pt)[0], vec(pt)[1])],
        ),
    ].where((z) => z.polygon.length >= 3).toList();
    var i = 0;
    final seats = [
      for (final s in rawSeats)
        if (vec(s['position']).length >= 3)
          FloorSeat(
            id: str(s['id']),
            index: i++,
            x: norm(vec(s['position'])[0], vec(s['position'])[2]).x,
            y: norm(vec(s['position'])[0], vec(s['position'])[2]).y,
            zoneId: strOrNull(s['zoneId']),
            userId: strOrNull(s['assignedUserId']),
            kind: str(s['kind'], 'desk'),
            label: strOrNull(s['label']),
          ),
    ];
    return FloorPlan(source: 'custom', name: name, aspect: (w / h).clamp(0.5, 3.0), zones: zones, seats: seats, version: version, requestStatus: requestStatus);
  }

  /// The app's flattened default template: zones as rectangles (x, y, w, h in 0..1).
  static FloorPlan fromTemplate(Json j) {
    final zones = listOf(j['zones'], (z) {
      final x = toDoubleOrNull(z['x']) ?? 0, y = toDoubleOrNull(z['y']) ?? 0, w = toDoubleOrNull(z['w']) ?? 0.2, h = toDoubleOrNull(z['h']) ?? 0.2;
      return FloorZone(
        id: str(z['id']),
        kind: FloorZone.normaliseKind(str(z['kind'], 'work')),
        label: str(z['label'] ?? z['name']),
        polygon: [PlanPoint(x, y), PlanPoint(x + w, y), PlanPoint(x + w, y + h), PlanPoint(x, y + h)],
      );
    });
    final seats = listOf(j['seats'], (s) => FloorSeat(
          id: str(s['id']),
          index: toInt(s['index']),
          x: toDoubleOrNull(s['x']) ?? 0,
          y: toDoubleOrNull(s['y']) ?? 0,
          zoneId: strOrNull(s['zoneId']),
          kind: str(s['kind'], 'desk'),
        ));
    return FloorPlan(source: 'template', name: str(j['name'], 'Sales floor'), aspect: toDoubleOrNull(j['aspect']) ?? 1.25, zones: zones, seats: seats, preparing: toBool(j['preparing']));
  }
}

class TeamFloorSnapshot {
  const TeamFloorSnapshot({required this.people, required this.kpis, required this.generatedAt, this.presenceCounts = const {}, this.floorVersion});
  final List<FloorPerson> people;
  final Map<String, int> kpis;
  final Map<String, int> presenceCounts;
  final DateTime generatedAt;
  final int? floorVersion;

  int get available => presenceCounts['available'] ?? people.where((p) => p.status == PresenceStatus.available).length;
  int get onCall => presenceCounts['on_call'] ?? people.where((p) => p.status == PresenceStatus.onCall).length;
  int get active => people.where((p) => p.status != PresenceStatus.offline).length;

  static TeamFloorSnapshot parse(Json j) => TeamFloorSnapshot(
        people: listOf(j['employees'], FloorPerson.parse),
        kpis: obj(j['kpis']).map((k, v) => MapEntry(k, toInt(v))),
        presenceCounts: obj(j['presenceCounts']).map((k, v) => MapEntry(k, toInt(v))),
        generatedAt: date(j['generatedAt']) ?? DateTime.now().toUtc(),
        floorVersion: toIntOrNull(obj(j['floor'])['version']),
      );

  TeamFloorSnapshot _with(List<FloorPerson> people) =>
      TeamFloorSnapshot(people: people, kpis: kpis, generatedAt: generatedAt, floorVersion: floorVersion);

  /// employee.status_changed. Events whose version is not above the one held are dropped (b302671).
  TeamFloorSnapshot applyStatus(String userId, PresenceStatus status, {int? version, String? leadName, DateTime? at, PresenceActivity? activity}) => _with([
        for (final p in people)
          if (p.user.id == userId && (version == null || version > p.version))
            p.copyWith(status: status, version: version, leadName: leadName, callStartedAt: status == PresenceStatus.onCall ? at : null, activity: activity, since: at)
          else
            p,
      ]);

  /// employee.zone_changed.
  TeamFloorSnapshot applyZone(String userId, ZoneLocation? zone) => _with([
        for (final p in people)
          if (p.user.id == userId) p.copyWith(zone: zone, clearZone: zone == null || zone.zoneId == null) else p,
      ]);
}

// ---------------------------------------------------------------- Attendance

class GeoPoint {
  const GeoPoint(this.lat, this.lng, [this.accuracy]);
  final double lat;
  final double lng;
  final double? accuracy;

  static GeoPoint? parse(Object? raw) {
    if (raw is! Map) return null;
    final j = obj(raw);
    final lat = toDoubleOrNull(j['lat']);
    final lng = toDoubleOrNull(j['lng']);
    return lat == null || lng == null ? null : GeoPoint(lat, lng, toDoubleOrNull(j['accuracy']));
  }
}

/// AttendanceSessionSchema.
class AttendanceSession {
  const AttendanceSession({required this.id, required this.checkInAt, this.checkOutAt, this.checkIn, this.checkOut, this.checkOutReason, this.workedMin = 0, this.pointCount = 0});
  final String id;
  final DateTime checkInAt;
  final DateTime? checkOutAt;
  final GeoPoint? checkIn;
  final GeoPoint? checkOut;

  /// manual | end_of_day | admin
  final String? checkOutReason;
  final int workedMin;
  final int pointCount;

  bool get open => checkOutAt == null;

  Duration duration(DateTime now) => (checkOutAt ?? now).difference(checkInAt);

  String? get closedNote => switch (checkOutReason) {
        'end_of_day' => 'Closed at the end of working hours',
        'admin' => 'Closed by your admin',
        _ => null,
      };

  static AttendanceSession parse(Json j) => AttendanceSession(
        id: str(j['id']),
        checkInAt: date(j['checkInAt']) ?? DateTime.now().toUtc(),
        checkOutAt: date(j['checkOutAt']),
        checkIn: GeoPoint.parse(j['checkIn']),
        checkOut: GeoPoint.parse(j['checkOut']),
        checkOutReason: strOrNull(j['checkOutReason']),
        workedMin: toInt(j['workedMin']),
        pointCount: toInt(j['pointCount']),
      );
}

class LocationFix {
  const LocationFix({required this.lat, required this.lng, required this.accuracy, required this.at, this.speed, this.heading, this.battery, this.isMock = false});
  final double lat;
  final double lng;
  final double accuracy;
  final DateTime at;
  final double? speed;
  final double? heading;
  final int? battery;
  final bool isMock;

  /// One point of LocationBatchSchema.
  Json toJson() => {
        'lat': lat,
        'lng': lng,
        'accuracy': accuracy,
        'at': iso(at),
        'speed': ?speed,
        'heading': ?heading,
        'battery': ?battery,
        if (isMock) 'isMock': true,
      };

  static LocationFix parse(Json j) => LocationFix(
        lat: toDoubleOrNull(j['lat']) ?? 0,
        lng: toDoubleOrNull(j['lng']) ?? 0,
        accuracy: toDoubleOrNull(j['accuracy']) ?? 0,
        at: date(j['at']) ?? DateTime.now().toUtc(),
        speed: toDoubleOrNull(j['speed']),
        heading: toDoubleOrNull(j['heading']),
        battery: toIntOrNull(j['battery']),
        isMock: toBool(j['isMock']),
      );
}

/// GET /me/attendance/today (MyAttendanceTodaySchema) plus this phone's own trail of today.
class AttendanceDay {
  const AttendanceDay({
    required this.sessions,
    required this.fieldStaff,
    required this.consentGiven,
    this.consentVersion,
    this.currentConsentVersion = '2026-11-v1',
    this.trackingEnabled = true,
    this.insideWorkingHours = true,
    this.trackingActive = false,
    this.locationIntervalSec = 120,
    this.workingHours = const [],
    this.trail = const [],
  });

  final List<AttendanceSession> sessions;
  final bool fieldStaff;

  /// Consent accepted for the current version (TRACKING_CONSENT_VERSION).
  final bool consentGiven;
  final String? consentVersion;
  final String currentConsentVersion;

  /// Feature flag `field_tracking` for the company.
  final bool trackingEnabled;
  final bool insideWorkingHours;

  /// Server says location updates are accepted right now (checked in, in hours, consent).
  final bool trackingActive;
  final int locationIntervalSec;
  final List<TimeSlot> workingHours;

  /// Points recorded on this phone today (the server keeps the full route).
  final List<LocationFix> trail;

  AttendanceSession? get openSession => sessions.where((s) => s.open).firstOrNull;
  bool get checkedIn => openSession != null;
  int get pointCount => sessions.fold(0, (s, x) => s + x.pointCount);

  Duration total(DateTime now) => sessions.fold(Duration.zero, (sum, s) => sum + s.duration(now));

  AttendanceDay withTrail(List<LocationFix> t) => AttendanceDay(
        sessions: sessions,
        fieldStaff: fieldStaff,
        consentGiven: consentGiven,
        consentVersion: consentVersion,
        currentConsentVersion: currentConsentVersion,
        trackingEnabled: trackingEnabled,
        insideWorkingHours: insideWorkingHours,
        trackingActive: trackingActive,
        locationIntervalSec: locationIntervalSec,
        workingHours: workingHours,
        trail: t,
      );

  static AttendanceDay parse(Json j) {
    final consent = obj(j['consent']);
    final current = str(consent['currentVersion'], '2026-11-v1');
    final sessions = listOf(j['sessions'], AttendanceSession.parse);
    final session = j['session'] is Map ? AttendanceSession.parse(obj(j['session'])) : null;
    if (session != null && !sessions.any((s) => s.id == session.id)) sessions.add(session);
    sessions.sort((a, b) => a.checkInAt.compareTo(b.checkInAt));
    return AttendanceDay(
      sessions: sessions,
      fieldStaff: toBool(j['isFieldStaff']),
      consentGiven: toBool(consent['accepted']) && str(consent['version']) == current,
      consentVersion: strOrNull(consent['version']),
      currentConsentVersion: current,
      trackingEnabled: toBool(j['trackingEnabled'], true),
      insideWorkingHours: toBool(j['insideWorkingHours'], true),
      trackingActive: toBool(j['trackingActive']),
      locationIntervalSec: toInt(j['locationIntervalSec'], 120),
      workingHours: listOf(j['workingHours'], (s) => TimeSlot(str(s['start'], '00:00'), str(s['end'], '00:00'))),
    );
  }
}

/// GET /app/config (AppConfigSchema): public Firebase options (D-058) and the latest APK.
class AppConfig {
  const AppConfig({this.firebase, this.latestVersionName, this.latestVersionCode, this.apkUrl, this.releaseNotes, this.apkSize, this.apkSha256, this.releasedAt, this.minSupportedVersionCode, this.serverTime});

  final Map<String, String>? firebase;
  final String? latestVersionName;
  final int? latestVersionCode;
  final String? apkUrl;
  final String? releaseNotes;
  final int? apkSize;
  final String? apkSha256;
  final DateTime? releasedAt;

  /// Versions below this must update before they can be used.
  final int? minSupportedVersionCode;
  final DateTime? serverTime;

  bool get pushConfigured {
    final f = firebase;
    return f != null && (f['apiKey'] ?? '').isNotEmpty && (f['appId'] ?? '').isNotEmpty && (f['projectId'] ?? '').isNotEmpty && (f['messagingSenderId'] ?? '').isNotEmpty;
  }

  bool updateAvailable(int currentCode) => latestVersionCode != null && latestVersionCode! > currentCode;
  bool mustUpdate(int currentCode) => minSupportedVersionCode != null && currentCode < minSupportedVersionCode!;

  static AppConfig parse(Json j) {
    final fb = obj(j['firebase']);
    final android = obj(j['android']);
    final latest = obj(android['latest']);
    return AppConfig(
      firebase: fb.isEmpty ? null : {for (final e in fb.entries) if (e.value != null) e.key: '${e.value}'},
      latestVersionName: strOrNull(latest['versionName']),
      latestVersionCode: toIntOrNull(latest['versionCode']),
      apkUrl: strOrNull(latest['downloadUrl']),
      releaseNotes: strOrNull(latest['notes']),
      apkSize: toIntOrNull(latest['size']),
      apkSha256: strOrNull(latest['sha256']),
      releasedAt: date(latest['createdAt']),
      minSupportedVersionCode: toIntOrNull(android['minSupportedVersionCode']),
      serverTime: date(j['serverTime']),
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

/// POST /me/devices result: the id is sent as `deviceId` with calls, attendance and locations.
class RegisteredDevice {
  const RegisteredDevice({required this.id, required this.installationId, required this.hasPushToken});
  final String id;
  final String installationId;
  final bool hasPushToken;

  static RegisteredDevice parse(Json j) => RegisteredDevice(id: str(j['id']), installationId: str(j['installationId']), hasPushToken: toBool(j['hasPushToken']));
}
