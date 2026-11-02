import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'tokens.dart';

const fontFamily = 'Inter';
const tabular = [FontFeature.tabularFigures()];

/// Type scale (Inter, bundled). Body 14-15, labels 12, large titles 26.
TextTheme _textTheme(VColors c) {
  TextStyle s(double size, double height, FontWeight w, Color color, {double ls = 0}) =>
      TextStyle(fontFamily: fontFamily, fontSize: size, height: height / size, fontWeight: w, color: color, letterSpacing: ls);
  return TextTheme(
    displaySmall: s(30, 36, FontWeight.w700, c.fg, ls: -0.6),
    headlineMedium: s(26, 32, FontWeight.w700, c.fg, ls: -0.5),
    headlineSmall: s(22, 28, FontWeight.w600, c.fg, ls: -0.3),
    titleLarge: s(18, 24, FontWeight.w600, c.fg, ls: -0.2),
    titleMedium: s(16, 22, FontWeight.w600, c.fg, ls: -0.1),
    titleSmall: s(14, 20, FontWeight.w600, c.fg),
    bodyLarge: s(15, 22, FontWeight.w400, c.fg),
    bodyMedium: s(14, 20, FontWeight.w400, c.fgSecondary),
    bodySmall: s(12.5, 17, FontWeight.w400, c.muted),
    labelLarge: s(14, 20, FontWeight.w600, c.fg),
    labelMedium: s(12, 16, FontWeight.w500, c.fgSecondary),
    labelSmall: s(11, 14, FontWeight.w500, c.muted, ls: 0.2),
  );
}

ThemeData buildTheme(VColors c) {
  final text = _textTheme(c);
  final scheme = ColorScheme(
    brightness: c.dark ? Brightness.dark : Brightness.light,
    primary: c.accent,
    onPrimary: c.onAccent,
    primaryContainer: c.accentSoft,
    onPrimaryContainer: c.accentSoftFg,
    secondary: c.accentText,
    onSecondary: c.onAccent,
    error: c.danger,
    onError: const Color(0xFFFFFFFF),
    surface: c.surface,
    onSurface: c.fg,
    onSurfaceVariant: c.muted,
    surfaceContainerLowest: c.bg,
    surfaceContainerLow: c.surface2,
    surfaceContainer: c.surface2,
    surfaceContainerHigh: c.surface3,
    surfaceContainerHighest: c.surface3,
    outline: c.borderStrong,
    outlineVariant: c.border,
    shadow: const Color(0xFF000000),
    scrim: c.overlay,
    inverseSurface: c.dark ? const Color(0xFFE8ECF6) : const Color(0xFF1E2430),
    onInverseSurface: c.dark ? const Color(0xFF0F1115) : const Color(0xFFF1F5F9),
    inversePrimary: c.brand.accentText,
  );
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(VRadius.md));
  const minSize = Size(48, 48);

  return ThemeData(
    useMaterial3: true,
    brightness: scheme.brightness,
    colorScheme: scheme,
    fontFamily: fontFamily,
    textTheme: text,
    scaffoldBackgroundColor: c.bg,
    canvasColor: c.surface,
    dividerColor: c.border,
    splashFactory: InkRipple.splashFactory,
    visualDensity: VisualDensity.standard,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    extensions: [c],
    appBarTheme: AppBarTheme(
      backgroundColor: c.bg,
      surfaceTintColor: Colors.transparent,
      foregroundColor: c.fg,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
      titleTextStyle: text.titleLarge,
      systemOverlayStyle: c.dark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      indicatorColor: c.accentSoft,
      elevation: 0,
      height: 68,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith((s) => IconThemeData(size: 22, color: s.contains(WidgetState.selected) ? c.accentSoftFg : c.muted)),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => text.labelMedium!.copyWith(
          color: s.contains(WidgetState.selected) ? c.accentText : c.muted,
          fontWeight: s.contains(WidgetState.selected) ? FontWeight.w600 : FontWeight.w500,
        ),
      ),
    ),
    cardTheme: CardThemeData(
      color: c.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(VRadius.lg), side: BorderSide(color: c.border)),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: c.accent,
        foregroundColor: c.onAccent,
        disabledBackgroundColor: c.surface3,
        disabledForegroundColor: c.muted,
        minimumSize: minSize,
        shape: shape,
        textStyle: text.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: 18),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: c.fg,
        minimumSize: minSize,
        shape: shape,
        side: BorderSide(color: c.borderStrong),
        textStyle: text.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: 16),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(foregroundColor: c.accentText, minimumSize: minSize, shape: shape, textStyle: text.labelLarge),
    ),
    iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(minimumSize: minSize, foregroundColor: c.fgSecondary)),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surface,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: text.bodyLarge!.copyWith(color: c.muted),
      labelStyle: text.bodyMedium!.copyWith(color: c.mutedStrong),
      floatingLabelStyle: text.bodyMedium!.copyWith(color: c.accentText),
      prefixIconColor: c.muted,
      suffixIconColor: c.muted,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(VRadius.md), borderSide: BorderSide(color: c.input)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(VRadius.md), borderSide: BorderSide(color: c.borderStrong)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(VRadius.md), borderSide: BorderSide(color: c.brand.ring, width: 2)),
      errorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(VRadius.md), borderSide: BorderSide(color: c.danger)),
      focusedErrorBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(VRadius.md), borderSide: BorderSide(color: c.danger, width: 2)),
      errorStyle: text.bodySmall!.copyWith(color: c.dangerText),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      modalBackgroundColor: c.surface,
      showDragHandle: true,
      dragHandleColor: c.borderStrong,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(VRadius.xl))),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: c.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(VRadius.xl)),
      titleTextStyle: text.titleLarge,
      contentTextStyle: text.bodyMedium,
    ),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: scheme.inverseSurface,
      contentTextStyle: text.bodyMedium!.copyWith(color: scheme.onInverseSurface),
      actionTextColor: c.dark ? c.brand.accent : const Color(0xFFA5B4FC),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(VRadius.md)),
      insetPadding: const EdgeInsets.fromLTRB(12, 0, 12, 12),
    ),
    dividerTheme: DividerThemeData(color: c.border, thickness: 1, space: 1),
    listTileTheme: ListTileThemeData(
      iconColor: c.fgSecondary,
      textColor: c.fg,
      minVerticalPadding: 10,
      contentPadding: const EdgeInsets.symmetric(horizontal: VSpace.lg),
      titleTextStyle: text.titleSmall,
      subtitleTextStyle: text.bodySmall,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.onAccent : c.surface),
      trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.accent : c.surface3),
      trackOutlineColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.accent : c.borderStrong),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? c.accent : Colors.transparent),
      checkColor: WidgetStatePropertyAll(c.onAccent),
      side: BorderSide(color: c.input, width: 1.6),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(6)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: c.accent, linearTrackColor: c.surface3, circularTrackColor: c.surface3),
    tooltipTheme: TooltipThemeData(
      decoration: BoxDecoration(color: scheme.inverseSurface, borderRadius: BorderRadius.circular(VRadius.sm)),
      textStyle: text.labelMedium!.copyWith(color: scheme.onInverseSurface),
    ),
    pageTransitionsTheme: const PageTransitionsTheme(
      builders: {
        TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
        TargetPlatform.linux: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.windows: FadeForwardsPageTransitionsBuilder(),
        TargetPlatform.macOS: FadeForwardsPageTransitionsBuilder(),
      },
    ),
  );
}
