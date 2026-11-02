/// Small, forgiving JSON readers. The API contract is strict, but the app must never crash on a
/// field a newer server adds or an older one leaves out.
library;

typedef Json = Map<String, dynamic>;

Json obj(Object? v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};

String str(Object? v, [String fallback = '']) => v is String ? v : (v == null ? fallback : v.toString());

String? strOrNull(Object? v) => v is String && v.isNotEmpty ? v : (v == null || v is String ? null : v.toString());

int toInt(Object? v, [int fallback = 0]) {
  if (v is int) return v;
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? num.tryParse(v)?.toInt() ?? fallback;
  return fallback;
}

int? toIntOrNull(Object? v) => v == null ? null : (v is num ? v.toInt() : int.tryParse('$v'));

double? toDoubleOrNull(Object? v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);

bool toBool(Object? v, [bool fallback = false]) => v is bool ? v : fallback;

DateTime? date(Object? v) => v is String ? DateTime.tryParse(v)?.toUtc() : null;

String? iso(DateTime? d) => d?.toUtc().toIso8601String();

List<T> listOf<T>(Object? v, T Function(Json) f) =>
    v is List ? v.whereType<Map<dynamic, dynamic>>().map((e) => f(e.cast<String, dynamic>())).toList() : <T>[];

List<String> strings(Object? v) => v is List ? v.map((e) => '$e').toList() : const <String>[];

/// `{ items: [...] }` or a cursor page `{ items, nextCursor, total }`.
class Page<T> {
  const Page(this.items, {this.nextCursor, this.total});

  final List<T> items;
  final String? nextCursor;
  final int? total;

  static Page<T> parse<T>(Object? raw, T Function(Json) f) {
    final j = obj(raw);
    return Page<T>(listOf(j['items'], f), nextCursor: strOrNull(j['nextCursor']), total: toIntOrNull(j['total']));
  }
}
