import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Access token in memory only; refresh token in the Android keystore-backed secure storage.
/// In the browser the refresh token is the httpOnly `vistar_rt` cookie and never reaches Dart.
abstract class TokenStore {
  String? accessToken;
  DateTime? accessExpiresAt;

  Future<String?> readRefresh();
  Future<void> writeRefresh(String? token);

  /// The browser keeps the refresh cookie itself.
  bool get cookieManaged;

  bool get accessValid => accessToken != null && (accessExpiresAt == null || accessExpiresAt!.isAfter(DateTime.now().add(const Duration(seconds: 30))));

  void clearAccess() {
    accessToken = null;
    accessExpiresAt = null;
  }
}

class SecureTokenStore extends TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();
  final FlutterSecureStorage _storage;
  static const _key = 'vistar.refresh';

  @override
  bool get cookieManaged => kIsWeb;

  @override
  Future<String?> readRefresh() async {
    if (kIsWeb) return null;
    try {
      return await _storage.read(key: _key);
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> writeRefresh(String? token) async {
    if (kIsWeb) return;
    if (token == null) {
      await _storage.delete(key: _key);
    } else {
      await _storage.write(key: _key, value: token);
    }
  }
}

class MemoryTokenStore extends TokenStore {
  MemoryTokenStore({this.cookieManaged = false, this.refreshValue});

  /// The stored refresh token (tests inspect it).
  String? refreshValue;

  @override
  final bool cookieManaged;

  @override
  Future<String?> readRefresh() async => refreshValue;

  @override
  Future<void> writeRefresh(String? token) async => refreshValue = token;
}
