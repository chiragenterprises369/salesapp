import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app/app.dart';
import 'app/providers.dart';
import 'core/offline/local_store_factory.dart';
import 'core/time/zoned.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  ensureTimeZones();
  final prefs = await SharedPreferences.getInstance();
  final store = await createLocalStore(prefs);
  runApp(
    ProviderScope(
      // Errors surface as error states with a "Try again" button; no silent automatic retries.
      retry: (_, _) => null,
      overrides: [
        sharedPrefsProvider.overrideWithValue(prefs),
        localStoreProvider.overrideWithValue(store),
      ],
      child: const VistarApp(),
    ),
  );
}
