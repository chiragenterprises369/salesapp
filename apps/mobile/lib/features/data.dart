import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app/providers.dart';
import '../data/models.dart';
import '../data/repositories.dart';

/// Feature state (Riverpod). Screens read these; the realtime runtime patches or invalidates them.

// ---------------------------------------------------------------- Today

final todayProvider = FutureProvider<Fetched<MyToday>>((ref) => ref.watch(todayRepositoryProvider).today());

// ---------------------------------------------------------------- Leads

class LeadFiltersController extends Notifier<LeadFilters> {
  @override
  LeadFilters build() => const LeadFilters();

  void set(LeadFilters f) => state = f;
  void search(String q) => state = state.copyWith(q: q);
  void clear() => state = LeadFilters(q: state.q);
}

final leadFiltersProvider = NotifierProvider<LeadFiltersController, LeadFilters>(LeadFiltersController.new);

final leadsProvider = FutureProvider<Fetched<Page<Lead>>>((ref) => ref.watch(leadsRepositoryProvider).list(ref.watch(leadFiltersProvider)));

final pipelinesProvider = FutureProvider<List<Pipeline>>((ref) => ref.watch(leadsRepositoryProvider).pipelines());

/// Stage lookup across pipelines (for chips and the stage sheet).
final stagesProvider = Provider<Map<String, Stage>>((ref) {
  final p = ref.watch(pipelinesProvider).value ?? const [];
  return {for (final pl in p) for (final s in pl.stages) s.id: s};
});

final leadProvider = FutureProvider.autoDispose.family<Lead, String>((ref, id) => ref.watch(leadsRepositoryProvider).get(id));
final leadTimelineProvider = FutureProvider.autoDispose.family<List<Activity>, String>((ref, id) => ref.watch(leadsRepositoryProvider).timeline(id));
final leadTasksProvider = FutureProvider.autoDispose.family<List<Task>, String>((ref, id) => ref.watch(leadsRepositoryProvider).tasksFor(id));

// ---------------------------------------------------------------- Tasks

class TasksState {
  const TasksState(this.tasks, {this.fromCache = false, this.savedAt});
  final List<Task> tasks;
  final bool fromCache;
  final DateTime? savedAt;

  TasksState replace(Task t) => TasksState([for (final x in tasks) x.id == t.id ? t : x], fromCache: fromCache, savedAt: savedAt);
}

class TasksController extends AsyncNotifier<TasksState> {
  @override
  Future<TasksState> build() async {
    final f = await ref.watch(tasksRepositoryProvider).myTasks();
    return TasksState(f.data, fromCache: f.fromCache, savedAt: f.savedAt);
  }

  TasksRepository get _repo => ref.read(tasksRepositoryProvider);

  Future<void> setDone(Task t, bool done) async {
    final before = state.value;
    if (before == null) return;
    final now = ref.read(clockProvider)().toUtc();
    state = AsyncData(before.replace(t.copyWith(status: done ? 'done' : 'open', completedAt: done ? now : null, clearCompleted: !done)));
    try {
      final saved = await _repo.setDone(t, done);
      final cur = state.value;
      if (cur != null) state = AsyncData(cur.replace(saved));
      ref.invalidate(todayProvider);
    } catch (e) {
      state = AsyncData(before);
      rethrow;
    }
  }

  Future<void> snooze(Task t, DateTime until) async {
    final before = state.value;
    if (before == null) return;
    state = AsyncData(before.replace(t.copyWith(snoozedUntil: until)));
    try {
      final saved = await _repo.snooze(t, until);
      final cur = state.value;
      if (cur != null) state = AsyncData(cur.replace(saved));
      ref.invalidate(todayProvider);
    } catch (e) {
      state = AsyncData(before);
      rethrow;
    }
  }

  /// Realtime task.created / task.updated.
  void upsert(Task t) {
    final cur = state.value;
    if (cur == null) return;
    final exists = cur.tasks.any((x) => x.id == t.id);
    state = AsyncData(exists ? cur.replace(t) : TasksState([t, ...cur.tasks], fromCache: cur.fromCache, savedAt: cur.savedAt));
  }
}

final tasksProvider = AsyncNotifierProvider<TasksController, TasksState>(TasksController.new);

// ---------------------------------------------------------------- Calls

final callsProvider = FutureProvider<Page<Call>>((ref) => ref.watch(callsRepositoryProvider).recent());

// ---------------------------------------------------------------- Inbox

final conversationsProvider = FutureProvider.autoDispose.family<List<Conversation>, (InboxFilter, String)>(
  (ref, key) => ref.watch(inboxRepositoryProvider).conversations(filter: key.$1, q: key.$2),
);

/// Unread conversations badge on the Inbox tab.
final inboxUnreadProvider = FutureProvider<int>((ref) async {
  final list = await ref.watch(inboxRepositoryProvider).conversations(filter: InboxFilter.unread);
  return list.fold<int>(0, (s, c) => s + c.unreadCount);
});

final conversationProvider = FutureProvider.autoDispose.family<Conversation, String>((ref, id) => ref.watch(inboxRepositoryProvider).conversation(id));
final templatesProvider = FutureProvider<List<MessageTemplate>>((ref) => ref.watch(inboxRepositoryProvider).templates());
final quickRepliesProvider = FutureProvider<List<QuickReply>>((ref) => ref.watch(inboxRepositoryProvider).quickReplies());

class ChatController extends AsyncNotifier<List<Message>> {
  ChatController(this.conversationId);
  final String conversationId;
  int _local = 0;

  @override
  Future<List<Message>> build() async {
    final repo = ref.watch(inboxRepositoryProvider);
    final list = await repo.messages(conversationId);
    unawaited(repo.markRead(conversationId).then((_) => ref.invalidate(inboxUnreadProvider)).catchError((_) {}));
    return list;
  }

  /// Optimistic send: a "queued" bubble (clock tick) that becomes sent / delivered / read.
  Future<void> sendText(String body) => _send(body, null, const {});

  Future<void> sendTemplate(MessageTemplate t, Map<String, String> vars) {
    var preview = t.body;
    vars.forEach((k, v) => preview = preview.replaceAll('{{$k}}', v));
    return _send(preview, t, vars);
  }

  Future<void> _send(String body, MessageTemplate? template, Map<String, String> vars) async {
    final tempId = 'local-${_local++}';
    final temp = Message(
      id: tempId,
      conversationId: conversationId,
      direction: 'outbound',
      type: template == null ? 'text' : 'template',
      body: body,
      templateName: template?.name,
      status: 'queued',
      isInternalNote: false,
      createdAt: ref.read(clockProvider)().toUtc(),
    );
    state = AsyncData([...state.value ?? [], temp]);
    try {
      final repo = ref.read(inboxRepositoryProvider);
      final sent = template == null ? await repo.sendText(conversationId, body) : await repo.sendTemplate(conversationId, template, vars);
      state = AsyncData([for (final m in state.value ?? <Message>[]) m.id == tempId ? sent : m]);
    } catch (e) {
      state = AsyncData([for (final m in state.value ?? <Message>[]) m.id == tempId ? m.copyWith(status: 'failed') : m]);
      rethrow;
    }
  }

  /// Realtime message.received / message.sent / message.status_updated.
  void applyMessage(Message m) {
    final cur = state.value;
    if (cur == null) return;
    state = AsyncData(cur.any((x) => x.id == m.id) ? [for (final x in cur) x.id == m.id ? m : x] : [...cur, m]);
  }

  void applyStatus(String messageId, String status) {
    final cur = state.value;
    if (cur == null) return;
    state = AsyncData([for (final x in cur) x.id == messageId ? x.copyWith(status: status) : x]);
  }
}

final chatProvider = AsyncNotifierProvider.autoDispose.family<ChatController, List<Message>, String>(ChatController.new);

// ---------------------------------------------------------------- Team Floor

class TeamFloorController extends AsyncNotifier<TeamFloorSnapshot> {
  @override
  Future<TeamFloorSnapshot> build() => ref.watch(teamFloorRepositoryProvider).snapshot();

  void applyStatus(String userId, PresenceStatus status) {
    final cur = state.value;
    if (cur != null) state = AsyncData(cur.applyStatus(userId, status));
  }
}

final teamFloorProvider = AsyncNotifierProvider<TeamFloorController, TeamFloorSnapshot>(TeamFloorController.new);
final floorPlanProvider = FutureProvider<FloorPlan>((ref) => ref.watch(teamFloorRepositoryProvider).plan());

// ---------------------------------------------------------------- Status

class MyStatusController extends Notifier<PresenceStatus> {
  @override
  PresenceStatus build() => ref.watch(meProvider.select((m) => m?.user.summary.status)) ?? PresenceStatus.offline;

  Future<void> set(PresenceStatus s) async {
    final prev = state;
    state = s;
    try {
      state = await ref.read(accountRepositoryProvider).setStatus(s);
      final me = ref.read(meProvider);
      if (me != null) ref.read(teamFloorProvider.notifier).applyStatus(me.user.id, state);
    } catch (e) {
      state = prev;
      rethrow;
    }
  }

  /// Server-side change (realtime employee.status_changed for me, e.g. On call from the phone).
  void applyServer(PresenceStatus s) => state = s;
}

final myStatusProvider = NotifierProvider<MyStatusController, PresenceStatus>(MyStatusController.new);

// ---------------------------------------------------------------- Notifications

class NotificationsController extends AsyncNotifier<NotificationPage> {
  @override
  Future<NotificationPage> build() => ref.watch(accountRepositoryProvider).notifications();

  Future<void> markAllRead() async {
    final cur = state.value;
    if (cur == null) return;
    final now = ref.read(clockProvider)().toUtc();
    state = AsyncData(NotificationPage([for (final n in cur.items) n.markRead(now)], 0));
    try {
      await ref.read(accountRepositoryProvider).markNotificationsRead();
    } catch (_) {
      state = AsyncData(cur);
      rethrow;
    }
  }

  Future<void> markRead(AppNotification n) async {
    final cur = state.value;
    if (cur == null || !n.unread) return;
    final now = ref.read(clockProvider)().toUtc();
    state = AsyncData(NotificationPage([for (final x in cur.items) x.id == n.id ? x.markRead(now) : x], (cur.unreadCount - 1).clamp(0, 1 << 30)));
    try {
      await ref.read(accountRepositoryProvider).markNotificationsRead(ids: [n.id]);
    } catch (_) {}
  }

  void add(AppNotification n) {
    final cur = state.value;
    if (cur == null) return;
    state = AsyncData(NotificationPage([n, ...cur.items.where((x) => x.id != n.id)], cur.unreadCount + (n.unread ? 1 : 0)));
  }
}

final notificationsProvider = AsyncNotifierProvider<NotificationsController, NotificationPage>(NotificationsController.new);

// ---------------------------------------------------------------- Attendance, performance, config

final attendanceProvider = FutureProvider<AttendanceDay>((ref) => ref.watch(attendanceRepositoryProvider).today());
final performanceProvider = FutureProvider<Performance>((ref) => ref.watch(accountRepositoryProvider).performance());
final appConfigProvider = FutureProvider<AppConfig>((ref) => ref.watch(accountRepositoryProvider).appConfig());

/// True while the realtime socket is connected (API mode). Demo mode is always "live".
class ConnectionController extends Notifier<bool> {
  @override
  bool build() => true;
  void set(bool v) => state = v;
}

final realtimeConnectedProvider = NotifierProvider<ConnectionController, bool>(ConnectionController.new);
