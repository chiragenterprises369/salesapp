import 'dart:async';
import 'dart:convert';
import 'dart:math' as math;

import 'local_store.dart';

/// Kinds of queued writes. Each is idempotent on the server (task status, deviceCallId,
/// batch ids), so a retry after a lost response never creates duplicates.
abstract final class WriteKind {
  static const taskStatus = 'task_status';
  static const deviceCallLog = 'device_call_log';
  static const recordingUpload = 'recording_upload';
  static const locationBatch = 'location_batch';
  static const callActive = 'call_active';
  static const generic = 'generic';
}

class PendingWrite {
  PendingWrite({
    required this.id,
    required this.kind,
    required this.method,
    required this.path,
    this.body,
    this.filePath,
    required this.createdAt,
    this.attempts = 0,
    DateTime? nextAttemptAt,
    this.lastError,
    this.dedupeKey,
  }) : nextAttemptAt = nextAttemptAt ?? createdAt;

  final String id;
  final String kind;
  final String method;
  final String path;
  final Map<String, dynamic>? body;

  /// For uploads (recordings): local file to send as multipart.
  final String? filePath;
  final DateTime createdAt;
  int attempts;
  DateTime nextAttemptAt;
  String? lastError;

  /// A newer write with the same key replaces an older one (e.g. task status toggled twice offline).
  final String? dedupeKey;

  Map<String, dynamic> toJson() => {
        'id': id,
        'kind': kind,
        'method': method,
        'path': path,
        'body': body,
        'filePath': filePath,
        'createdAt': createdAt.toIso8601String(),
        'attempts': attempts,
        'nextAttemptAt': nextAttemptAt.toIso8601String(),
        'lastError': lastError,
        'dedupeKey': dedupeKey,
      };

  static PendingWrite fromJson(Map<String, dynamic> j) => PendingWrite(
        id: j['id'] as String,
        kind: j['kind'] as String,
        method: j['method'] as String,
        path: j['path'] as String,
        body: (j['body'] as Map?)?.cast<String, dynamic>(),
        filePath: j['filePath'] as String?,
        createdAt: DateTime.parse(j['createdAt'] as String),
        attempts: (j['attempts'] ?? 0) as int,
        nextAttemptAt: DateTime.parse(j['nextAttemptAt'] as String),
        lastError: j['lastError'] as String?,
        dedupeKey: j['dedupeKey'] as String?,
      );
}

enum WriteOutcome {
  /// Accepted (2xx, or 409 duplicate of an accepted write).
  done,

  /// Server error or rate limit for this write: keep it, retry with backoff, continue with the next.
  retry,

  /// No connection: keep it and stop this flush (the rest would fail the same way).
  offline,

  /// Permanent rejection (400, 403, 404, 422): drop it so the queue does not jam.
  drop,

  /// Not yet possible (a recording waiting for its call id): retry soon, counts an attempt.
  defer,
}

typedef WriteSender = Future<WriteOutcome> Function(PendingWrite write);

/// Persistent FIFO queue of writes made while offline or that must survive app restarts
/// (task complete, call logs, recordings, location batches). Flushed on reconnect, on resume and
/// on a timer.
class WriteQueue {
  WriteQueue(this.store, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;

  static const _key = 'queue.v1';
  static const maxItems = 2000;

  /// A deferred write (recording without its call id) is dropped after this many tries (~1 hour).
  static const maxDeferrals = 180;

  final LocalStore store;
  final DateTime Function() _clock;
  final _count = StreamController<int>.broadcast();
  List<PendingWrite>? _items;
  Future<int>? _flushing;
  int _seq = 0;

  Stream<int> get pendingCount => _count.stream;

  Future<List<PendingWrite>> _load() async {
    if (_items != null) return _items!;
    final raw = await store.read(_key);
    try {
      _items = raw == null ? [] : (jsonDecode(raw) as List).map((e) => PendingWrite.fromJson((e as Map).cast<String, dynamic>())).toList();
    } catch (_) {
      _items = [];
    }
    return _items!;
  }

  Future<void> _save() async {
    final items = _items ?? [];
    await store.write(_key, jsonEncode(items.map((e) => e.toJson()).toList()));
    _count.add(items.length);
  }

  Future<List<PendingWrite>> pending() async => List.unmodifiable(await _load());

  String newId() => '${_clock().microsecondsSinceEpoch.toRadixString(36)}-${(_seq++).toRadixString(36)}';

  Future<PendingWrite> enqueue({
    required String kind,
    required String method,
    required String path,
    Map<String, dynamic>? body,
    String? filePath,
    String? dedupeKey,
  }) async {
    final items = await _load();
    if (dedupeKey != null) items.removeWhere((w) => w.dedupeKey == dedupeKey);
    final w = PendingWrite(id: newId(), kind: kind, method: method, path: path, body: body, filePath: filePath, createdAt: _clock(), dedupeKey: dedupeKey);
    items.add(w);
    if (items.length > maxItems) {
      // Location points are the only high-volume kind; drop the oldest of those first.
      final idx = items.indexWhere((x) => x.kind == WriteKind.locationBatch);
      items.removeAt(idx >= 0 ? idx : 0);
    }
    await _save();
    return w;
  }

  /// Exponential backoff: 5 s, 10 s, 20 s ... capped at 10 minutes.
  static Duration backoff(int attempts) => Duration(seconds: math.min(600, 5 * math.pow(2, math.max(0, attempts - 1)).toInt()));

  /// Sends every due write in order. Returns how many were completed. Concurrent calls share one run.
  Future<int> flush(WriteSender send) => _flushing ??= _run(send).whenComplete(() => _flushing = null);

  Future<int> _run(WriteSender send) async {
    final items = await _load();
    var done = 0;
    final now = _clock();
    for (final w in [...items]) {
      if (w.nextAttemptAt.isAfter(now)) continue;
      WriteOutcome outcome;
      try {
        outcome = await send(w);
      } catch (e) {
        outcome = WriteOutcome.offline;
        w.lastError = '$e';
      }
      switch (outcome) {
        case WriteOutcome.done:
        case WriteOutcome.drop:
          items.remove(w);
          if (outcome == WriteOutcome.done) done++;
        case WriteOutcome.retry:
        case WriteOutcome.offline:
          w.attempts++;
          w.nextAttemptAt = _clock().add(backoff(w.attempts));
        case WriteOutcome.defer:
          w.attempts++;
          if (w.attempts > maxDeferrals) {
            items.remove(w);
          } else {
            w.nextAttemptAt = _clock().add(const Duration(seconds: 20));
          }
      }
      await _save();
      // Stop at the first network failure: the rest would fail the same way.
      if (outcome == WriteOutcome.offline) break;
    }
    return done;
  }

  Future<void> clear() async {
    _items = [];
    await _save();
  }
}
