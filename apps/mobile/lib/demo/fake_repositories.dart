import 'dart:async';

import '../core/api/api_error.dart';
import '../core/offline/write_queue.dart';
import '../data/api/api_repositories.dart' show buildPerformance, defaultFloorTemplate;
import '../data/models.dart';
import '../data/repositories.dart';
import 'demo_world.dart';

/// Fake repositories over [DemoWorld]. Used by tests, goldens and Demo mode only.
class FakeBackend {
  FakeBackend(this.world, {this.latency = Duration.zero, this.failWith});

  final DemoWorld world;
  final Duration latency;

  /// Set in tests to make every call fail (error states).
  ApiFailure? failWith;

  Future<T> run<T>(T Function() body) async {
    if (latency > Duration.zero) await Future<void>.delayed(latency);
    final f = failWith;
    if (f != null) throw f;
    return body();
  }

  DateTime get now => world.now;
}

class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository(this.b);
  final FakeBackend b;

  @override
  Future<Me> signIn(String email, String password) => b.run(() {
        if (password.length < 8) throw const ApiFailure(code: 'AUTH_INVALID_CREDENTIALS', message: 'Email or password is not correct', status: 401);
        return Me.parse(b.world.me);
      });

  @override
  Future<Me?> restore() => b.run(() => Me.parse(b.world.me));

  @override
  Future<Me> me() => b.run(() => Me.parse(b.world.me));

  @override
  Future<void> signOut() async {}
}

class FakeTodayRepository implements TodayRepository {
  FakeTodayRepository(this.b);
  final FakeBackend b;

  @override
  Future<Fetched<MyToday>> today() => b.run(() => Fetched(MyToday.parse(b.world.today())));
}

class FakeLeadsRepository implements LeadsRepository {
  FakeLeadsRepository(this.b);
  final FakeBackend b;

  @override
  Future<Fetched<Paged<Lead>>> list(LeadFilters filters, {String? cursor}) => b.run(() {
        final q = filters.q.trim().toLowerCase();
        var items = b.world.leads.map(Lead.parse).where((l) {
          if (q.isNotEmpty && !('${l.name} ${l.companyName} ${l.phone} ${l.city}'.toLowerCase().contains(q))) return false;
          if (filters.stageIds.isNotEmpty && !filters.stageIds.contains(l.stageId)) return false;
          if (filters.temperatures.isNotEmpty && !filters.temperatures.contains(l.temperature)) return false;
          if (filters.sources.isNotEmpty && !filters.sources.contains(l.source)) return false;
          return true;
        }).toList();
        items = switch (filters.sort) {
          'name' => items..sort((a, b) => a.name.compareTo(b.name)),
          'valueInr' => items..sort((a, b) => b.valueInr.compareTo(a.valueInr)),
          'score' => items..sort((a, b) => b.score.compareTo(a.score)),
          'nextFollowUpAt' => items..sort((a, b) => (a.nextFollowUpAt ?? DateTime(2100)).compareTo(b.nextFollowUpAt ?? DateTime(2100))),
          _ => items..sort((a, b) => b.createdAt.compareTo(a.createdAt)),
        };
        return Fetched(Paged(items, total: items.length));
      });

  @override
  Future<Lead> get(String id) => b.run(() {
        final j = b.world.lead(id);
        if (j == null) throw const ApiFailure(code: 'NOT_FOUND', message: 'Lead not found', status: 404);
        return Lead.parse(j);
      });

  @override
  Future<List<Activity>> timeline(String id) => b.run(() {
        final w = b.world;
        final lead = w.lead(id)!;
        final list = w.timelines.putIfAbsent(id, () {
          final created = DateTime.parse(lead['createdAt'] as String);
          return [
            {'id': '$id-a1', 'leadId': id, 'type': 'lead_created', 'actor': null, 'createdAt': created.toIso8601String(), 'payload': {'source': lead['source']}},
            {'id': '$id-a2', 'leadId': id, 'type': 'assigned', 'actor': null, 'createdAt': created.add(const Duration(minutes: 1)).toIso8601String(), 'payload': {'fromUserId': null, 'toUserId': DemoWorld.userId, 'rule': 'round_robin'}},
            {'id': '$id-a3', 'leadId': id, 'type': 'message', 'actor': w.meUserSummary, 'createdAt': created.add(const Duration(minutes: 3)).toIso8601String(), 'payload': {'conversationId': 'conv-0', 'messageId': 'm', 'direction': 'outbound', 'preview': 'Namaste, thank you for your enquiry on IndiaMART.'}},
            {'id': '$id-a4', 'leadId': id, 'type': 'call', 'actor': w.meUserSummary, 'createdAt': created.add(const Duration(hours: 2)).toIso8601String(), 'payload': {'callId': 'call-01', 'status': 'completed', 'outcome': 'interested', 'durationSec': 312, 'hasRecording': true}},
            {'id': '$id-a5', 'leadId': id, 'type': 'stage_changed', 'actor': w.meUserSummary, 'createdAt': created.add(const Duration(hours: 2, minutes: 6)).toIso8601String(), 'payload': {'fromStageId': 'st-new', 'toStageId': lead['stageId']}},
            {'id': '$id-a6', 'leadId': id, 'type': 'note', 'actor': w.meUserSummary, 'createdAt': created.add(const Duration(hours: 3)).toIso8601String(), 'payload': {'body': 'Needs delivery to the new site. Decision maker is the owner; call after 4 pm.'}},
          ];
        });
        return list.map(Activity.parse).toList().reversed.toList();
      });

  @override
  Future<Activity> addNote(String id, String body) => b.run(() {
        final a = {'id': b.world.nextId(), 'leadId': id, 'type': 'note', 'actor': b.world.meUserSummary, 'createdAt': DateTime.now().toUtc().toIso8601String(), 'payload': {'body': body}};
        b.world.timelines.putIfAbsent(id, () => []).add(a);
        return Activity.parse(a);
      });

  @override
  Future<Lead> moveStage(Lead lead, String stageId) => b.run(() {
        final j = b.world.lead(lead.id)!;
        j['stageId'] = stageId;
        j['version'] = (j['version'] as int) + 1;
        b.world.timelines.putIfAbsent(lead.id, () => []).add({
          'id': b.world.nextId(),
          'leadId': lead.id,
          'type': 'stage_changed',
          'actor': b.world.meUserSummary,
          'createdAt': DateTime.now().toUtc().toIso8601String(),
          'payload': {'fromStageId': lead.stageId, 'toStageId': stageId},
        });
        return Lead.parse(j);
      });

  @override
  Future<List<Pipeline>> pipelines() => b.run(() => [
        Pipeline.parse({'id': DemoWorld.pipelineId, 'key': 'sales', 'name': 'Sales', 'isDefault': true, 'packKey': 'generic-sales', 'stages': b.world.stages}),
      ]);

  @override
  Future<List<Task>> tasksFor(String leadId) => b.run(() => b.world.tasks.where((t) => t['leadId'] == leadId).map(Task.parse).toList());
}

class FakeTasksRepository implements TasksRepository {
  FakeTasksRepository(this.b);
  final FakeBackend b;

  @override
  Future<Fetched<List<Task>>> myTasks() => b.run(() => Fetched(b.world.tasks.where((t) => t['status'] == 'open').map(Task.parse).toList()));

  @override
  Future<Task> setDone(Task task, bool done) => b.run(() {
        final j = b.world.tasks.firstWhere((t) => t['id'] == task.id);
        j['status'] = done ? 'done' : 'open';
        j['completedAt'] = done ? DateTime.now().toUtc().toIso8601String() : null;
        return Task.parse(j);
      });

  @override
  Future<Task> snooze(Task task, DateTime until) => b.run(() {
        final j = b.world.tasks.firstWhere((t) => t['id'] == task.id);
        j['snoozedUntil'] = until.toUtc().toIso8601String();
        return Task.parse(j);
      });
}

class FakeCallsRepository implements CallsRepository {
  FakeCallsRepository(this.b);
  final FakeBackend b;
  final reports = <ActiveCallReport>[];

  @override
  Future<Paged<Call>> recent({String? cursor}) => b.run(() {
        final list = b.world.calls.map(Call.parse).toList()..sort((a, b) => b.startedAt.compareTo(a.startedAt));
        return Paged(list.take(60).toList());
      });

  @override
  Future<Call> setOutcome(String callId, {String? outcome, String? notes}) => b.run(() {
        final j = b.world.calls.firstWhere((c) => c['id'] == callId);
        if (outcome != null) j['outcome'] = outcome;
        if (notes != null) j['notes'] = notes;
        return Call.parse(j);
      });

  @override
  Future<void> reportActive(ActiveCallReport report) => b.run(() => reports.add(report));
}

class FakeInboxRepository implements InboxRepository {
  FakeInboxRepository(this.b);
  final FakeBackend b;

  @override
  Future<List<Conversation>> conversations({InboxFilter filter = InboxFilter.all, String q = ''}) => b.run(() {
        final query = q.trim().toLowerCase();
        return b.world.conversations.map(Conversation.parse).where((c) {
          if (query.isNotEmpty && !'${c.contactName} ${c.contactPhone} ${c.lastMessagePreview}'.toLowerCase().contains(query)) return false;
          return switch (filter) {
            InboxFilter.all => c.status != 'closed',
            InboxFilter.unread => c.unreadCount > 0,
            InboxFilter.needsReply => c.status != 'closed' && c.lastInboundAt != null && !c.lastMessageAt!.isAfter(c.lastInboundAt!),
            InboxFilter.closed => c.status == 'closed',
          };
        }).toList();
      });

  @override
  Future<Conversation> conversation(String id) => b.run(() => Conversation.parse(b.world.conversations.firstWhere((c) => c['id'] == id)));

  @override
  Future<List<Message>> messages(String conversationId) => b.run(() => (b.world.messages[conversationId] ?? []).map(Message.parse).toList());

  Message _add(String conversationId, Json m) {
    b.world.messages.putIfAbsent(conversationId, () => []).add(m);
    final c = b.world.conversations.firstWhere((c) => c['id'] == conversationId);
    c['lastMessagePreview'] = m['body'];
    c['lastMessageAt'] = m['createdAt'];
    return Message.parse(m);
  }

  @override
  Future<Message> sendText(String conversationId, String body) => b.run(() {
        final c = Conversation.parse(b.world.conversations.firstWhere((c) => c['id'] == conversationId));
        if (!c.windowOpen(DateTime.now().toUtc())) {
          throw const ApiFailure(code: 'WHATSAPP_WINDOW_CLOSED', message: 'The 24 hour window is closed. Send an approved template instead.', status: 422);
        }
        return _add(conversationId, _msg(conversationId, body, 'text', null));
      });

  @override
  Future<Message> sendTemplate(String conversationId, MessageTemplate template, Map<String, String> variables) => b.run(() {
        var body = template.body;
        variables.forEach((k, v) => body = body.replaceAll('{{$k}}', v));
        return _add(conversationId, _msg(conversationId, body, 'template', template.name));
      });

  Json _msg(String conversationId, String body, String type, String? template) => {
        'id': b.world.nextId(),
        'conversationId': conversationId,
        'direction': 'outbound',
        'type': type,
        'body': body,
        'templateName': template,
        'status': 'sent',
        'error': null,
        'isInternalNote': false,
        'author': b.world.meUserSummary,
        'createdAt': DateTime.now().toUtc().toIso8601String(),
      };

  @override
  Future<void> markRead(String conversationId) => b.run(() {
        b.world.conversations.firstWhere((c) => c['id'] == conversationId)['unreadCount'] = 0;
      });

  @override
  Future<List<MessageTemplate>> templates() => b.run(() => b.world.templates.map(MessageTemplate.parse).toList());

  @override
  Future<List<QuickReply>> quickReplies() => b.run(() => b.world.quickReplies.map(QuickReply.parse).toList());
}

class FakeTeamFloorRepository implements TeamFloorRepository {
  FakeTeamFloorRepository(this.b);
  final FakeBackend b;

  @override
  Future<TeamFloorSnapshot> snapshot() => b.run(() {
        final w = b.world;
        final mine = obj(w.team[0]['presence']);
        w.team[0] = {
          ...w.team[0],
          'status': w.myStatus == PresenceStatus.onCall ? 'on_call' : (w.myStatus == PresenceStatus.available ? 'idle' : 'away'),
          'user': w.meUserSummary,
          'presence': {...mine, 'status': w.myStatus.wire},
        };
        final people = w.team.map(FloorPerson.parse).toList();
        final counts = <String, int>{};
        for (final p in people) {
          counts[p.status.wire] = (counts[p.status.wire] ?? 0) + 1;
        }
        return TeamFloorSnapshot(
          people: people,
          kpis: {
            'active': people.where((p) => p.status != PresenceStatus.offline).length,
            'onCall': counts['on_call'] ?? 0,
            'idle': counts['available'] ?? 0,
            'busy': 0,
            'callsToday': people.fold(0, (s, p) => s + p.callsToday),
            'leadsWaiting': 3,
          },
          presenceCounts: counts,
          generatedAt: w.now,
        );
      });

  @override
  Future<FloorPlan> plan() => b.run(() {
        final t = FloorPlan.fromTemplate(defaultFloorTemplate);
        return FloorPlan(source: 'template', name: t.name, aspect: t.aspect, zones: t.zones, seats: t.seats, preparing: true, requestStatus: 'in_progress');
      });
}

class FakePresenceRepository implements PresenceRepository {
  FakePresenceRepository(this.b);
  final FakeBackend b;
  final heartbeats = <HeartbeatBody>[];
  final zones = <ZoneSignal>[];
  int _version = 20;

  MyPresence _now({ZoneLocation? location}) => MyPresence(
        status: b.world.myStatus,
        version: _version,
        source: 'manual',
        since: b.world.now,
        location: location ?? ZoneLocation.parse(obj(b.world.team[0]['presence'])['location']),
        activity: PresenceActivity(client: isDemoAndroid ? 'android' : 'web', clientActivity: 'active', screen: heartbeats.lastOrNull?.screen),
      );

  static const isDemoAndroid = false;

  @override
  Future<MyPresence> get() => b.run(_now);

  @override
  Future<MyPresence> setStatus(PresenceStatus status, {String? note}) => b.run(() {
        b.world.myStatus = status;
        _version++;
        (b.world.me['user'] as Json)['status'] = status.wire;
        return _now();
      });

  @override
  Future<MyPresence> heartbeat(HeartbeatBody body) => b.run(() {
        heartbeats.add(body);
        return _now();
      });

  @override
  Future<MyPresence> zone(ZoneSignal signal) => b.run(() {
        zones.add(signal);
        const names = {'work': 'Work area', 'cabin': 'Manager cabin', 'meeting': 'Meeting room', 'reception': 'Reception', 'pantry': 'Pantry'};
        final id = signal.zoneId ?? (signal.markerToken != null ? 'meeting' : 'work');
        final loc = {'zoneId': id, 'zoneName': names[id] ?? id, 'source': signal.source, 'confidence': signal.source == 'qr' || signal.source == 'manual' ? 1.0 : 0.8, 'since': b.world.now.toIso8601String(), 'at': b.world.now.toIso8601String()};
        b.world.team[0] = {
          ...b.world.team[0],
          'presence': {...obj(b.world.team[0]['presence']), 'location': loc},
        };
        _version++;
        return _now(location: ZoneLocation.parse(loc));
      });
}

class FakeAttendanceRepository implements AttendanceRepository {
  FakeAttendanceRepository(this.b);
  final FakeBackend b;

  Json get _a => b.world.attendance;

  @override
  Future<AttendanceDay> today() => b.run(() => AttendanceDay.parse(_a));

  @override
  Future<void> setConsent({required bool accepted, required String version}) => b.run(() {
        _a['consent'] = {'accepted': accepted, 'version': version, 'at': b.world.now.toIso8601String(), 'currentVersion': '2026-11-v1'};
      });

  @override
  Future<AttendanceSession> checkIn(LocationFix at) => b.run(() {
        if ((_a['sessions'] as List).cast<Json>().any((s) => s['checkOutAt'] == null)) {
          throw const ApiFailure(code: 'ATTENDANCE_STATE_INVALID', message: 'You are already checked in.', status: 409);
        }
        final s = {
          'id': b.world.nextId(),
          'userId': DemoWorld.userId,
          'date': b.world.now.toIso8601String().substring(0, 10),
          'checkInAt': DateTime.now().toUtc().toIso8601String(),
          'checkIn': {'lat': at.lat, 'lng': at.lng, 'accuracy': at.accuracy},
          'checkOutAt': null,
          'checkOut': null,
          'checkOutReason': null,
          'workedMin': 0,
          'pointCount': 1,
        };
        (_a['sessions'] as List).add(s);
        _a['session'] = s;
        _a['trackingActive'] = true;
        return AttendanceSession.parse(s);
      });

  @override
  Future<AttendanceSession> checkOut(LocationFix at) => b.run(() {
        final open = (_a['sessions'] as List).cast<Json>().where((s) => s['checkOutAt'] == null).lastOrNull;
        if (open == null) throw const ApiFailure(code: 'ATTENDANCE_STATE_INVALID', message: 'You are not checked in.', status: 409);
        open['checkOutAt'] = DateTime.now().toUtc().toIso8601String();
        open['checkOut'] = {'lat': at.lat, 'lng': at.lng, 'accuracy': at.accuracy};
        open['checkOutReason'] = 'manual';
        _a['trackingActive'] = false;
        return AttendanceSession.parse(open);
      });
}

class FakeAccountRepository implements AccountRepository {
  FakeAccountRepository(this.b);
  final FakeBackend b;
  final devices = <String>[];

  @override
  Future<Me> updateProfile({String? name, String? phone, String? title}) => b.run(() {
        final u = b.world.me['user'] as Json;
        if (name != null) u['name'] = name;
        if (phone != null) u['phone'] = phone;
        if (title != null) u['title'] = title;
        return Me.parse(b.world.me);
      });

  @override
  Future<UserSettings> updateSettings({ThemePreference? theme, String? darkFrom, String? darkTo, bool? push, bool? inApp, String? emailDigest, String? reducedMotion}) => b.run(() {
        final s = b.world.me['settings'] as Json;
        final t = obj(s['theme']);
        if (theme != null) t['mode'] = theme.name;
        if (darkFrom != null) t['darkFrom'] = darkFrom;
        if (darkTo != null) t['darkTo'] = darkTo;
        s['theme'] = t;
        final n = obj(s['notifications']);
        if (push != null) n['push'] = push;
        if (inApp != null) n['inApp'] = inApp;
        if (emailDigest != null) n['emailDigest'] = emailDigest;
        s['notifications'] = n;
        if (reducedMotion != null) s['reducedMotion'] = reducedMotion;
        return UserSettings.parse(s);
      });

  @override
  Future<NotificationPage> notifications() => b.run(() {
        final items = b.world.notifications.map(AppNotification.parse).toList();
        return NotificationPage(items, items.where((n) => n.unread).length);
      });

  @override
  Future<void> markNotificationsRead({List<String>? ids}) => b.run(() {
        for (final n in b.world.notifications) {
          if (ids == null || ids.contains(n['id'])) n['readAt'] ??= DateTime.now().toUtc().toIso8601String();
        }
      });

  @override
  Future<AppConfig> appConfig() => b.run(() => AppConfig.parse({
        'firebase': null,
        'android': {
          'packageName': 'app.vistar.employee',
          'latest': {
            'versionName': '1.0.0',
            'versionCode': 1,
            'notes': 'First release of the Vistar employee app.',
            'size': 24117248,
            'sha256': 'demo',
            'createdAt': b.world.now.subtract(const Duration(days: 2)).toIso8601String(),
            'downloadUrl': 'http://localhost:4000/api/v1/app/android/latest',
          },
          'minSupportedVersionCode': null,
        },
        'serverTime': b.world.now.toIso8601String(),
      }));

  @override
  Future<RegisteredDevice> registerDevice({
    required String installationId,
    required String platform,
    String? fcmToken,
    required String appVersion,
    int? appBuild,
    String? model,
    String? osVersion,
  }) =>
      b.run(() {
        devices.add(installationId);
        return RegisteredDevice(id: '0190a000-0000-7000-8000-00000000d001', installationId: installationId, hasPushToken: fcmToken != null);
      });

  @override
  Future<Performance> performance() => b.run(() => buildPerformance(
        MyToday.parse(b.world.today()),
        b.world.calls.map(Call.parse).toList(),
        now: b.world.now,
        timezone: 'Asia/Kolkata',
        teamSize: b.world.team.length,
      ));
}

/// Applies queued writes to the demo world (Demo mode has no server).
Future<WriteOutcome> fakeWriteSender(PendingWrite w) async => WriteOutcome.done;
