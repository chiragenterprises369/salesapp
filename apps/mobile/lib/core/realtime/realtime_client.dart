import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

/// Query scopes to refetch after a reconnect (SYNC_SCOPES).
const syncScopes = ['leads', 'board', 'tasks', 'calls', 'conversations', 'notifications', 'dashboard', 'team-floor', 'presence', 'attendance', 'workspace'];

/// Server events the app listens to (packages/shared/src/events.ts, change #19).
const realtimeEvents = [
  'employee.status_changed',
  'employee.zone_changed',
  'notification.created',
  'task.created',
  'task.updated',
  'task.overdue',
  'lead.created',
  'lead.updated',
  'lead.assigned',
  'stage.changed',
  'call.started',
  'call.ended',
  'call.updated',
  'message.received',
  'message.sent',
  'message.status_updated',
  'conversation.updated',
  'attendance.checked_in',
  'attendance.checked_out',
  'workspace.branding_changed',
  'floor.published',
  'theme.changed',
];

/// Socket.IO client for namespace `/realtime` (path /socket.io). Handshake
/// `{ token, client, appVersion, fresh }` (SocketAuthSchema; `fresh` on the first connect right after
/// loading data skips the server's `sync.required`). A socket `presence.heartbeat` goes out every
/// 15 s while connected; after every reconnect the server sends `sync.required` and the app
/// refetches. `auth.expired` refreshes the token and reconnects.
class RealtimeClient {
  RealtimeClient({
    required this.serverUrl,
    required this.token,
    required this.refreshToken,
    required this.onEvent,
    required this.onResync,
    required this.client,
    this.appVersion,
    this.deviceId,
    this.onConnectionChanged,
    this.heartbeatEvery = const Duration(seconds: 15),
  });

  final String serverUrl;
  final String? Function() token;
  final Future<String?> Function() refreshToken;
  final void Function(String type, Map<String, dynamic> event) onEvent;
  final void Function(List<String> scopes) onResync;

  /// android | web
  final String client;
  final String? appVersion;
  final String? Function()? deviceId;
  final void Function(bool connected)? onConnectionChanged;
  final Duration heartbeatEvery;

  io.Socket? _socket;
  Timer? _heartbeat;
  Timer? _retry;
  bool _everConnected = false;
  bool _disposed = false;
  String _activity = 'active';
  String? _currentLeadId;

  bool get connected => _socket?.connected ?? false;

  Map<String, dynamic> handshake() => {
        'token': token() ?? '',
        'client': client,
        if (appVersion != null) 'appVersion': appVersion,
        // First connect follows a fresh load of every screen; reconnects get sync.required.
        'fresh': !_everConnected,
      };

  void connect() {
    if (_socket != null || _disposed) return;
    final s = io.io(
      '$serverUrl/realtime',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setPath('/socket.io')
          .enableForceNew()
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(15000)
          .setAuthFn((cb) => cb(handshake()))
          .build(),
    );
    s.onConnect((_) {
      onConnectionChanged?.call(true);
      _startHeartbeat();
      _everConnected = true;
    });
    s.onDisconnect((_) {
      onConnectionChanged?.call(false);
      _heartbeat?.cancel();
    });
    s.onConnectError((_) => _refreshAndReconnect());
    s.on('auth.expired', (_) => _refreshAndReconnect());
    s.on('sync.required', (data) {
      final scopes = data is Map && data['scopes'] is List ? (data['scopes'] as List).map((e) => '$e').toList() : syncScopes;
      onResync(scopes);
    });
    for (final type in realtimeEvents) {
      s.on(type, (data) {
        if (data is Map) onEvent(type, data.cast<String, dynamic>());
      });
    }
    _socket = s;
    s.connect();
  }

  /// A rejected handshake (expired token) is not retried by Socket.IO: refresh, then reconnect.
  void _refreshAndReconnect() {
    onConnectionChanged?.call(false);
    _retry?.cancel();
    _retry = Timer(const Duration(seconds: 3), () async {
      if (_disposed) return;
      try {
        await refreshToken();
      } catch (_) {}
      final s = _socket;
      if (s != null && !s.connected) s.connect();
    });
  }

  void _startHeartbeat() {
    _heartbeat?.cancel();
    sendHeartbeat();
    _heartbeat = Timer.periodic(heartbeatEvery, (_) => sendHeartbeat());
  }

  void sendHeartbeat() {
    final s = _socket;
    if (s == null || !s.connected) return;
    final id = deviceId?.call();
    s.emit('presence.heartbeat', {
      'activity': _activity,
      'currentLeadId': _currentLeadId,
      'client': client,
      if (id != null && id.length <= 64) 'deviceId': id,
    });
  }

  /// active (app on screen), hidden (in the background with the foreground service), idle.
  void setActivity(String activity, {String? currentLeadId}) {
    _activity = activity;
    _currentLeadId = currentLeadId;
    sendHeartbeat();
  }

  /// [signOut]: a deliberate disconnect, which the server treats as a logout of this device.
  void dispose({bool signOut = false}) {
    _disposed = true;
    _heartbeat?.cancel();
    _retry?.cancel();
    final s = _socket;
    _socket = null;
    if (s == null) return;
    if (signOut) s.disconnect();
    s.dispose();
  }
}
