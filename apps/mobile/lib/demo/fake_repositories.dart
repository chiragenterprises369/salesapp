import 'dart:async';

import '../core/api/api_error.dart';
import '../core/calls/call_matching.dart';
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
  Future<Fetched<Page<Lead>>> list(LeadFilters filters, {String? cursor}) => b.run(() {
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
        return Fetched(Page(items, total: items.length));
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
  final uploads = <DeviceCallRecord>[];

  @override
  Future<Page<Call>> recent({String? cursor}) => b.run(() {
        final list = b.world.calls.map(Call.parse).toList()..sort((a, b) => b.startedAt.compareTo(a.startedAt));
        return Page(list.take(60).toList());
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

  @override
  Future<String?> uploadDeviceLog(DeviceCallRecord record) => b.run(() {
        uploads.add(record);
        final id = b.world.nextId();
        b.world.calls.insert(0, {
          'id': id,
          'direction': record.direction,
          'status': record.result == 'connected' ? 'completed' : 'missed',
          'outcome': record.result == 'connected' ? 'answered' : 'missed',
          'leadId': record.leadId,
          'leadName': record.leadId == null ? null : b.world.lead(record.leadId!)?['name'],
          'user': b.world.meUserSummary,
          'from': record.direction == 'inbound' ? record.number : '+919811100001',
          'to': record.direction == 'inbound' ? '+919811100001' : record.number,
          'startedAt': record.startedAt.toIso8601String(),
          'endedAt': record.endedAt.toIso8601String(),
          'durationSec': record.durationSec,
          'hasRecording': false,
          'notes': null,
          'provider': 'sim',
        });
        return id;
      });

  @override
  Future<void> uploadRecording({required String deviceCallId, required String filePath, required String mime}) => b.run(() {});
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
        w.team[0] = {...w.team[0], 'status': w.myStatus.wire, 'user': w.meUserSummary};
        final people = w.team.map(FloorPerson.parse).toList();
        int count(PresenceStatus s) => people.where((p) => p.status == s).length;
        return TeamFloorSnapshot(
          people: people,
          kpis: {
            'active': people.where((p) => p.status != PresenceStatus.offline).length,
            'onCall': count(PresenceStatus.onCall),
            'idle': count(PresenceStatus.available),
            'busy': count(PresenceStatus.busy),
            'callsToday': people.fold(0, (s, p) => s + p.callsToday),
            'leadsWaiting': 3,
          },
          generatedAt: w.now,
        );
      });

  @override
  Future<FloorPlan> plan() => b.run(() => FloorPlan.parse({...defaultFloorTemplate, 'preparing': true}));
}

class FakeAttendanceRepository implements AttendanceRepository {
  FakeAttendanceRepository(this.b);
  final FakeBackend b;
  final uploaded = <LocationFix>[];

  Json get _a => b.world.attendance;

  @override
  Future<AttendanceDay> today() => b.run(() => AttendanceDay.parse(_a));

  @override
  Future<void> giveConsent() => b.run(() => _a['consentGiven'] = true);

  @override
  Future<AttendanceDay> checkIn(LocationFix? at) => b.run(() {
        (_a['sessions'] as List).add({
          'id': b.world.nextId(),
          'checkInAt': DateTime.now().toUtc().toIso8601String(),
          'checkOutAt': null,
          'checkInLocation': at == null ? null : {'lat': at.lat, 'lng': at.lng},
          'address': at == null ? null : 'Near current location',
        });
        if (at != null) (_a['trail'] as List).add(at.toJson());
        return AttendanceDay.parse(_a);
      });

  @override
  Future<AttendanceDay> checkOut(LocationFix? at) => b.run(() {
        final open = (_a['sessions'] as List).cast<Json>().lastWhere((s) => s['checkOutAt'] == null);
        open['checkOutAt'] = DateTime.now().toUtc().toIso8601String();
        if (at != null) open['checkOutLocation'] = {'lat': at.lat, 'lng': at.lng};
        return AttendanceDay.parse(_a);
      });

  @override
  Future<void> uploadLocations(List<LocationFix> points, {required String batchId}) => b.run(() {
        uploaded.addAll(points);
        (_a['trail'] as List).addAll(points.map((p) => p.toJson()));
      });
}

class FakeAccountRepository implements AccountRepository {
  FakeAccountRepository(this.b);
  final FakeBackend b;
  final devices = <String>[];

  @override
  Future<PresenceStatus> setStatus(PresenceStatus status) => b.run(() {
        b.world.myStatus = status;
        (b.world.me['user'] as Json)['status'] = status.wire;
        return status;
      });

  @override
  Future<Me> updateProfile({String? name, String? phone, String? title}) => b.run(() {
        final u = b.world.me['user'] as Json;
        if (name != null) u['name'] = name;
        if (phone != null) u['phone'] = phone;
        if (title != null) u['title'] = title;
        return Me.parse(b.world.me);
      });

  @override
  Future<UserSettings> updateSettings({ThemePreference? theme, bool? push, bool? inApp, String? emailDigest}) => b.run(() {
        final s = b.world.me['settings'] as Json;
        if (theme != null) s['theme'] = {'mode': theme.name};
        final n = (s['notifications'] as Map).cast<String, dynamic>();
        if (push != null) n['push'] = push;
        if (inApp != null) n['inApp'] = inApp;
        if (emailDigest != null) n['emailDigest'] = emailDigest;
        s['notifications'] = n;
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
        'android': {
          'latest': {'versionName': '1.0.0', 'versionCode': 1, 'downloadUrl': null, 'notes': 'First release of the Vistar employee app.'},
        },
      }));

  @override
  Future<void> registerDevice({required String token, required String platform, String? appVersion, String? model, String? installId}) => b.run(() => devices.add(token));

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
