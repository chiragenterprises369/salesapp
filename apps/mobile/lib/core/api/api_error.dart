import 'package:dio/dio.dart';

/// API error envelope `{ error: { code, message, details?, requestId } }` (ApiErrorSchema).
class ApiFailure implements Exception {
  const ApiFailure({required this.code, required this.message, this.status, this.network = false});

  final String code;
  final String message;
  final int? status;

  /// No response at all (offline, DNS, timeout): the caller may fall back to the cache or queue.
  final bool network;

  bool get isAuth => status == 401;

  static ApiFailure from(Object error) {
    if (error is ApiFailure) return error;
    if (error is DioException) {
      final res = error.response;
      if (res == null) {
        return const ApiFailure(code: 'NETWORK', message: 'No connection to the server. Check your internet and try again.', network: true);
      }
      final data = res.data;
      if (data is Map && data['error'] is Map) {
        final e = (data['error'] as Map).cast<String, dynamic>();
        return ApiFailure(code: '${e['code'] ?? 'ERROR'}', message: '${e['message'] ?? 'Something went wrong'}', status: res.statusCode);
      }
      final status = res.statusCode ?? 0;
      return ApiFailure(
        code: status >= 500 ? 'SERVICE_UNAVAILABLE' : 'HTTP_$status',
        message: status >= 500 ? 'The server is having trouble. Try again in a minute.' : 'The request failed ($status).',
        status: status,
        network: status == 502 || status == 503 || status == 504,
      );
    }
    return ApiFailure(code: 'UNKNOWN', message: '$error');
  }

  @override
  String toString() => 'ApiFailure($code, $status): $message';
}

/// True when the error means "could not reach the server" (use cache, queue the write).
bool isNetworkError(Object error) => ApiFailure.from(error).network;
