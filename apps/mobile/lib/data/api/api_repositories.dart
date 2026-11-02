import 'dart:convert';

import 'package:dio/dio.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_error.dart';
import '../../core/calls/call_matching.dart';
import '../../core/location/location_tracker.dart' show outsideHoursSignal;
import '../../core/offline/local_store.dart';
import '../../core/offline/write_queue.dart';
import '../../core/time/zoned.dart';
import '../models.dart';
import '../repositories.dart';
import 'endpoints.dart';

/// Shared helpers for API repositories.
class ApiContext {
  ApiContext({
    required this.client,
    required this.cache,
    required this.queue,
    required this.store,
    required this.timezone,
    String? Function()? userId,
    String? Function()? deviceId,
    DateTime Function()? clock,
  })  : clock = clock ?? DateTime.now,
        userId = userId ?? (() => null),
        deviceId = deviceId ?? (() => null);

  final ApiClient client;
  final OfflineCache cache;
  final WriteQueue queue;
  final LocalStore store;
  final String Function() timezone;

  /// Signed-in user id (for "my calls").
  final String? Function() userId;

  /// Server id of this device (POST /me/devices), sent as `deviceId` where the contract allows.
  final String? Function() deviceId;
  final DateTime Function() clock;

  Dio get dio => client.dio;

  Future<Json> getJson(String path, {Map<String, dynamic>? query}) async {
    try {
      final res = await dio.get<dynamic>(path, queryParameters: query);
      return obj(res.data);
    } catch (e) {
      throw ApiFailure.from(e);
    }
  }

  Future<dynamic> getAny(String path, {Map<String, dynamic>? query}) async {
    try {
      final res = await dio.get<dynamic>(path, queryParameters: query);
      return res.data;
    } catch (e) {
      throw ApiFailure.from(e);
    }
  }

  Future<Json> send(String method, String path, {Object? body}) async {
    try {
      final res = await dio.request<dynamic>(path, data: body, options: Options(method: method));
      return obj(res.data);
    } catch (e) {
      throw ApiFailure.from(e);
    }
  }

  /// Network first; on a network failure fall back to the last saved copy.
  Future<Fetched<T>> cached<T>(String key, Future<Json> Function() fetch, T Function(Json) parse) async {
    try {
      final json = await fetch();
      await cache.put(key, json);
      return Fetched(parse(json));
    } on ApiFailure catch (e) {
      if (!e.network) rethrow;
      final hit = await cache.get(key);
      if (hit == null) rethrow;
      return Fetched(parse(obj(hit.data)), fromCache: true, savedAt: hit.savedAt);
    }
  }
}

/// deviceCallId -> server call id, filled from POST /me/calls/device-log results, so a recording
/// queued before its call log was accepted can find the call to attach to.
class CallIdMap {
  CallIdMap(this.store);
  final LocalStore store;
  static const _key = 'calls.deviceMap';
  static const _max = 300;

  Future<Map<String, String>> _read() async {
    final raw = await store.read(_key);
    if (raw == null) return {};
    try {
      return (jsonDecode(raw) as Map).map((k, v) => MapEntry('$k', '$v'));
    } catch (_) {
      return {};
    }
  }

  Future<String?> callIdFor(String deviceCallId) async => (await _read())[deviceCallId];

  Future<void> putAll(Map<String, String> entries) async {
    if (entries.isEmpty) return;
    final m = await _read()..addAll(entries);
    final keys = m.keys.toList();
    if (keys.length > _max) {
      for (final k in keys.take(keys.length - _max)) {
        m.remove(k);
      }
    }
    await store.write(_key, jsonEncode(m));
  }
}

class ApiAuthRepository implements AuthRepository {
  ApiAuthRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<Me> signIn(String email, String password) async {
    try {
      final body = await ctx.client.login(email.trim().toLowerCase(), password);
      final me = obj(body['me']);
      await ctx.cache.put('me', me);
      return Me.parse(me);
    } catch (e) {
      throw ApiFailure.from(e);
    }
  }

  @override
  Future<Me?> restore() async {
    final hasRefresh = ctx.client.tokens.cookieManaged || await ctx.client.tokens.readRefresh() != null;
    if (!hasRefresh) return null;
    try {
      final token = await ctx.client.refresh();
      if (token == null) return null;
      return await me();
    } catch (e) {
      final f = ApiFailure.from(e);
      if (f.network) {
        // Offline start: keep the user signed in with the cached profile; requests retry later.
        final hit = await ctx.cache.get('me');
        if (hit != null && !ctx.client.tokens.cookieManaged) return Me.parse(obj(hit.data));
      }
      if (f.isAuth || f.status == 403) return null;
      rethrow;
    }
  }

  @override
  Future<Me> me() async {
    final j = await ctx.getJson(Endpoints.me);
    await ctx.cache.put('me', j);
    return Me.parse(j);
  }

  @override
  Future<void> signOut() => ctx.client.logout();
}

class ApiTodayRepository implements TodayRepository {
  ApiTodayRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<Fetched<MyToday>> today() => ctx.cached('today', () => ctx.getJson(Endpoints.myToday), (j) {
        final t = MyToday.parse(j);
        final phones = {for (final l in [...t.followUps, ...t.newAssigned]) l.id: l.phone};
        List<Task> withPhones(List<Task> ts) => [for (final x in ts) x.leadPhone == null && phones[x.leadId] != null ? x.copyWith(leadPhone: phones[x.leadId]) : x];
        return MyToday(
          tasksDue: withPhones(t.tasksDue),
          followUps: t.followUps,
          callsToMake: withPhones(t.callsToMake),
          newAssigned: t.newAssigned,
          targets: t.targets,
          stats: t.stats,
          generatedAt: t.generatedAt,
        );
      });
}

class ApiLeadsRepository implements LeadsRepository {
  ApiLeadsRepository(this.ctx);
  final ApiContext ctx;
  List<Pipeline>? _pipelines;

  @override
  Future<Fetched<Paged<Lead>>> list(LeadFilters filters, {String? cursor}) {
    final query = {...filters.toQuery(), 'limit': 50, 'cursor': ?cursor};
    // Only the first unfiltered page is kept offline.
    final key = filters == const LeadFilters() && cursor == null ? 'leads.mine' : 'leads.q.${Uri(queryParameters: query.map((k, v) => MapEntry(k, '$v'))).query}';
    return ctx.cached(key, () => ctx.getJson(Endpoints.leads, query: query), (j) => Paged.parse(j, Lead.parse));
  }

  @override
  Future<Lead> get(String id) async {
    final f = await ctx.cached('lead.$id', () => ctx.getJson(Endpoints.lead(id)), Lead.parse);
    return f.data;
  }

  @override
  Future<List<Activity>> timeline(String id) async {
    final j = await ctx.getJson(Endpoints.leadTimeline(id), query: {'limit': 50});
    return Paged.parse(j, Activity.parse).items;
  }

  @override
  Future<Activity> addNote(String id, String body) async => Activity.parse(await ctx.send('POST', Endpoints.leadNotes(id), body: {'body': body}));

  @override
  Future<Lead> moveStage(Lead lead, String stageId) async {
    final j = await ctx.send('POST', Endpoints.leadMove(lead.id), body: {'stageId': stageId, 'expectedVersion': lead.version});
    return Lead.parse(j);
  }

  @override
  Future<List<Pipeline>> pipelines() async {
    if (_pipelines != null) return _pipelines!;
    final f = await ctx.cached('pipelines', () => ctx.getJson(Endpoints.pipelines), (j) => listOf(j['items'], Pipeline.parse));
    return _pipelines = f.data;
  }

  @override
  Future<List<Task>> tasksFor(String leadId) async {
    final j = await ctx.getJson(Endpoints.tasks, query: {'leadId': leadId, 'scope': 'mine', 'limit': 50});
    return Paged.parse(j, Task.parse).items;
  }
}

class ApiTasksRepository implements TasksRepository {
  ApiTasksRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<Fetched<List<Task>>> myTasks() async {
    final f = await ctx.cached('tasks.mine', () => ctx.getJson(Endpoints.tasks, query: {'scope': 'mine', 'status': 'open', 'limit': 200}), (j) => Paged.parse(j, Task.parse).items);
    // Apply status changes still waiting in the offline queue.
    final pending = await ctx.queue.pending();
    final local = {for (final w in pending.where((w) => w.kind == WriteKind.taskStatus)) w.path.split('/').last: w.body?['status']};
    return Fetched([for (final t in f.data) local.containsKey(t.id) ? t.copyWith(status: '${local[t.id]}') : t], fromCache: f.fromCache, savedAt: f.savedAt);
  }

  @override
  Future<Task> setDone(Task task, bool done) async {
    final status = done ? 'done' : 'open';
    final optimistic = task.copyWith(status: status, completedAt: done ? ctx.clock().toUtc() : null, clearCompleted: !done);
    try {
      return Task.parse(await ctx.send('PATCH', Endpoints.task(task.id), body: {'status': status}));
    } on ApiFailure catch (e) {
      if (!e.network) rethrow;
      await ctx.queue.enqueue(kind: WriteKind.taskStatus, method: 'PATCH', path: Endpoints.task(task.id), body: {'status': status}, dedupeKey: 'task:${task.id}');
      return optimistic;
    }
  }

  @override
  Future<Task> snooze(Task task, DateTime until) async =>
      Task.parse(await ctx.send('POST', Endpoints.taskSnooze(task.id), body: {'until': until.toUtc().toIso8601String()}));
}

class ApiCallsRepository implements CallsRepository {
  ApiCallsRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<Paged<Call>> recent({String? cursor}) async {
    final f = await ctx.cached(
      'calls.recent',
      () => ctx.getJson(Endpoints.calls, query: {'limit': 50, 'userId': ?ctx.userId(), 'cursor': ?cursor}),
      (j) => Paged.parse(j, Call.parse),
    );
    return f.data;
  }

  @override
  Future<Call> setOutcome(String callId, {String? outcome, String? notes}) async =>
      Call.parse(await ctx.send('PATCH', Endpoints.call(callId), body: {'outcome': ?outcome, 'notes': ?notes}));

  @override
  Future<void> reportActive(ActiveCallReport report) async {
    await ctx.send('POST', Endpoints.callsActive, body: report.toJson());
  }
}

class ApiInboxRepository implements InboxRepository {
  ApiInboxRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<List<Conversation>> conversations({InboxFilter filter = InboxFilter.all, String q = ''}) async {
    final query = <String, dynamic>{
      'assigneeId': 'me',
      'limit': 100,
      if (q.trim().isNotEmpty) 'q': q.trim(),
      if (filter == InboxFilter.unread) 'unread': 'true',
      if (filter == InboxFilter.closed) 'status': 'closed',
      if (filter == InboxFilter.needsReply) 'status': 'open',
    };
    final items = Paged.parse(await ctx.getJson(Endpoints.conversations, query: query), Conversation.parse).items;
    if (filter == InboxFilter.needsReply) {
      return items.where((c) => c.lastInboundAt != null && (c.lastMessageAt == null || !c.lastMessageAt!.isAfter(c.lastInboundAt!))).toList();
    }
    return items;
  }

  @override
  Future<Conversation> conversation(String id) async => Conversation.parse(await ctx.getJson(Endpoints.conversation(id)));

  @override
  Future<List<Message>> messages(String conversationId) async {
    final items = Paged.parse(await ctx.getJson(Endpoints.messages(conversationId), query: {'limit': 100}), Message.parse).items;
    return items..sort((a, b) => a.createdAt.compareTo(b.createdAt));
  }

  @override
  Future<Message> sendText(String conversationId, String body) async =>
      Message.parse(await ctx.send('POST', Endpoints.messages(conversationId), body: {'type': 'text', 'body': body}));

  @override
  Future<Message> sendTemplate(String conversationId, MessageTemplate template, Map<String, String> variables) async => Message.parse(
        await ctx.send('POST', Endpoints.messages(conversationId), body: {'type': 'template', 'templateId': template.id, 'variables': variables}),
      );

  @override
  Future<void> markRead(String conversationId) async {
    await ctx.send('POST', Endpoints.conversationRead(conversationId));
  }

  @override
  Future<List<MessageTemplate>> templates() async =>
      listOf((await ctx.getJson(Endpoints.templates, query: {'channel': 'whatsapp', 'status': 'approved'}))['items'], MessageTemplate.parse);

  @override
  Future<List<QuickReply>> quickReplies() async => listOf((await ctx.getJson(Endpoints.quickReplies))['items'], QuickReply.parse);
}

class ApiTeamFloorRepository implements TeamFloorRepository {
  ApiTeamFloorRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<TeamFloorSnapshot> snapshot() async => TeamFloorSnapshot.parse(await ctx.getJson(Endpoints.teamFloorSnapshot));

  @override
  Future<FloorPlan> plan() async {
    try {
      final f = await ctx.cached('floor.layout', () => ctx.getJson(Endpoints.teamFloorLayout), (j) => j);
      return FloorPlan.fromLayout(f.data, template: defaultFloorTemplate);
    } on ApiFailure catch (e) {
      // Older server (404) or no floor permission (403): the default layout still shows the people.
      if (e.status == 404 || e.status == 403) return FloorPlan.fromTemplate(defaultFloorTemplate);
      rethrow;
    }
  }
}

class ApiPresenceRepository implements PresenceRepository {
  ApiPresenceRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<MyPresence> get() async => MyPresence.parse(await ctx.getJson(Endpoints.myPresence));

  @override
  Future<MyPresence> setStatus(PresenceStatus status, {String? note}) async {
    final n = note?.trim();
    return MyPresence.parse(await ctx.send('PUT', Endpoints.myStatus, body: {'status': status.wire, if (n != null && n.isNotEmpty) 'note': n}));
  }

  @override
  Future<MyPresence> heartbeat(HeartbeatBody body) async => MyPresence.parse(await ctx.send('POST', Endpoints.heartbeat, body: body.toJson()));

  @override
  Future<MyPresence> zone(ZoneSignal signal) async => MyPresence.parse(await ctx.send('POST', Endpoints.zoneSignal, body: signal.toJson()));
}

class ApiAttendanceRepository implements AttendanceRepository {
  ApiAttendanceRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<AttendanceDay> today() async => AttendanceDay.parse(await ctx.getJson(Endpoints.attendanceToday));

  @override
  Future<void> setConsent({required bool accepted, required String version}) async {
    await ctx.send('PUT', Endpoints.trackingConsent, body: {'accepted': accepted, 'version': version, 'deviceId': ?ctx.deviceId()});
  }

  Json _body(LocationFix at) => {'lat': at.lat, 'lng': at.lng, 'accuracy': at.accuracy, 'deviceId': ?ctx.deviceId()};

  @override
  Future<AttendanceSession> checkIn(LocationFix at) async => AttendanceSession.parse(await _write(Endpoints.checkIn, _body(at)));

  @override
  Future<AttendanceSession> checkOut(LocationFix at) async => AttendanceSession.parse(await _write(Endpoints.checkOut, _body(at)));

  Future<Json> _write(String path, Json body) async {
    try {
      return await ctx.send('POST', path, body: body);
    } on ApiFailure catch (e) {
      if (e.code == Codes.outsideHours) throw const OutsideWorkingHours();
      rethrow;
    }
  }
}

class ApiAccountRepository implements AccountRepository {
  ApiAccountRepository(this.ctx);
  final ApiContext ctx;

  @override
  Future<Me> updateProfile({String? name, String? phone, String? title}) async {
    await ctx.send('PATCH', Endpoints.myProfile, body: {'name': ?name, if (phone != null) 'phone': toE164(phone) ?? (phone.trim().isEmpty ? null : phone.trim()), 'title': ?title});
    return Me.parse(await ctx.getJson(Endpoints.me));
  }

  @override
  Future<UserSettings> updateSettings({ThemePreference? theme, String? darkFrom, String? darkTo, bool? push, bool? inApp, String? emailDigest, String? reducedMotion}) async {
    final j = await ctx.send('PATCH', Endpoints.mySettings, body: {
      if (theme != null || darkFrom != null || darkTo != null) 'theme': {'mode': ?theme?.name, 'darkFrom': ?darkFrom, 'darkTo': ?darkTo},
      if (push != null || inApp != null || emailDigest != null) 'notifications': {'push': ?push, 'inApp': ?inApp, 'emailDigest': ?emailDigest},
      'reducedMotion': ?reducedMotion,
    });
    return UserSettings.parse(j);
  }

  @override
  Future<NotificationPage> notifications() async {
    final j = await ctx.getJson(Endpoints.notifications, query: {'limit': 50});
    return NotificationPage(listOf(j['items'], AppNotification.parse), toInt(j['unreadCount']));
  }

  @override
  Future<void> markNotificationsRead({List<String>? ids}) async {
    await ctx.send('POST', Endpoints.notificationsRead, body: {'ids': ?ids});
  }

  @override
  Future<AppConfig> appConfig() async {
    final f = await ctx.cached('app.config', () => ctx.getJson(Endpoints.appConfig), AppConfig.parse);
    return f.data;
  }

  @override
  Future<RegisteredDevice> registerDevice({
    required String installationId,
    required String platform,
    String? fcmToken,
    required String appVersion,
    int? appBuild,
    String? model,
    String? osVersion,
  }) async =>
      RegisteredDevice.parse(await ctx.send('POST', Endpoints.devices, body: {
        'platform': platform,
        'installationId': installationId,
        'fcmToken': fcmToken,
        'appVersion': appVersion,
        'appBuild': ?appBuild,
        'model': ?model,
        'osVersion': ?osVersion,
      }));

  @override
  Future<Performance> performance() async {
    final tz = ctx.timezone();
    final now = ctx.clock().toUtc();
    final from = startOfDay(now, tz, addDays: -13);
    final today = MyToday.parse(await ctx.getJson(Endpoints.myToday));
    final calls = <Call>[];
    String? cursor;
    for (var i = 0; i < 5; i++) {
      final page = Paged.parse(
        await ctx.getJson(Endpoints.calls, query: {'from': from.toIso8601String(), 'userId': ?ctx.userId(), 'limit': 200, 'cursor': ?cursor}),
        Call.parse,
      );
      calls.addAll(page.items);
      cursor = page.nextCursor;
      if (cursor == null) break;
    }
    return buildPerformance(today, calls, now: now, timezone: tz);
  }
}

/// Calls per day for the last 14 days in the workspace timezone (oldest first).
Performance buildPerformance(MyToday today, List<Call> calls, {required DateTime now, required String timezone, int? teamSize}) {
  final days = <String, DayCalls>{};
  for (var i = 13; i >= 0; i--) {
    final d = startOfDay(now, timezone, addDays: -i);
    days[dayKey(d, timezone)] = DayCalls(d, 0, 0, 0);
  }
  for (final c in calls) {
    final k = dayKey(c.startedAt, timezone);
    final d = days[k];
    if (d == null) continue;
    final connected = c.durationSec > 0 && !c.isMissed;
    days[k] = DayCalls(d.day, d.calls + 1, d.connected + (connected ? 1 : 0), d.talkSec + c.durationSec);
  }
  return Performance(targets: today.targets, stats: today.stats, callsPerDay: days.values.toList(), rank: today.stats.rank, teamSize: teamSize);
}

/// Sends queued writes (WriteQueue) to the API:
/// - device call logs (POST /me/calls/device-log, idempotent by deviceCallId; the returned call ids
///   are remembered for recordings);
/// - recordings (POST /calls/{id}/recording, multipart), deferred until the call id is known;
/// - location batches (POST /me/location); rejected points outside working hours stop tracking;
/// - task status and other JSON writes.
/// 409 duplicates count as accepted.
class ApiWriteSender {
  ApiWriteSender(this.ctx, {this.onOutsideHours}) : calls = CallIdMap(ctx.store);
  final ApiContext ctx;
  final CallIdMap calls;
  final void Function()? onOutsideHours;

  Future<WriteOutcome> call(PendingWrite w) async {
    try {
      switch (w.kind) {
        case WriteKind.recordingUpload:
          return await _recording(w);
        case WriteKind.deviceCallLog:
          final body = {...?w.body};
          final device = ctx.deviceId();
          if (device != null && body['deviceId'] == null) body['deviceId'] = device;
          final res = await ctx.dio.post<dynamic>(w.path, data: body);
          final items = listOf(obj(res.data)['items'], (i) => i);
          await calls.putAll({for (final i in items) if (strOrNull(i['deviceCallId']) != null && strOrNull(i['callId']) != null) str(i['deviceCallId']): str(i['callId'])});
          return WriteOutcome.done;
        case WriteKind.locationBatch:
          final body = {...?w.body};
          final device = ctx.deviceId();
          if (device != null && body['deviceId'] == null) body['deviceId'] = device;
          final res = await ctx.dio.post<dynamic>(w.path, data: body);
          final rejected = listOf(obj(res.data)['rejected'], (r) => str(r['reason']));
          if (rejected.any(Codes.stopTrackingReasons.contains)) _stopTracking();
          return WriteOutcome.done;
        default:
          await ctx.dio.request<dynamic>(w.path, data: w.body, options: Options(method: w.method));
          return WriteOutcome.done;
      }
    } on DioException catch (e) {
      final f = ApiFailure.from(e);
      if (f.network) return WriteOutcome.offline;
      final status = f.status ?? 0;
      if (f.code == Codes.outsideHours || f.code == Codes.consentRequired || f.code == Codes.featureDisabled) {
        if (w.kind == WriteKind.locationBatch) _stopTracking();
        return WriteOutcome.drop;
      }
      if (status == 409) return WriteOutcome.done;
      if (status == 401 || status == 408 || status == 429 || status >= 500) return WriteOutcome.retry;
      return WriteOutcome.drop;
    } catch (_) {
      return WriteOutcome.retry;
    }
  }

  void _stopTracking() {
    onOutsideHours?.call();
    outsideHoursSignal.add(null);
  }

  Future<WriteOutcome> _recording(PendingWrite w) async {
    final path = w.filePath;
    final deviceCallId = strOrNull(w.body?['deviceCallId']);
    if (path == null || deviceCallId == null) return WriteOutcome.drop;
    final callId = strOrNull(w.body?['callId']) ?? await calls.callIdFor(deviceCallId);
    if (callId == null) return WriteOutcome.defer;
    final form = FormData.fromMap({'file': await MultipartFile.fromFile(path, filename: strOrNull(w.body?['name']), contentType: DioMediaType.parse('${w.body?['mime'] ?? 'audio/mpeg'}'))});
    await ctx.dio.post<dynamic>(Endpoints.callRecording(callId), data: form, options: Options(sendTimeout: const Duration(minutes: 5)));
    return WriteOutcome.done;
  }
}

/// Default flat floor template (12.1 Small template, flattened) used until a custom floor is
/// published for the company (SPEC 29.5).
const Map<String, dynamic> defaultFloorTemplate = {
  'source': 'template',
  'name': 'Sales floor',
  'aspect': 1.25,
  'zones': [
    {'id': 'work', 'kind': 'work_area', 'label': 'Work area', 'x': 0.04, 'y': 0.05, 'w': 0.6, 'h': 0.62},
    {'id': 'cabin', 'kind': 'cabin', 'label': 'Manager cabin', 'x': 0.68, 'y': 0.05, 'w': 0.28, 'h': 0.27},
    {'id': 'meeting', 'kind': 'meeting_room', 'label': 'Meeting room', 'x': 0.68, 'y': 0.36, 'w': 0.28, 'h': 0.31},
    {'id': 'reception', 'kind': 'reception', 'label': 'Reception', 'x': 0.04, 'y': 0.72, 'w': 0.42, 'h': 0.23},
    {'id': 'pantry', 'kind': 'pantry_lounge', 'label': 'Pantry', 'x': 0.5, 'y': 0.72, 'w': 0.46, 'h': 0.23},
  ],
  'seats': [
    {'id': 's0', 'index': 0, 'x': 0.12, 'y': 0.16, 'zoneId': 'work'},
    {'id': 's1', 'index': 1, 'x': 0.26, 'y': 0.16, 'zoneId': 'work'},
    {'id': 's2', 'index': 2, 'x': 0.40, 'y': 0.16, 'zoneId': 'work'},
    {'id': 's3', 'index': 3, 'x': 0.54, 'y': 0.16, 'zoneId': 'work'},
    {'id': 's4', 'index': 4, 'x': 0.12, 'y': 0.33, 'zoneId': 'work'},
    {'id': 's5', 'index': 5, 'x': 0.26, 'y': 0.33, 'zoneId': 'work'},
    {'id': 's6', 'index': 6, 'x': 0.40, 'y': 0.33, 'zoneId': 'work'},
    {'id': 's7', 'index': 7, 'x': 0.54, 'y': 0.33, 'zoneId': 'work'},
    {'id': 's8', 'index': 8, 'x': 0.12, 'y': 0.52, 'zoneId': 'work'},
    {'id': 's9', 'index': 9, 'x': 0.26, 'y': 0.52, 'zoneId': 'work'},
    {'id': 's10', 'index': 10, 'x': 0.40, 'y': 0.52, 'zoneId': 'work'},
    {'id': 's11', 'index': 11, 'x': 0.54, 'y': 0.52, 'zoneId': 'work'},
    {'id': 's12', 'index': 12, 'x': 0.82, 'y': 0.19, 'zoneId': 'cabin', 'kind': 'cabin'},
  ],
};
