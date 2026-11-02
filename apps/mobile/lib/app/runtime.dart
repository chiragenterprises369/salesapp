import 'dart:async';

import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/calls/call_tracker.dart';
import '../core/location/location_tracker.dart';
import '../core/presence/presence_loop.dart';
import '../core/realtime/realtime_client.dart';
import '../core/time/working_hours.dart';
import '../data/models.dart';
import '../data/repositories.dart';
import '../features/data.dart';
import '../platform/push.dart';
import '../platform/telephony.dart';
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

/// The screen in use (APP_SCREENS), reported with every heartbeat.
class CurrentScreenController extends Notifier<String> {
  @override
  String build() => 'home';
  void set(String s) => state = s;
}

final currentScreenProvider = NotifierProvider<CurrentScreenController, String>(CurrentScreenController.new);

/// Background work while signed in: device registration, heartbeats (REST, with the screen and the
/// office zone) and the realtime socket, the offline write queue, SIM call tracking inside working
/// hours, office zone detection, field GPS while checked in, and push.
class AppRuntime {
  AppRuntime(this.ref, {required this.demo});

  final Ref ref;
  final bool demo;

  RealtimeClient? _realtime;
  Heartbeater? _heartbeat;
  ZoneTracker? _zones;
  CallTracker? _calls;
  LocationTracker? _location;
  Timer? _flushTimer;
  Timer? _hoursTimer;
  AppLifecycleListener? _lifecycle;
  VoidCallback? _routerListener;
  GoRouter? _router;
  TelephonyService? _telephony;
  final _subs = <StreamSubscription<dynamic>>[];
  bool _disposed = false;
  bool _signingOut = false;
  String _activity = 'active';
  String? _appVersion;
  int? _appBuild;

  Me? get _me => ref.read(meProvider);
  CallTracker? get callTracker => _calls;
  ZoneTracker? get zoneTracker => _zones;
  String get _client => isAndroidApp ? 'android' : 'web';

  void start() {
    _telephony = ref.read(telephonyProvider);
    _flushTimer = Timer.periodic(const Duration(seconds: 30), (_) => flush());
    unawaited(flush());
    _lifecycle = AppLifecycleListener(
      onResume: () {
        _setActivity('active');
        unawaited(flush());
        ref.invalidate(todayProvider);
        ref.invalidate(teamFloorProvider);
        unawaited(_applyWorkingHours());
      },
      onHide: () => _setActivity('hidden'),
    );
    _watchScreen();
    if (demo) return;
    _subs.add(outsideHoursSignal.stream.listen((_) => onOutsideHours()));
    ref.listen<AsyncValue<AttendanceDay>>(attendanceProvider, (_, next) => _syncLocation(next.value));
    ref.listen<bool>(prefsProvider.select((p) => p.zoneDetection), (_, _) => unawaited(_applyWorkingHours()));
    final scanner = ref.read(zoneScannerProvider);
    if (scanner.supported) _zones = ZoneTracker(scanner: scanner);
    unawaited(_boot());
  }

  Future<void> _boot() async {
    try {
      final info = await PackageInfo.fromPlatform();
      _appVersion = info.version.isEmpty ? '1.0.0' : info.version;
      _appBuild = int.tryParse(info.buildNumber);
    } catch (_) {
      _appVersion = '1.0.0';
    }
    if (_disposed) return;
    // Device first: its id goes with heartbeats, calls, check-ins and locations.
    await _registerDevice(null);
    if (_disposed) return;
    _startHeartbeat();
    _connectRealtime();
    await _startCallTracking();
    await _applyWorkingHours();
    unawaited(_startPush());
  }

  Future<void> flush() async {
    if (_disposed) return;
    try {
      final done = await ref.read(writeQueueProvider).flush(ref.read(writeSenderProvider));
      if (done > 0 && !_disposed) ref.invalidate(callsProvider);
    } catch (_) {}
  }

  void _setActivity(String a) {
    _activity = a;
    _realtime?.setActivity(a);
    unawaited(_heartbeat?.beat(force: true));
  }

  // ------------------------------------------------------------ screen in use

  void _watchScreen() {
    final router = ref.read(routerProvider);
    _router = router;
    void update() {
      if (_disposed) return;
      final path = router.routerDelegate.currentConfiguration.uri.path;
      final screen = screenForPath(path);
      if (ref.read(currentScreenProvider) == screen) return;
      ref.read(currentScreenProvider.notifier).set(screen);
      unawaited(_heartbeat?.beat(force: true));
    }

    _routerListener = update;
    router.routerDelegate.addListener(update);
    // Not during this provider's build: Riverpod forbids changing other providers there.
    Future.microtask(update);
  }

  // ------------------------------------------------------------ heartbeat and realtime

  void _startHeartbeat() {
    _heartbeat = Heartbeater(
      presence: ref.read(presenceRepositoryProvider),
      client: _client,
      screen: () => ref.read(currentScreenProvider),
      activity: () => _activity,
      deviceId: () => ref.read(deviceIdProvider),
      zones: _zones,
      onPresence: (p) {
        if (_disposed) return;
        ref.read(myPresenceProvider.notifier).applyServer(p);
      },
    )..start();
  }

  void _connectRealtime() {
    final client = ref.read(apiClientProvider);
    _realtime = RealtimeClient(
      serverUrl: client.baseUrl,
      token: () => client.tokens.accessToken,
      refreshToken: client.refresh,
      client: _client,
      appVersion: _appVersion,
      deviceId: () => ref.read(deviceIdProvider),
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
        case 'team-floor' || 'dashboard' || 'presence':
          ref.invalidate(teamFloorProvider);
          unawaited(_heartbeat?.beat(force: true));
        case 'attendance':
          ref.invalidate(attendanceProvider);
        case 'workspace':
          unawaited(ref.read(sessionProvider.notifier).reloadMe());
          ref.invalidate(floorPlanProvider);
      }
    }
  }

  void _onEvent(String type, Map<String, dynamic> event) {
    if (_disposed) return;
    final p = obj(event['payload']);
    final me = _me;
    switch (type) {
      case 'employee.status_changed':
        final status = PresenceStatus.best(p['presence'], p['status']);
        final userId = str(p['userId']);
        final version = toIntOrNull(p['version']);
        final activity = p['activity'] is Map ? PresenceActivity.parse(p['activity']) : null;
        ref.read(teamFloorProvider.notifier).applyStatus(userId, status, version: version, leadName: activity?.leadName, at: date(p['since']) ?? date(p['at']), activity: activity);
        if (me != null && userId == me.user.id) ref.read(myPresenceProvider.notifier).applyEvent(status, version: version);
      case 'employee.zone_changed':
        final userId = str(p['userId']);
        final zoneId = strOrNull(p['zoneId']);
        final plan = ref.read(floorPlanProvider).value;
        final zone = zoneId == null
            ? null
            : ZoneLocation(zoneId: zoneId, zoneName: plan?.zone(zoneId)?.label, source: str(p['source'], 'manual'), confidence: toDoubleOrNull(p['confidence']) ?? 0, since: date(p['at']), at: date(p['at']));
        ref.read(teamFloorProvider.notifier).applyZone(userId, zone);
        if (me != null && userId == me.user.id) ref.read(myPresenceProvider.notifier).applyZone(zone);
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
        final id = strOrNull(obj(p['lead'])['id']) ?? strOrNull(p['leadId']);
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
      case 'attendance.checked_in' || 'attendance.checked_out':
        if (me != null && str(obj(p['user'])['id']) == me.user.id) ref.invalidate(attendanceProvider);
        ref.invalidate(teamFloorProvider);
      case 'floor.published':
        ref.invalidate(floorPlanProvider);
        ref.invalidate(teamFloorProvider);
      case 'workspace.branding_changed' || 'theme.changed':
        unawaited(ref.read(sessionProvider.notifier).reloadMe());
    }
  }

  // ------------------------------------------------------------ device and push

  Future<void> _registerDevice(String? fcmToken) async {
    try {
      final caps = await ref.read(telephonyProvider).capabilities();
      final install = isAndroidApp ? caps.installId : ref.read(prefsProvider).installationId;
      final device = await ref.read(accountRepositoryProvider).registerDevice(
            installationId: install,
            platform: _client,
            fcmToken: fcmToken,
            appVersion: _appVersion ?? '1.0.0',
            appBuild: _appBuild,
            model: isAndroidApp ? '${caps.manufacturer} ${caps.model}'.trim() : null,
            osVersion: isAndroidApp && caps.sdkInt > 0 ? 'Android SDK ${caps.sdkInt}' : null,
          );
      if (!_disposed) ref.read(deviceIdProvider.notifier).set(device.id);
    } catch (_) {
      // Older server or offline: heartbeats and calls still work without a device id.
    }
  }

  Future<void> _startPush() async {
    try {
      final config = await ref.read(appConfigProvider.future);
      final push = ref.read(pushProvider);
      final token = await push.start(config);
      if (token == null || _disposed) return;
      await _registerDevice(token);
      _subs.add(push.tokenRefresh.listen((t) => unawaited(_registerDevice(t))));
      _subs.add(push.taps.listen((data) => ref.read(routerProvider).push(routeForNotification(data))));
      _subs.add(push.foreground.listen((data) {
        ref.invalidate(notificationsProvider);
        ref.read(inAppNoticeProvider.notifier).show(InAppNotice('${data['title'] ?? 'Vistar'}', data['body'] as String?, routeForNotification(data)));
      }));
    } catch (_) {
      // Push is optional.
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
      deviceId: () => ref.read(deviceIdProvider),
      onQueued: () => unawaited(flush()),
    );
    await _calls!.start();
  }

  /// Inside working hours: the call-tracking foreground service and office zone detection run;
  /// outside they stop. Then the next flip is scheduled.
  Future<void> _applyWorkingHours() async {
    if (_disposed || demo) return;
    final me = _me;
    if (me == null) return;
    final hours = WorkingHours.forMe(me);
    final now = ref.read(clockProvider)().toUtc();
    final within = hours.isWithin(now);
    final tel = ref.read(telephonyProvider);
    if (tel.supported) {
      final caps = await tel.capabilities();
      if (within && caps.readPhoneState) {
        if (!caps.monitoring) await tel.startMonitoring(text: 'Working hours: ${hours.todayLabel(now) ?? 'today'}. Only work calls are reported.');
      } else if (caps.monitoring) {
        await tel.stopMonitoring();
      }
    }
    _syncZones(within);
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
    }
    await _applyWorkingHours();
  }

  // ------------------------------------------------------------ office zones

  void _syncZones(bool withinHours) {
    final z = _zones;
    if (z == null) return;
    if (withinHours && ref.read(prefsProvider).zoneDetection) {
      z.start();
    } else {
      z.stop();
    }
  }

  /// QR marker or manual pick: POST /me/presence/zone right away.
  Future<MyPresence> sendZone(ZoneSignal signal) async {
    final p = await ref.read(presenceRepositoryProvider).zone(signal);
    if (!_disposed) {
      ref.read(myPresenceProvider.notifier).applyServer(p);
      ref.read(myPresenceProvider.notifier).applyZone(p.location);
    }
    return p;
  }

  // ------------------------------------------------------------ field GPS

  void _syncLocation(AttendanceDay? day) {
    if (_disposed || demo) return;
    final me = _me;
    final loc = ref.read(locationProvider);
    if (me == null || !loc.canTrack) return;
    final within = WorkingHours.forMe(me).isWithin(ref.read(clockProvider)().toUtc());
    final should = day != null && day.fieldStaff && day.checkedIn && day.consentGiven && day.trackingEnabled && within && (day.trackingActive || day.insideWorkingHours);
    if (should) {
      _location ??= LocationTracker(
        location: loc,
        queue: ref.read(writeQueueProvider),
        interval: Duration(seconds: day.locationIntervalSec.clamp(30, 900)),
        onPoint: (f) => ref.read(trailProvider.notifier).add(f),
        onQueued: () => unawaited(flush()),
      );
      _location!.start();
    } else if (_location?.running ?? false) {
      unawaited(_location!.stop());
    }
  }

  /// The server refused location points outside working hours (or without a session): stop GPS.
  void onOutsideHours() {
    unawaited(_location?.stop(flush: false));
    ref.invalidate(attendanceProvider);
  }

  // ------------------------------------------------------------ teardown

  /// Called by sign-out: the socket disconnect then counts as a logout of this device.
  void prepareSignOut() => _signingOut = true;

  Future<void> dispose() async {
    // No ref.read here: Riverpod forbids it inside onDispose.
    _disposed = true;
    _flushTimer?.cancel();
    _hoursTimer?.cancel();
    _lifecycle?.dispose();
    if (_routerListener != null) _router?.routerDelegate.removeListener(_routerListener!);
    for (final s in _subs) {
      await s.cancel();
    }
    _heartbeat?.stop();
    _zones?.stop();
    _realtime?.dispose(signOut: _signingOut);
    await _calls?.dispose();
    await _location?.stop();
    final tel = _telephony;
    if (tel != null && tel.supported && !demo) await tel.stopMonitoring();
  }
}

final runtimeProvider = Provider<AppRuntime?>((ref) {
  final key = ref.watch(sessionProvider.select((s) => s is SignedIn ? '${s.me.user.id}:${s.demo}' : null));
  if (key == null) return null;
  final rt = AppRuntime(ref, demo: key.endsWith(':true'))..start();
  ref.onDispose(rt.dispose);
  return rt;
});
