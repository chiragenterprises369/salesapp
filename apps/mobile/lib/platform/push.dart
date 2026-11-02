import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

import '../data/models.dart';
import 'telephony.dart' show isAndroidApp;

/// Push notifications (D-058). Firebase is initialised at runtime with the options from
/// GET /app/config, so one APK works with whichever Firebase project the Super Admin uploads.
/// No google-services.json is bundled. Skipped cleanly when not configured or in the browser.
abstract class PushService {
  /// Returns the device token, or null when push is off / not configured.
  Future<String?> start(AppConfig config);

  /// Notification taps (deep link `href` or data) while running, plus the launch tap.
  Stream<Map<String, dynamic>> get taps;

  /// Messages that arrive while the app is open (shown in-app).
  Stream<Map<String, dynamic>> get foreground;

  Stream<String> get tokenRefresh;
}

class FirebasePushService implements PushService {
  final _taps = StreamController<Map<String, dynamic>>.broadcast();
  final _fg = StreamController<Map<String, dynamic>>.broadcast();
  final _tokens = StreamController<String>.broadcast();
  bool _started = false;

  @override
  Stream<Map<String, dynamic>> get taps => _taps.stream;

  @override
  Stream<Map<String, dynamic>> get foreground => _fg.stream;

  @override
  Stream<String> get tokenRefresh => _tokens.stream;

  static Map<String, dynamic> _payload(RemoteMessage m) => {
        ...m.data,
        if (m.notification?.title != null) 'title': m.notification!.title,
        if (m.notification?.body != null) 'body': m.notification!.body,
      };

  @override
  Future<String?> start(AppConfig config) async {
    if (!isAndroidApp || !config.pushConfigured) return null;
    final f = config.firebase!;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp(
          options: FirebaseOptions(
            apiKey: f['apiKey']!,
            appId: f['appId']!,
            messagingSenderId: f['messagingSenderId']!,
            projectId: f['projectId']!,
            storageBucket: f['storageBucket'],
          ),
        );
      }
      final messaging = FirebaseMessaging.instance;
      final perm = await messaging.requestPermission();
      if (perm.authorizationStatus == AuthorizationStatus.denied) return null;
      if (!_started) {
        _started = true;
        FirebaseMessaging.onMessage.listen((m) => _fg.add(_payload(m)));
        FirebaseMessaging.onMessageOpenedApp.listen((m) => _taps.add(_payload(m)));
        // FCM HTTP v1 on the server targets registration tokens, so the token API stays in use.
        // ignore: deprecated_member_use
        messaging.onTokenRefresh.listen(_tokens.add);
        final initial = await messaging.getInitialMessage();
        if (initial != null) {
          // Let the router mount first.
          Timer(const Duration(milliseconds: 600), () => _taps.add(_payload(initial)));
        }
      }
      // ignore: deprecated_member_use
      return await messaging.getToken();
    } catch (_) {
      // Wrong or partial Firebase options: the app works without push.
      return null;
    }
  }
}

class NoPushService implements PushService {
  @override
  Future<String?> start(AppConfig config) async => null;

  @override
  Stream<Map<String, dynamic>> get taps => const Stream.empty();

  @override
  Stream<Map<String, dynamic>> get foreground => const Stream.empty();

  @override
  Stream<String> get tokenRefresh => const Stream.empty();
}

/// Maps a notification href (web paths like `/me/leads?lead=ID`, `/leads/ID`, `/inbox/ID`) or
/// data keys to an app route.
String routeForNotification(Map<String, dynamic> data) {
  final href = '${data['href'] ?? data['link'] ?? ''}';
  final uri = Uri.tryParse(href);
  if (uri != null && href.isNotEmpty) {
    final seg = uri.pathSegments.where((s) => s != 'me' && s != 'app').toList();
    final leadParam = uri.queryParameters['lead'];
    if (leadParam != null) return '/leads/$leadParam';
    if (seg.isNotEmpty) {
      switch (seg.first) {
        case 'leads':
          return seg.length > 1 ? '/leads/${seg[1]}' : '/leads';
        case 'inbox':
        case 'conversations':
          final c = uri.queryParameters['c'] ?? uri.queryParameters['conversation'];
          return seg.length > 1 ? '/inbox/${seg[1]}' : (c != null ? '/inbox/$c' : '/inbox');
        case 'tasks':
          return '/tasks';
        case 'calls':
          return '/calls';
        case 'team-floor':
          return '/team-floor';
        case 'attendance':
          return '/attendance';
        case 'notifications':
          return '/notifications';
      }
    }
  }
  if (data['leadId'] is String) return '/leads/${data['leadId']}';
  if (data['conversationId'] is String) return '/inbox/${data['conversationId']}';
  if (data['taskId'] is String) return '/tasks';
  return '/notifications';
}
