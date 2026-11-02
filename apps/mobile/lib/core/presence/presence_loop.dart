import 'dart:async';

import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../platform/zones.dart';

/// Maps an app route to the `screen` reported with heartbeats (APP_SCREENS).
String screenForPath(String path) {
  final seg = Uri.parse(path).pathSegments;
  if (seg.isEmpty) return 'home';
  return switch (seg.first) {
    'today' => 'home',
    'leads' => seg.length > 1 ? 'lead_detail' : 'leads',
    'calls' || 'call-setup' => 'calls',
    'inbox' => seg.length > 1 ? 'conversation' : 'inbox',
    'tasks' => 'tasks',
    'team-floor' || 'office-zone' => 'team_floor',
    'attendance' => 'attendance',
    'performance' => 'reports',
    'preferences' || 'profile' || 'about' => 'settings',
    _ => 'other',
  };
}

/// Chooses what to report from one scan cycle: beacons win (room level, about 1-3 m), then the
/// office Wi-Fi (room to floor level). Null when nothing was heard.
ZoneSignal? pickZoneSignal({required List<BeaconReading> beacons, required List<WifiReading> wifi, required DateTime at}) {
  if (beacons.isNotEmpty) {
    final strongest = [...beacons]..sort((a, b) => b.rssi.compareTo(a.rssi));
    return ZoneSignal(source: 'ble', at: at, beacons: strongest.take(10).toList());
  }
  if (wifi.isNotEmpty) {
    final strongest = [...wifi]..sort((a, b) => b.rssi.compareTo(a.rssi));
    return ZoneSignal(source: 'wifi', at: at, wifi: strongest.take(15).toList());
  }
  return null;
}

/// Automatic office zone detection (SPEC 29.11) on Android: a short BLE scan and the Wi-Fi scan
/// results every [every]; the latest observation rides on the next heartbeat. The server maps
/// beacons and access points to zones through the company's markers and smooths the result, so
/// one noisy reading does not move a person.
class ZoneTracker {
  ZoneTracker({required this.scanner, this.every = const Duration(seconds: 60), this.wifiScanEvery = const Duration(minutes: 2), DateTime Function()? clock})
      : _clock = clock ?? DateTime.now;

  final ZoneScanner scanner;
  final Duration every;

  /// New Wi-Fi scans are requested at most this often (Android allows 4 per 2 minutes).
  final Duration wifiScanEvery;
  final DateTime Function() _clock;

  Timer? _timer;
  ZoneSignal? _latest;
  bool _sent = true;
  DateTime? _lastWifiScan;
  bool _scanning = false;

  bool get running => _timer != null;
  ZoneSignal? get latest => _latest;

  void start() {
    if (running || !scanner.supported) return;
    unawaited(scanOnce());
    _timer = Timer.periodic(every, (_) => unawaited(scanOnce()));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<ZoneSignal?> scanOnce() async {
    if (_scanning) return _latest;
    _scanning = true;
    try {
      final caps = await scanner.capabilities();
      final now = _clock().toUtc();
      final beacons = caps.canScanBeacons ? await scanner.scanBeacons() : const <BeaconReading>[];
      var wifi = const <WifiReading>[];
      if (beacons.isEmpty && caps.canScanWifi) {
        final request = _lastWifiScan == null || now.difference(_lastWifiScan!) >= wifiScanEvery;
        if (request) _lastWifiScan = now;
        wifi = await scanner.wifi(requestScan: request);
      }
      final signal = pickZoneSignal(beacons: beacons, wifi: wifi, at: now);
      if (signal != null) {
        _latest = signal;
        _sent = false;
      }
      return signal;
    } finally {
      _scanning = false;
    }
  }

  /// The latest observation if it was not sent yet and is less than two cycles old.
  ZoneSignal? takeFresh() {
    final s = _latest;
    if (s == null || _sent) return null;
    if (_clock().toUtc().difference(s.at) > every * 2) return null;
    _sent = true;
    return s;
  }
}

/// Heartbeat every 15 s (HEARTBEAT_INTERVAL_MS) over REST with the screen in use, the app state,
/// this device and the latest zone observation. The server marks the person offline after 45 s
/// without one (D-062).
class Heartbeater {
  Heartbeater({
    required this.presence,
    required this.client,
    required this.screen,
    required this.activity,
    this.deviceId,
    this.currentLeadId,
    this.zones,
    this.onPresence,
    this.onError,
    this.every = const Duration(seconds: 15),
  });

  final PresenceRepository presence;

  /// android | web
  final String client;
  final String Function() screen;

  /// active | idle | hidden
  final String Function() activity;
  final String? Function()? deviceId;
  final String? Function()? currentLeadId;
  final ZoneTracker? zones;
  final void Function(MyPresence p)? onPresence;
  final void Function(Object e)? onError;
  final Duration every;

  Timer? _timer;
  DateTime? _last;
  bool _inFlight = false;

  bool get running => _timer != null;

  void start() {
    if (running) return;
    unawaited(beat());
    _timer = Timer.periodic(every, (_) => unawaited(beat()));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  HeartbeatBody body() {
    final act = activity();
    return HeartbeatBody(
      client: client,
      activity: act,
      screen: screen(),
      appState: client == 'android' ? (act == 'hidden' ? 'background' : 'foreground') : null,
      deviceId: deviceId?.call(),
      currentLeadId: currentLeadId?.call(),
      zone: zones?.takeFresh(),
    );
  }

  /// Sends one heartbeat now. [force] skips the 3 s throttle (screen change).
  Future<MyPresence?> beat({bool force = false}) async {
    final now = DateTime.now();
    if (_inFlight) return null;
    if (!force && _last != null && now.difference(_last!) < const Duration(seconds: 3)) return null;
    _inFlight = true;
    _last = now;
    try {
      final p = await presence.heartbeat(body());
      onPresence?.call(p);
      return p;
    } catch (e) {
      onError?.call(e);
      return null;
    } finally {
      _inFlight = false;
    }
  }
}
