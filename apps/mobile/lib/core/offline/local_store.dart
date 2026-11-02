import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

/// Key-value store for the offline cache and the write queue. Android uses SQLite (sqflite), the
/// web preview uses SharedPreferences (localStorage), tests use memory.
abstract class LocalStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
  Future<void> clear();
}

class MemoryStore implements LocalStore {
  final Map<String, String> data = {};

  @override
  Future<String?> read(String key) async => data[key];

  @override
  Future<void> write(String key, String value) async => data[key] = value;

  @override
  Future<void> delete(String key) async => data.remove(key);

  @override
  Future<void> clear() async => data.clear();
}

class PrefsStore implements LocalStore {
  PrefsStore(this.prefs);
  final SharedPreferences prefs;
  static const _prefix = 'vistar.store.';

  @override
  Future<String?> read(String key) async => prefs.getString('$_prefix$key');

  @override
  Future<void> write(String key, String value) => prefs.setString('$_prefix$key', value);

  @override
  Future<void> delete(String key) => prefs.remove('$_prefix$key');

  @override
  Future<void> clear() async {
    for (final k in prefs.getKeys().where((k) => k.startsWith(_prefix)).toList()) {
      await prefs.remove(k);
    }
  }
}

class CacheEntry {
  const CacheEntry(this.savedAt, this.data);
  final DateTime savedAt;
  final Object? data;
}

/// JSON snapshots of server responses (Today, leads, tasks) for offline use.
class OfflineCache {
  OfflineCache(this.store, {DateTime Function()? clock}) : _clock = clock ?? DateTime.now;
  final LocalStore store;
  final DateTime Function() _clock;

  Future<void> put(String key, Object? json) =>
      store.write('cache.$key', jsonEncode({'savedAt': _clock().toUtc().toIso8601String(), 'data': json}));

  Future<CacheEntry?> get(String key) async {
    final raw = await store.read('cache.$key');
    if (raw == null) return null;
    try {
      final j = jsonDecode(raw) as Map<String, dynamic>;
      return CacheEntry(DateTime.parse(j['savedAt'] as String), j['data']);
    } catch (_) {
      await store.delete('cache.$key');
      return null;
    }
  }
}
