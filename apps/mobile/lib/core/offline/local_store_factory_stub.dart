import 'package:shared_preferences/shared_preferences.dart';

import 'local_store.dart';

Future<LocalStore> createPlatformStore(SharedPreferences prefs) async => PrefsStore(prefs);
