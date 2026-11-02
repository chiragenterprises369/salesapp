import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

/// Query scopes to refetch after a reconnect (SYNC_SCOPES).
const syncScopes = ['leads', 'board', 'tasks', 'calls', 'conversations', 'notifications', 'dashboard', 'team-floor'];

/// Server events the app listens to (packages/shared/src/events.ts).
const realtimeEvents = [
  'employee.status_changed',
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
  'theme.changed',
];

/// Socket.IO client for `/realtime` with the access token in the handshake, a presence
/// heartbeat every 20 s (SPEC 29.2: offline after 45 s without one), and a full re-fetch of the
/// snapshot after every reconnect.
class RealtimeClient {
  RealtimeClient({
    required this.serverUrl,
    required this.token,
    required this.refreshToken,
    required this.onEvent,
    required this.onResync,
    this.onConnectionChanged,
    this.heartbeatEvery = const Duration(seconds: 20),
  });

  final String serverUrl;
  final String? Function() token;
  final Future<String?> Function() refreshToken;
  final void Function(String type, Map<String, dynamic> event) onEvent;
  final void Function(List<String> scopes) onResync;
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
          .setAuthFn((cb) => cb({'token': token() ?? ''}))
          .build(),
    );
    s.onConnect((_) {
      onConnectionChanged?.call(true);
      _startHeartbeat();
      if (_everConnected) onResync(syncScopes);
      _everConnected = true;
    });
    s.onDisconnect((_) {
      onConnectionChanged?.call(false);
      _heartbeat?.cancel();
    });
    s.onConnectError((_) async {
      onConnectionChanged?.call(false);
      // Rejected handshake (expired token) is not retried by Socket.IO: refresh, then reconnect.
      _retry?.cancel();
      _retry = Timer(const Duration(seconds: 3), () async {
        if (_disposed) return;
        try {
          await refreshToken();
        } catch (_) {}
        if (!(_socket?.connected ?? true)) _socket?.connect();
      });
    });
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

  void _startHeartbeat() {
    _heartbeat?.cancel();
    sendHeartbeat();
    _heartbeat = Timer.periodic(heartbeatEvery, (_) => sendHeartbeat());
  }

  void sendHeartbeat() {
    final s = _socket;
    if (s == null || !s.connected) return;
    s.emit('presence.heartbeat', {'activity': _activity, 'currentLeadId': _currentLeadId});
  }

  /// active (app on screen), hidden (app in background with the foreground service), idle.
  void setActivity(String activity, {String? currentLeadId}) {
    _activity = activity;
    _currentLeadId = currentLeadId;
    sendHeartbeat();
  }

  void dispose() {
    _disposed = true;
    _heartbeat?.cancel();
    _retry?.cancel();
    _socket?.dispose();
    _socket = null;
  }
}
