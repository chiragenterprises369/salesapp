import 'package:path/path.dart' as p;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite/sqflite.dart';

import 'local_store.dart';

Future<LocalStore> createPlatformStore(SharedPreferences prefs) async {
  try {
    final dir = await getDatabasesPath();
    final db = await openDatabase(
      p.join(dir, 'vistar_offline.db'),
      version: 1,
      onCreate: (db, _) => db.execute('CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER NOT NULL)'),
    );
    return SqliteStore(db);
  } catch (_) {
    // No SQLite (desktop test runner without the plugin): fall back to preferences.
    return PrefsStore(prefs);
  }
}

class SqliteStore implements LocalStore {
  SqliteStore(this.db);
  final Database db;

  @override
  Future<String?> read(String key) async {
    final rows = await db.query('kv', columns: ['v'], where: 'k = ?', whereArgs: [key], limit: 1);
    return rows.isEmpty ? null : rows.first['v'] as String?;
  }

  @override
  Future<void> write(String key, String value) =>
      db.insert('kv', {'k': key, 'v': value, 'updated_at': DateTime.now().millisecondsSinceEpoch}, conflictAlgorithm: ConflictAlgorithm.replace);

  @override
  Future<void> delete(String key) => db.delete('kv', where: 'k = ?', whereArgs: [key]);

  @override
  Future<void> clear() => db.delete('kv');
}
