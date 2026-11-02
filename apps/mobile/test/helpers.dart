import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:vistar_employee/app/app.dart';
import 'package:vistar_employee/app/providers.dart';
import 'package:vistar_employee/core/api/token_store.dart';
import 'package:vistar_employee/core/offline/local_store.dart';
import 'package:vistar_employee/core/time/zoned.dart';

/// A fixed Tuesday 11:00 IST, inside the demo company's working hours.
final testNow = DateTime.utc(2026, 11, 3, 5, 30);

/// Pumps the whole app in Demo mode (FakeRepository, no network) on Today.
Future<void> pumpDemoApp(WidgetTester tester, {Size size = const Size(412, 915), ThemeMode? theme}) async {
  ensureTimeZones();
  tester.view.physicalSize = size * 2;
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({'vistar.demo': true, if (theme != null) 'vistar.theme': theme.name});
  final prefs = await SharedPreferences.getInstance();
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        sharedPrefsProvider.overrideWithValue(prefs),
        localStoreProvider.overrideWithValue(MemoryStore()),
        tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
        clockProvider.overrideWithValue(() => testNow),
        demoLatencyProvider.overrideWithValue(Duration.zero),
      ],
      child: const VistarApp(),
    ),
  );
  for (var i = 0; i < 6; i++) {
    await tester.pump(const Duration(milliseconds: 300));
  }
  addTearDown(() async {
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pump(const Duration(seconds: 1));
  });
}
