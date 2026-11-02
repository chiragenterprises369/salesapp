import 'package:shared_preferences/shared_preferences.dart';

import 'local_store.dart';
import 'local_store_factory_stub.dart' if (dart.library.io) 'local_store_factory_io.dart' as impl;

/// SQLite on Android, SharedPreferences in the browser.
Future<LocalStore> createLocalStore(SharedPreferences prefs) => impl.createPlatformStore(prefs);
