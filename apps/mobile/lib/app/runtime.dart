import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/calls/call_tracker.dart';
import '../core/location/location_tracker.dart';
import '../core/realtime/realtime_client.dart';
import '../core/time/working_hours.dart';
import '../data/models.dart';
import '../features/data.dart';
import '../platform/push.dart';
import 'providers.dart';
import 'router.dart';

/// In-app banner for pushes and realtime notifications while the app is open.
class InAppNotice {
  const InAppNotice(this.title, this.body, this.route);
  final String title;
  final String? body;
  final String route;
}

class InAppNoticeController extends Notifier<InAppNotice?> {
  @override
  InAppNotice? build() => null;
  void show(InAppNotice n) => state = n;
}

final inAppNoticeProvider = NotifierProvider<InAppNoticeController, InAppNotice?>(InAppNoticeController.new);

/// Background work while signed in: realtime socket and heartbeat, the offline write queue,
/// SIM call tracking inside working hours, field GPS while checked in, and push registration.
class AppRuntime {
  AppRuntime(this.ref, {required this.demo});

  final Ref ref;
  final bool demo;

  RealtimeClient? _realtime;
  CallTracker? _calls;
  LocationTracker? _location;
  Timer? _flushTimer;
  Timer? _hoursTimer;
  AppLifecycleListener? _lifecycle;
  final _subs = <StreamSubscription<dynamic>>[];
  bool _disposed = false;

  Me? get _me => ref.read(meProvider);
  CallTracker? get callTracker => _calls;

  void start() {
    _flushTimer = Timer.periodic(const Duration(seconds: 30), (_) => flush());
    unawaited(flush());
    _lifecycle = AppLifecycleListener(
      onResume: () {
        _realtime?.setActivity('active');
        unawaited(flush());
        ref.invalidate(todayProvider);
        ref.invalidate(teamFloorProvider);
        unawaited(_applyWorkingHours());
      },
      onHide: () => _realtime?.setActivity('hidden'),
    );
    if (demo) return;
    _subs.add(outsideHoursSignal.stream.listen((_) => onOutsideHours()));
    _connectRealtime();
    unawaited(_startCallTracking());
    unawaited(_startPush());
    ref.listen<AsyncValue<AttendanceDay>>(attendanceProvider, (_, next) => _syncLocation(next.value), fireImmediately: false);
  }

  Future<void> flush() async {
    if (_disposed) return;
    try {
      final done = await ref.read(writeQueueProvider).flush(ref.read(writeSenderProvider));
      if (done > 0 && !_disposed) {
        ref.invalidate(callsProvider);
      }
    } catch (_) {}
  }

  // ------------------------------------------------------------ realtime

  void _connectRealtime() {
    final client = ref.read(apiClientProvider);
    _realtime = RealtimeClient(
      serverUrl: client.baseUrl,
      token: () => client.tokens.accessToken,
      refreshToken: client.refresh,
      onEvent: _onEvent,
      onResync: _resync,
      onConnectionChanged: (c) {
        if (_disposed) return;
        ref.read(realtimeConnectedProvider.notifier).set(c);
        if (c) unawaited(flush());
      },
    )..connect();
  }

  void _resync(List<String> scopes) {
    if (_disposed) return;
    for (final s in scopes) {
      switch (s) {
        case 'leads' || 'board':
          ref.invalidate(leadsProvider);
          ref.invalidate(todayProvider);
        case 'tasks':
          ref.invalidate(tasksProvider);
          ref.invalidate(todayProvider);
        case 'calls':
          ref.invalidate(callsProvider);
        case 'conversations':
          ref.invalidate(conversationsProvider);
          ref.invalidate(inboxUnreadProvider);
        case 'notifications':
          ref.invalidate(notificationsProvider);
        case 'team-floor' || 'dashboard':
          ref.invalidate(teamFloorProvider);
      }
    }
  }

  void _onEvent(String type, Map<String, dynamic> event) {
    if (_disposed) return;
    final p = obj(event['payload']);
    final me = _me;
    switch (type) {
      case 'employee.status_changed':
        final status = PresenceStatus.parse(p['status']);
        final userId = str(p['userId']);
        ref.read(teamFloorProvider.notifier).applyStatus(userId, status);
        if (me != null && userId == me.user.id) ref.read(myStatusProvider.notifier).applyServer(status);
      case 'notification.created':
        final n = AppNotification.parse(obj(p['notification']));
        ref.read(notificationsProvider.notifier).add(n);
        ref.read(inAppNoticeProvider.notifier).show(InAppNotice(n.title, n.body, routeForNotification({'href': n.href, ...n.data})));
      case 'task.created' || 'task.updated' || 'task.overdue':
        ref.read(tasksProvider.notifier).upsert(Task.parse(obj(p['task'])));
        ref.invalidate(todayProvider);
      case 'lead.created' || 'lead.updated' || 'lead.assigned' || 'stage.changed':
        ref.invalidate(leadsProvider);
        ref.invalidate(todayProvider);
        final id = strOrNull(obj(p['lead'])['id']);
        if (id != null) ref.invalidate(leadProvider(id));
      case 'call.started' || 'call.ended' || 'call.updated':
        ref.invalidate(callsProvider);
        ref.invalidate(todayProvider);
      case 'message.received' || 'message.sent':
        final m = Message.parse(obj(p['message']));
        if (ref.exists(chatProvider(m.conversationId))) ref.read(chatProvider(m.conversationId).notifier).applyMessage(m);
        ref.invalidate(conversationsProvider);
        ref.invalidate(inboxUnreadProvider);
      case 'message.status_updated':
        final cid = str(p['conversationId']);
        if (ref.exists(chatProvider(cid))) ref.read(chatProvider(cid).notifier).applyStatus(str(p['messageId']), str(p['status']));
      case 'conversation.updated':
        ref.invalidate(conversationsProvider);
        ref.invalidate(inboxUnreadProvider);
      case 'theme.changed':
        unawaited(ref.read(sessionProvider.notifier).reloadMe());
    }
  }

  // ------------------------------------------------------------ SIM call tracking (Android)

  Future<void> _startCallTracking() async {
    final tel = ref.read(telephonyProvider);
    if (!tel.supported) return;
    final caps = await tel.capabilities();
    _calls = CallTracker(
      telephony: tel,
      calls: ref.read(callsRepositoryProvider),
      queue: ref.read(writeQueueProvider),
      installId: caps.installId,
      onQueued: () => unawaited(flush()),
    );
    await _calls!.start();
    await _applyWorkingHours();
  }

  /// Starts the call-tracking foreground service inside working hours and stops it outside, then
  /// schedules the next flip.
  Future<void> _applyWorkingHours() async {
    if (_disposed || demo) return;
    final me = _me;
    final tel = ref.read(telephonyProvider);
    if (me == null || !tel.supported) return;
    final hours = WorkingHours.forMe(me);
    final now = ref.read(clockProvider)().toUtc();
    final caps = await tel.capabilities();
    if (hours.isWithin(now) && caps.readPhoneState) {
      if (!caps.monitoring) await tel.startMonitoring(text: 'Working hours: ${hours.todayLabel(now) ?? 'today'}. Only work calls are reported.');
    } else if (caps.monitoring) {
      await tel.stopMonitoring();
    }
    _syncLocation(ref.read(attendanceProvider).value);
    _hoursTimer?.cancel();
    final next = hours.nextTransition(now);
    if (next != null) {
      final wait = next.difference(now) + const Duration(seconds: 5);
      _hoursTimer = Timer(wait.isNegative ? const Duration(minutes: 1) : wait, () => unawaited(_applyWorkingHours()));
    }
  }

  /// Re-checks permissions and working hours (after the call setup screen).
  Future<void> refreshCallTracking() async {
    if (_calls == null) {
      await _startCallTracking();
    } else {
      await _applyWorkingHours();
    }
  }

  // ------------------------------------------------------------ field GPS

  void _syncLocation(AttendanceDay? day) {
    if (_disposed || demo) return;
    final me = _me;
    final loc = ref.read(locationProvider);
    if (me == null || !loc.canTrack) return;
    final within = WorkingHours.forMe(me).isWithin(ref.read(clockProvider)().toUtc());
    final should = day != null && day.fieldStaff && day.checkedIn && within && (day.consentGiven || ref.read(prefsProvider).locationConsent);
    if (should) {
      _location ??= LocationTracker(location: loc, queue: ref.read(writeQueueProvider), onQueued: () => unawaited(flush()));
      _location!.start();
    } else if (_location?.running ?? false) {
      unawaited(_location!.stop());
    }
  }

  /// The server refused a location batch outside working hours: stop the location service.
  void onOutsideHours() {
    unawaited(_location?.stop(flush: false));
  }

  // ------------------------------------------------------------ push

  Future<void> _startPush() async {
    try {
      final config = await ref.read(appConfigProvider.future);
      final push = ref.read(pushProvider);
      final token = await push.start(config);
      if (token == null || _disposed) return;
      await _register(token);
      _subs.add(push.tokenRefresh.listen((t) => unawaited(_register(t))));
      _subs.add(push.taps.listen((data) => ref.read(routerProvider).push(routeForNotification(data))));
      _subs.add(push.foreground.listen((data) {
        ref.invalidate(notificationsProvider);
        ref.read(inAppNoticeProvider.notifier).show(InAppNotice('${data['title'] ?? 'Vistar'}', data['body'] as String?, routeForNotification(data)));
      }));
    } catch (_) {
      // Push is optional.
    }
  }

  Future<void> _register(String token) async {
    try {
      final info = await PackageInfo.fromPlatform();
      final caps = await ref.read(telephonyProvider).capabilities();
      await ref.read(accountRepositoryProvider).registerDevice(
            token: token,
            platform: 'android',
            appVersion: '${info.version}+${info.buildNumber}',
            model: '${caps.manufacturer} ${caps.model}'.trim(),
            installId: caps.installId,
          );
    } catch (_) {}
  }

  Future<void> dispose() async {
    _disposed = true;
    _flushTimer?.cancel();
    _hoursTimer?.cancel();
    _lifecycle?.dispose();
    for (final s in _subs) {
      await s.cancel();
    }
    _realtime?.dispose();
    await _calls?.dispose();
    await _location?.stop();
    final tel = ref.read(telephonyProvider);
    if (tel.supported && !demo) await tel.stopMonitoring();
  }
}

final runtimeProvider = Provider<AppRuntime?>((ref) {
  final key = ref.watch(sessionProvider.select((s) => s is SignedIn ? '${s.me.user.id}:${s.demo}' : null));
  if (key == null) return null;
  final rt = AppRuntime(ref, demo: key.endsWith(':true'))..start();
  ref.onDispose(rt.dispose);
  return rt;
});
