import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../data/models.dart';

/// Server URL baked in at build time (`--dart-define=VISTAR_API_URL=...`). Changeable in the
/// hidden developer sheet on the login screen (long-press the logo).
const _defineUrl = String.fromEnvironment('VISTAR_API_URL');

String defaultServerUrl() {
  if (_defineUrl.isNotEmpty) return _defineUrl;
  if (kIsWeb) {
    // Web preview: same host as the page, API port 4000 (or ?api=http://host:port).
    final api = Uri.base.queryParameters['api'];
    if (api != null && api.isNotEmpty) return api;
    return '${Uri.base.scheme}://${Uri.base.host}:4000';
  }
  // Android emulator loopback to the host; real phones use the LAN address set in the sheet.
  return 'http://10.0.2.2:4000';
}

final sharedPrefsProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError('override in main'));

@immutable
class AppPrefs {
  const AppPrefs({
    required this.serverUrl,
    this.installationId = '',
    this.demoMode = false,
    this.theme,
    this.locationConsent = false,
    this.callSetupDone = false,
    this.zoneDetection = false,
    this.lastEmail = '',
  });

  final String serverUrl;

  /// Generated once per install (POST /me/devices installationId). Android uses the native id.
  final String installationId;

  /// Explicit Demo mode (off by default): fake data, no server.
  final bool demoMode;

  /// Local theme choice, applied before the server settings load (no flash).
  final ThemePreference? theme;
  final bool locationConsent;
  final bool callSetupDone;

  /// Automatic office zone detection (beacons and office Wi-Fi), opt-in on the phone.
  final bool zoneDetection;
  final String lastEmail;

  AppPrefs copyWith({String? serverUrl, bool? demoMode, ThemePreference? theme, bool? locationConsent, bool? callSetupDone, bool? zoneDetection, String? lastEmail}) => AppPrefs(
        serverUrl: serverUrl ?? this.serverUrl,
        installationId: installationId,
        demoMode: demoMode ?? this.demoMode,
        theme: theme ?? this.theme,
        locationConsent: locationConsent ?? this.locationConsent,
        callSetupDone: callSetupDone ?? this.callSetupDone,
        zoneDetection: zoneDetection ?? this.zoneDetection,
        lastEmail: lastEmail ?? this.lastEmail,
      );
}

class AppPrefsController extends Notifier<AppPrefs> {
  SharedPreferences get _p => ref.read(sharedPrefsProvider);

  @override
  AppPrefs build() {
    final p = ref.watch(sharedPrefsProvider);
    final theme = p.getString('vistar.theme');
    var install = p.getString('vistar.installationId');
    if (install == null || install.isEmpty) {
      install = const Uuid().v4();
      p.setString('vistar.installationId', install);
    }
    return AppPrefs(
      serverUrl: p.getString('vistar.serverUrl') ?? defaultServerUrl(),
      installationId: install,
      demoMode: p.getBool('vistar.demo') ?? false,
      theme: ThemePreference.values.where((t) => t.name == theme).firstOrNull,
      locationConsent: p.getBool('vistar.locationConsent') ?? false,
      callSetupDone: p.getBool('vistar.callSetupDone') ?? false,
      zoneDetection: p.getBool('vistar.zoneDetection') ?? false,
      lastEmail: p.getString('vistar.lastEmail') ?? '',
    );
  }

  Future<void> setZoneDetection(bool v) async {
    await _p.setBool('vistar.zoneDetection', v);
    state = state.copyWith(zoneDetection: v);
  }

  Future<void> setServerUrl(String url) async {
    await _p.setString('vistar.serverUrl', url.trim());
    state = state.copyWith(serverUrl: url.trim());
  }

  Future<void> setDemoMode(bool on) async {
    await _p.setBool('vistar.demo', on);
    state = state.copyWith(demoMode: on);
  }

  Future<void> setTheme(ThemePreference t) async {
    await _p.setString('vistar.theme', t.name);
    state = state.copyWith(theme: t);
  }

  Future<void> setLocationConsent(bool v) async {
    await _p.setBool('vistar.locationConsent', v);
    state = state.copyWith(locationConsent: v);
  }

  Future<void> setCallSetupDone(bool v) async {
    await _p.setBool('vistar.callSetupDone', v);
    state = state.copyWith(callSetupDone: v);
  }

  Future<void> setLastEmail(String v) async {
    await _p.setString('vistar.lastEmail', v);
    state = state.copyWith(lastEmail: v);
  }
}

final prefsProvider = NotifierProvider<AppPrefsController, AppPrefs>(AppPrefsController.new);
