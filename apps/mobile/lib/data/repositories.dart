import '../core/calls/call_matching.dart';
import 'models.dart';

/// Repository interfaces, one per feature. `Api*Repository` talks to the REST API (with the
/// offline cache for Today, leads and tasks); `Fake*Repository` (lib/demo) backs tests, goldens and
/// the explicit "Demo mode" on the login screen.

/// Data plus where it came from (network or the offline cache).
class Fetched<T> {
  const Fetched(this.data, {this.fromCache = false, this.savedAt});
  final T data;
  final bool fromCache;
  final DateTime? savedAt;
}

abstract class AuthRepository {
  Future<Me> signIn(String email, String password);
  Future<Me?> restore();
  Future<Me> me();
  Future<void> signOut();
}

abstract class TodayRepository {
  Future<Fetched<MyToday>> today();
}

abstract class LeadsRepository {
  Future<Fetched<Paged<Lead>>> list(LeadFilters filters, {String? cursor});
  Future<Lead> get(String id);
  Future<List<Activity>> timeline(String id);
  Future<Activity> addNote(String id, String body);
  Future<Lead> moveStage(Lead lead, String stageId);
  Future<List<Pipeline>> pipelines();
  Future<List<Task>> tasksFor(String leadId);
}

abstract class TasksRepository {
  Future<Fetched<List<Task>>> myTasks();

  /// Marks a task done or open again (undo). Queued when offline.
  Future<Task> setDone(Task task, bool done);
  Future<Task> snooze(Task task, DateTime until);
}

/// POST /me/calls/active (ActiveCallEventSchema): live "On call" from the phone state.
class ActiveCallReport {
  const ActiveCallReport.started({required this.clientCallId, required this.at, required this.direction, this.number, this.leadId, this.deviceId}) : state = 'started';
  const ActiveCallReport.ended({required this.clientCallId, required this.at})
      : state = 'ended',
        direction = null,
        number = null,
        leadId = null,
        deviceId = null;

  /// started | ended
  final String state;
  final String clientCallId;
  final DateTime at;
  final String? number;
  final String? direction;
  final String? leadId;
  final String? deviceId;

  Map<String, dynamic> toJson() => state == 'started'
      ? {
          'event': 'started',
          'clientCallId': clientCallId,
          'direction': direction ?? 'outbound',
          'phone': devicePhone(number),
          'startedAt': at.toUtc().toIso8601String(),
          'leadId': ?leadId,
          'deviceId': ?deviceId,
        }
      : {'event': 'ended', 'clientCallId': clientCallId, 'endedAt': at.toUtc().toIso8601String()};
}

abstract class CallsRepository {
  Future<Paged<Call>> recent({String? cursor});
  Future<Call> setOutcome(String callId, {String? outcome, String? notes});

  /// POST /me/calls/active (live "On call" on the Team Floor).
  Future<void> reportActive(ActiveCallReport report);
}

enum InboxFilter { all, unread, needsReply, closed }

abstract class InboxRepository {
  Future<List<Conversation>> conversations({InboxFilter filter = InboxFilter.all, String q = ''});
  Future<Conversation> conversation(String id);
  Future<List<Message>> messages(String conversationId);
  Future<Message> sendText(String conversationId, String body);
  Future<Message> sendTemplate(String conversationId, MessageTemplate template, Map<String, String> variables);
  Future<void> markRead(String conversationId);
  Future<List<MessageTemplate>> templates();
  Future<List<QuickReply>> quickReplies();
}

abstract class TeamFloorRepository {
  Future<TeamFloorSnapshot> snapshot();

  /// GET /team-floor/layout: the published seat map, or the default template.
  Future<FloorPlan> plan();
}

/// Heartbeat body (PresenceHeartbeatSchema).
class HeartbeatBody {
  const HeartbeatBody({required this.client, required this.activity, this.screen, this.appState, this.deviceId, this.currentLeadId, this.zone});

  /// android | web
  final String client;

  /// active | idle | hidden
  final String activity;
  final String? screen;

  /// foreground | background (Android)
  final String? appState;
  final String? deviceId;
  final String? currentLeadId;
  final ZoneSignal? zone;

  Map<String, dynamic> toJson() => {
        'client': client,
        'activity': activity,
        if (screen != null && appScreens.contains(screen)) 'screen': screen,
        'appState': ?appState,
        if (deviceId != null && deviceId!.length <= 64) 'deviceId': deviceId,
        'currentLeadId': ?currentLeadId,
        if (zone != null) 'zone': zone!.toJson(),
      };
}

/// One office zone observation (ZoneSignalSchema): BLE beacons, Wi-Fi access points, a QR/NFC
/// marker token, or a zone the employee picked.
class ZoneSignal {
  const ZoneSignal({required this.source, required this.at, this.beacons = const [], this.wifi = const [], this.markerToken, this.zoneId});

  /// ble | wifi | qr | nfc | manual
  final String source;
  final DateTime at;
  final List<BeaconReading> beacons;
  final List<WifiReading> wifi;
  final String? markerToken;
  final String? zoneId;

  Map<String, dynamic> toJson() => {
        'source': source,
        'at': at.toUtc().toIso8601String(),
        if (beacons.isNotEmpty) 'beacons': [for (final b in beacons.take(30)) b.toJson()],
        if (wifi.isNotEmpty) 'wifi': [for (final w in wifi.take(40)) w.toJson()],
        'markerToken': ?markerToken,
        'zoneId': ?zoneId,
      };
}

class BeaconReading {
  const BeaconReading({required this.uuid, required this.major, required this.minor, required this.rssi});
  final String uuid;
  final int major;
  final int minor;
  final int rssi;

  Map<String, dynamic> toJson() => {'uuid': uuid.toLowerCase(), 'major': major.clamp(0, 65535), 'minor': minor.clamp(0, 65535), 'rssi': rssi.clamp(-127, 0)};

  static BeaconReading parse(Map<String, dynamic> j) =>
      BeaconReading(uuid: '${j['uuid']}', major: toInt(j['major']), minor: toInt(j['minor']), rssi: toInt(j['rssi'], -100));
}

class WifiReading {
  const WifiReading({required this.bssid, required this.rssi, this.ssid});
  final String bssid;
  final int rssi;
  final String? ssid;

  Map<String, dynamic> toJson() => {'bssid': bssid.toLowerCase(), 'rssi': rssi.clamp(-127, 0)};

  static WifiReading parse(Map<String, dynamic> j) => WifiReading(bssid: '${j['bssid']}', rssi: toInt(j['rssi'], -100), ssid: strOrNull(j['ssid']));
}

abstract class PresenceRepository {
  Future<MyPresence> get();

  /// PUT /me/status: a manual status (ManualPresenceStatus) with an optional note.
  Future<MyPresence> setStatus(PresenceStatus status, {String? note});
  Future<MyPresence> heartbeat(HeartbeatBody body);
  Future<MyPresence> zone(ZoneSignal signal);
}

abstract class AttendanceRepository {
  Future<AttendanceDay> today();

  /// PUT /me/tracking-consent { accepted, version }.
  Future<void> setConsent({required bool accepted, required String version});

  /// Check-in and check-out need a GPS fix (the server requires lat and lng).
  Future<AttendanceSession> checkIn(LocationFix at);
  Future<AttendanceSession> checkOut(LocationFix at);
}

class OutsideWorkingHours implements Exception {
  const OutsideWorkingHours();
}

abstract class AccountRepository {
  Future<Me> updateProfile({String? name, String? phone, String? title});
  Future<UserSettings> updateSettings({ThemePreference? theme, String? darkFrom, String? darkTo, bool? push, bool? inApp, String? emailDigest, String? reducedMotion});
  Future<NotificationPage> notifications();
  Future<void> markNotificationsRead({List<String>? ids});
  Future<AppConfig> appConfig();

  /// POST /me/devices (DeviceRegisterSchema). Called after every sign-in, with or without push.
  Future<RegisteredDevice> registerDevice({
    required String installationId,
    required String platform,
    String? fcmToken,
    required String appVersion,
    int? appBuild,
    String? model,
    String? osVersion,
  });
  Future<Performance> performance();
}
