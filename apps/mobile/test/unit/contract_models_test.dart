import 'package:flutter_test/flutter_test.dart';
import 'package:vistar_employee/core/calls/call_matching.dart';
import 'package:vistar_employee/core/presence/presence_loop.dart';
import 'package:vistar_employee/core/time/working_hours.dart';
import 'package:vistar_employee/core/time/zoned.dart';
import 'package:vistar_employee/data/models.dart';
import 'package:vistar_employee/data/repositories.dart';

/// Parsing and request bodies against the change #19 contracts (OpenAPI on agent/backend-core).
void main() {
  setUpAll(ensureTimeZones);

  group('presence', () {
    test('detailed status wins over the coarse one, legacy values map', () {
      expect(PresenceStatus.best('in_meeting', 'busy'), PresenceStatus.meeting);
      expect(PresenceStatus.best(null, 'idle'), PresenceStatus.available);
      expect(PresenceStatus.parse('on_break'), PresenceStatus.breakTime);
      expect(PresenceStatus.parse('break'), PresenceStatus.breakTime);
      expect(PresenceStatus.parse('nonsense'), PresenceStatus.offline);
    });

    test('manual statuses are exactly ManualPresenceStatus', () {
      expect(PresenceStatus.selfService.map((s) => s.wire).toSet(), {'available', 'in_meeting', 'on_break', 'lunch', 'field_visit', 'away', 'offline'});
    });

    test('MyPresence parses zone, screen and version', () {
      final p = MyPresence.parse({
        'userId': 'u1',
        'status': 'available',
        'version': 7,
        'employeeStatus': 'idle',
        'source': 'heartbeat',
        'since': '2026-11-03T05:00:00Z',
        'manualStatus': null,
        'activity': {'client': 'android', 'clientActivity': 'active', 'screen': 'leads'},
        'location': {'zoneId': 'meet', 'zoneName': 'Meeting room', 'source': 'ble', 'confidence': 0.9, 'since': '2026-11-03T05:00:00Z', 'at': '2026-11-03T05:01:00Z'},
        'heartbeatIntervalSec': 15,
        'timeoutSec': 45,
        'insideWorkingHours': true,
      });
      expect(p.version, 7);
      expect(p.activity.screen, 'leads');
      expect(p.location!.zoneName, 'Meeting room');
      expect(p.location!.confidenceLabel, 'high');
    });

    test('snapshot drops status events that are not newer', () {
      final snap = TeamFloorSnapshot.parse({
        'kpis': {},
        'employees': [
          {
            'user': {'id': 'u1', 'name': 'Priya Sharma', 'role': 'employee', 'status': 'idle'},
            'status': 'idle',
            'deskIndex': 0,
            'callsToday': 3,
            'avgTalkSec': 60,
            'presence': {'status': 'available', 'version': 5, 'activity': {}},
          },
        ],
        'generatedAt': '2026-11-03T05:00:00Z',
      });
      expect(snap.applyStatus('u1', PresenceStatus.onCall, version: 5).people.first.status, PresenceStatus.available);
      final newer = snap.applyStatus('u1', PresenceStatus.onCall, version: 6);
      expect(newer.people.first.status, PresenceStatus.onCall);
      expect(newer.people.first.version, 6);
    });
  });

  group('requests', () {
    test('heartbeat body follows PresenceHeartbeatSchema', () {
      final body = HeartbeatBody(
        client: 'android',
        activity: 'active',
        screen: 'lead_detail',
        appState: 'foreground',
        deviceId: 'd1',
        zone: ZoneSignal(source: 'ble', at: DateTime.utc(2026, 11, 3), beacons: const [BeaconReading(uuid: 'F7826DA6-4FA2-4E98-8024-BC5B71E0893E', major: 1, minor: 2, rssi: -60)]),
      ).toJson();
      expect(body['screen'], 'lead_detail');
      expect(body['zone']['beacons'][0]['uuid'], 'f7826da6-4fa2-4e98-8024-bc5b71e0893e');
      expect(const HeartbeatBody(client: 'web', activity: 'idle', screen: 'unknown').toJson().containsKey('screen'), isFalse);
    });

    test('active call events follow ActiveCallEventSchema', () {
      final started = ActiveCallReport.started(clientCallId: 'sim-abc-1', at: DateTime.utc(2026, 11, 3, 5), direction: 'outbound', number: '98450 12345').toJson();
      expect(started, {'event': 'started', 'clientCallId': 'sim-abc-1', 'direction': 'outbound', 'phone': '+919845012345', 'startedAt': '2026-11-03T05:00:00.000Z'});
      expect(ActiveCallReport.ended(clientCallId: 'sim-abc-1', at: DateTime.utc(2026, 11, 3, 5, 2)).toJson().keys, ['event', 'clientCallId', 'endedAt']);
    });

    test('location points follow LocationBatchSchema', () {
      final j = LocationFix(lat: 19.1, lng: 72.8, accuracy: 12, at: DateTime.utc(2026, 11, 3, 6), battery: 80).toJson();
      expect(j.keys.toSet(), {'lat', 'lng', 'accuracy', 'at', 'battery'});
    });
  });

  group('device call log', () {
    final call = ObservedCall(startedAt: DateTime.utc(2026, 11, 3, 5), clientCallId: 'sim-abc-1', number: '+919845012345', leadId: 'lead-1')
      ..endedAt = DateTime.utc(2026, 11, 3, 5, 3)
      ..reportedStart = true;
    const matcher = CallLogMatcher();

    test('outgoing call with talk time is connected and keeps the live clientCallId', () {
      final entry = DeviceCallLogEntry(id: '881', number: '09845012345', type: 'outgoing', date: DateTime.utc(2026, 11, 3, 5, 0, 2), durationSec: 154);
      final r = matcher.toRecord(matcher.match([entry], call), call, installId: 'inst')!;
      expect(r.toJson()['deviceCallId'], 'inst:log:881');
      expect(r.toJson()['clientCallId'], 'sim-abc-1');
      expect(r.toJson()['result'], 'connected');
      expect(r.toJson()['durationSec'], 154);
    });

    test('outgoing call with 0 s is no_answer', () {
      final entry = DeviceCallLogEntry(id: '882', number: '+919845012345', type: 'outgoing', date: DateTime.utc(2026, 11, 3, 5), durationSec: 0);
      expect(matcher.toRecord(entry, call, installId: 'inst')!.result, 'no_answer');
    });

    test('no call-log row: outgoing is not invented, unanswered incoming is missed', () {
      expect(matcher.toRecord(null, call, installId: 'inst'), isNull);
      final ring = ObservedCall(startedAt: DateTime.utc(2026, 11, 3, 5), clientCallId: 'sim-abc-2', direction: 'inbound')..endedAt = DateTime.utc(2026, 11, 3, 5, 0, 20);
      final r = matcher.toRecord(null, ring, installId: 'inst')!;
      expect(r.result, 'missed');
      expect(r.toJson()['phone'], '');
      expect(r.toJson().containsKey('clientCallId'), isFalse);
    });
  });

  group('floor', () {
    test('layout_json seat map (metres) becomes a normalised flat plan', () {
      final plan = FloorPlan.fromLayout({
        'source': 'custom',
        'templateId': 'small',
        'floorAssetId': 'f1',
        'version': 2,
        'floor': {
          'id': 'f1',
          'version': 2,
          'format': 'layout_json',
          'seatMap': {
            'schemaVersion': 1,
            'units': 'm',
            'scale': 1,
            'origin': [0, 0, 0],
            'seats': [
              {'id': 'd1', 'kind': 'desk', 'position': [2, 0, 2], 'rotation': 0, 'zoneId': 'work'},
              {'id': 'c1', 'kind': 'cabin', 'position': [10, 0, 2], 'rotation': 0, 'zoneId': 'cab', 'assignedUserId': 'u9'},
            ],
            'zones': [
              {'id': 'work', 'name': 'Work area', 'kind': 'work_area', 'polygon': [[0, 0], [8, 0], [8, 6], [0, 6]]},
              {'id': 'cab', 'name': 'Cabin', 'kind': 'cabin', 'polygon': [[8, 0], [12, 0], [12, 4], [8, 4]]},
            ],
          },
        },
        'request': null,
      });
      expect(plan.isPublished, isTrue);
      expect(plan.zones.map((z) => z.kind), ['work', 'cabin']);
      expect(plan.seats.every((s) => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1), isTrue);
      expect(plan.seats.last.userId, 'u9');
      expect(plan.aspect, greaterThan(1));
    });

    test('template layout with a pending request shows "being prepared"', () {
      final plan = FloorPlan.fromLayout({'source': 'template', 'templateId': 'small', 'floor': null, 'request': {'id': 'r1', 'status': 'in_progress'}}, template: const {
        'zones': [
          {'id': 'work', 'kind': 'work_area', 'label': 'Work area', 'x': 0, 'y': 0, 'w': 1, 'h': 1},
        ],
        'seats': [
          {'id': 's0', 'index': 0, 'x': 0.5, 'y': 0.5, 'zoneId': 'work'},
        ],
      });
      expect(plan.isPublished, isFalse);
      expect(plan.preparing, isTrue);
    });
  });

  group('attendance and app config', () {
    test('consent counts only for the current version', () {
      final d = AttendanceDay.parse({
        'isFieldStaff': true,
        'trackingEnabled': true,
        'consent': {'accepted': true, 'version': '2026-10-v0', 'at': null, 'currentVersion': '2026-11-v1'},
        'workingHours': [],
        'insideWorkingHours': true,
        'session': null,
        'sessions': [],
        'trackingActive': false,
        'locationIntervalSec': 120,
      });
      expect(d.consentGiven, isFalse);
      expect(d.currentConsentVersion, '2026-11-v1');
    });

    test('app config: update and forced update', () {
      final c = AppConfig.parse({
        'firebase': null,
        'android': {
          'packageName': 'app.vistar.employee',
          'latest': {'versionName': '1.1.0', 'versionCode': 3, 'notes': null, 'size': 1, 'sha256': 'x', 'createdAt': '2026-11-02T10:00:00Z', 'downloadUrl': 'http://localhost:4000/api/v1/app/android/latest'},
          'minSupportedVersionCode': 2,
        },
        'serverTime': '2026-11-03T05:00:00Z',
      });
      expect(c.pushConfigured, isFalse);
      expect(c.updateAvailable(1), isTrue);
      expect(c.mustUpdate(1), isTrue);
      expect(c.mustUpdate(2), isFalse);
    });
  });

  group('working hours and screens', () {
    test('overnight slot belongs to the start day', () {
      final h = WorkingHours(
        hours: const BusinessHours({'mon': [TimeSlot('22:00', '06:00')], 'tue': [], 'wed': [], 'thu': [], 'fri': [], 'sat': [], 'sun': []}),
        holidays: const [],
        timezone: 'Asia/Kolkata',
      );
      // Monday 23:30 IST and Tuesday 02:00 IST are inside; Tuesday 07:00 IST is not.
      expect(h.isWithin(DateTime.utc(2026, 11, 2, 18, 0)), isTrue);
      expect(h.isWithin(DateTime.utc(2026, 11, 2, 20, 30)), isTrue);
      expect(h.isWithin(DateTime.utc(2026, 11, 3, 1, 30)), isFalse);
    });

    test('routes map to APP_SCREENS', () {
      expect(screenForPath('/today'), 'home');
      expect(screenForPath('/leads/abc'), 'lead_detail');
      expect(screenForPath('/inbox/c1'), 'conversation');
      expect(screenForPath('/team-floor'), 'team_floor');
      expect(screenForPath('/performance'), 'reports');
      expect(appScreens.containsAll(['/today', '/leads', '/calls', '/inbox', '/tasks', '/attendance', '/more'].map(screenForPath)), isTrue);
    });

    test('zone pick: beacons beat Wi-Fi', () {
      final at = DateTime.utc(2026, 11, 3);
      final s = pickZoneSignal(beacons: const [BeaconReading(uuid: 'f7826da6-4fa2-4e98-8024-bc5b71e0893e', major: 1, minor: 1, rssi: -70)], wifi: const [WifiReading(bssid: 'aa:bb:cc:dd:ee:ff', rssi: -40)], at: at);
      expect(s!.source, 'ble');
      expect(pickZoneSignal(beacons: const [], wifi: const [WifiReading(bssid: 'aa:bb:cc:dd:ee:ff', rssi: -40)], at: at)!.source, 'wifi');
      expect(pickZoneSignal(beacons: const [], wifi: const [], at: at), isNull);
    });
  });
}
