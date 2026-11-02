import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/time/zoned.dart';
import '../data/models.dart';
import '../design/design.dart';
import 'providers.dart';
import 'router.dart';
import 'runtime.dart';

/// Effective theme: local choice first (no flash), then the server setting; Scheduled turns dark
/// between darkFrom and darkTo in the WORKSPACE timezone (SPEC 4.2).
class ThemeChoice {
  const ThemeChoice(this.mode, this.brand);
  final ThemeMode mode;
  final Color? brand;
}

ThemeMode resolveThemeMode(ThemePreference pref, {required DateTime now, String timezone = 'Asia/Kolkata', String darkFrom = '19:00', String darkTo = '07:00'}) {
  switch (pref) {
    case ThemePreference.light:
      return ThemeMode.light;
    case ThemePreference.dark:
      return ThemeMode.dark;
    case ThemePreference.system:
      return ThemeMode.system;
    case ThemePreference.scheduled:
      final local = inZone(now, timezone);
      final m = local.hour * 60 + local.minute;
      int parse(String s) => (int.tryParse(s.split(':').first) ?? 0) * 60 + (int.tryParse(s.split(':').last) ?? 0);
      final from = parse(darkFrom);
      final to = parse(darkTo);
      final dark = from <= to ? (m >= from && m < to) : (m >= from || m < to);
      return dark ? ThemeMode.dark : ThemeMode.light;
  }
}

final themeChoiceProvider = Provider<ThemeChoice>((ref) {
  final me = ref.watch(meProvider);
  final local = ref.watch(prefsProvider.select((p) => p.theme));
  final pref = local ?? me?.settings.themeMode ?? ThemePreference.system;
  final mode = resolveThemeMode(
    pref,
    now: ref.watch(clockProvider)().toUtc(),
    timezone: me?.workspace.timezone ?? 'Asia/Kolkata',
    darkFrom: me?.settings.darkFrom ?? '19:00',
    darkTo: me?.settings.darkTo ?? '07:00',
  );
  return ThemeChoice(mode, parseHex(me?.workspace.branding.brandColor));
});

class VistarApp extends ConsumerStatefulWidget {
  const VistarApp({super.key});

  @override
  ConsumerState<VistarApp> createState() => _VistarAppState();
}

class _VistarAppState extends ConsumerState<VistarApp> {
  Timer? _scheduleTick;

  @override
  void initState() {
    super.initState();
    // Re-evaluate the Scheduled theme every minute.
    _scheduleTick = Timer.periodic(const Duration(minutes: 1), (_) {
      if (ref.read(meProvider)?.settings.themeMode == ThemePreference.scheduled || ref.read(prefsProvider).theme == ThemePreference.scheduled) {
        ref.invalidate(themeChoiceProvider);
      }
    });
  }

  @override
  void dispose() {
    _scheduleTick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.watch(runtimeProvider);
    final router = ref.watch(routerProvider);
    final choice = ref.watch(themeChoiceProvider);
    final me = ref.watch(meProvider);
    return MaterialApp.router(
      title: me?.workspace.displayName ?? 'Vistar',
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      themeMode: choice.mode,
      theme: buildTheme(VColors.light(choice.brand)),
      darkTheme: buildTheme(VColors.darkPalette(choice.brand)),
      themeAnimationDuration: VMotion.normal,
      builder: (context, child) {
        // Text scaling up to 1.3 (SPEC: no overflow at 130%); larger OS settings are capped.
        final mq = MediaQuery.of(context);
        final scaler = mq.textScaler.clamp(minScaleFactor: 0.9, maxScaleFactor: 1.3);
        return MediaQuery(data: mq.copyWith(textScaler: scaler), child: child!);
      },
    );
  }
}
