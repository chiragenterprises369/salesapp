import 'dart:async';

import 'package:dio/dio.dart';

import 'token_store.dart';

const apiBasePath = '/api/v1';
const refreshCookie = 'vistar_rt';

/// HTTP client for the Vistar API with the auth interceptor:
/// - Bearer access token from memory, refreshed shortly before it expires;
/// - one refresh at a time (concurrent 401s wait for the same rotation);
/// - the rotated refresh token replaces the old one; a rejected refresh (expired, revoked or
///   reused token: the server revokes the whole family) ends the session.
class ApiClient {
  ApiClient({
    required String serverUrl,
    required this.tokens,
    required this.onSessionEnded,
    this.clientName = 'vistar-employee',
    HttpClientAdapter? adapter,
  }) : baseUrl = _normalise(serverUrl) {
    final options = BaseOptions(
      baseUrl: '$baseUrl$apiBasePath',
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 20),
      sendTimeout: const Duration(seconds: 60),
      headers: {'Accept': 'application/json', 'X-Vistar-Client': clientName},
      // Browser: send and receive the httpOnly refresh cookie.
      extra: {'withCredentials': true},
    );
    dio = Dio(options);
    _auth = Dio(options);
    if (adapter != null) {
      dio.httpClientAdapter = adapter;
      _auth.httpClientAdapter = adapter;
    }
    dio.interceptors.add(_AuthInterceptor(this));
  }

  final String baseUrl;
  final TokenStore tokens;
  final void Function(String reason) onSessionEnded;
  final String clientName;
  late final Dio dio;

  /// Bare client for login/refresh/logout (no auth interceptor, no retry loop).
  late final Dio _auth;
  Future<String?>? _refreshing;

  static String _normalise(String url) {
    var u = url.trim();
    if (u.isEmpty) u = 'http://localhost:4000';
    if (!u.startsWith('http://') && !u.startsWith('https://')) u = 'http://$u';
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    if (u.endsWith(apiBasePath)) u = u.substring(0, u.length - apiBasePath.length);
    return u;
  }

  /// POST /auth/login. Returns the raw AuthSession body ({ accessToken, expiresIn, me }).
  Future<Map<String, dynamic>> login(String email, String password) async {
    final res = await _auth.post<Map<String, dynamic>>('/auth/login', data: {'email': email, 'password': password});
    await _takeTokens(res);
    return res.data!;
  }

  /// Rotates the refresh token. Returns the new access token, or null when the session is over.
  Future<String?> refresh() => _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<String?> _doRefresh() async {
    final stored = await tokens.readRefresh();
    if (stored == null && !tokens.cookieManaged) return null;
    try {
      final res = await _auth.post<Map<String, dynamic>>(
        '/auth/refresh',
        options: Options(headers: {if (stored != null) 'Cookie': '$refreshCookie=$stored'}),
      );
      await _takeTokens(res);
      return tokens.accessToken;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 403) {
        // Expired, revoked or reused (theft signal): the server revoked the family. Sign out.
        tokens.clearAccess();
        await tokens.writeRefresh(null);
        return null;
      }
      rethrow;
    }
  }

  Future<void> logout() async {
    final stored = await tokens.readRefresh();
    try {
      await _auth.post<dynamic>(
        '/auth/logout',
        options: Options(headers: {
          if (tokens.accessToken != null) 'Authorization': 'Bearer ${tokens.accessToken}',
          if (stored != null) 'Cookie': '$refreshCookie=$stored',
        }),
      );
    } catch (_) {
      // Best effort: the local session ends either way.
    } finally {
      tokens.clearAccess();
      await tokens.writeRefresh(null);
    }
  }

  Future<void> _takeTokens(Response<Map<String, dynamic>> res) async {
    final body = res.data ?? const {};
    final access = body['accessToken'];
    if (access is String) {
      tokens.accessToken = access;
      final exp = body['expiresIn'];
      tokens.accessExpiresAt = exp is num ? DateTime.now().add(Duration(seconds: exp.toInt())) : null;
    }
    final rt = (body['refreshToken'] is String ? body['refreshToken'] as String : null) ?? refreshFromSetCookie(res.headers.map['set-cookie']);
    if (rt != null) await tokens.writeRefresh(rt);
  }

  /// Extracts `vistar_rt=<value>` from Set-Cookie headers (native only; browsers hide them).
  static String? refreshFromSetCookie(List<String>? headers) {
    if (headers == null) return null;
    for (final h in headers) {
      for (final part in h.split(RegExp(r',(?=\s*[A-Za-z0-9_\-]+=)'))) {
        final m = RegExp('(?:^|;\\s*)$refreshCookie=([^;]*)').firstMatch(part.trim());
        if (m != null) {
          final v = m[1]!;
          return v.isEmpty ? null : Uri.decodeComponent(v);
        }
      }
    }
    return null;
  }
}

class _AuthInterceptor extends Interceptor {
  _AuthInterceptor(this.client);
  final ApiClient client;
  static const _retried = 'vistar_retried';

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final t = client.tokens;
    if (!t.accessValid && (t.accessToken != null || await t.readRefresh() != null || t.cookieManaged)) {
      try {
        await client.refresh();
      } catch (_) {
        // Offline: send with the old token; the 401 path or the network error handles it.
      }
    }
    final token = client.tokens.accessToken;
    if (token != null) options.headers['Authorization'] = 'Bearer $token';
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final res = err.response;
    final opts = err.requestOptions;
    if (res?.statusCode != 401 || opts.extra[_retried] == true) return handler.next(err);
    String? token;
    try {
      token = await client.refresh();
    } catch (_) {
      return handler.next(err);
    }
    if (token == null) {
      client.onSessionEnded('Your session ended. Sign in again.');
      return handler.next(err);
    }
    try {
      opts.extra[_retried] = true;
      opts.headers['Authorization'] = 'Bearer $token';
      final retry = await client.dio.fetch<dynamic>(opts);
      handler.resolve(retry);
    } on DioException catch (e) {
      handler.next(e);
    }
  }
}
