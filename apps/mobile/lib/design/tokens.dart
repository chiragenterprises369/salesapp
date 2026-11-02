import 'package:flutter/material.dart';

import 'brand.dart';

/// Soft status tones (SPEC 4.1): on call = blue, available = green, busy = amber, offline = grey,
/// error = red; indigo for neutral highlights.
enum Tone { neutral, blue, green, amber, grey, red, indigo }

class ToneColors {
  const ToneColors(this.bg, this.fg, this.border);
  final Color bg;
  final Color fg;
  final Color border;
}

/// Design tokens. Values mirror packages/shared/src/design/tokens.ts (light and dark palettes);
/// the accent roles come from the company brand colour through [BrandRoles].
@immutable
class VColors extends ThemeExtension<VColors> {
  const VColors({
    required this.dark,
    required this.bg,
    required this.surface,
    required this.surface2,
    required this.surface3,
    required this.border,
    required this.borderStrong,
    required this.input,
    required this.fg,
    required this.fgSecondary,
    required this.muted,
    required this.mutedStrong,
    required this.brand,
    required this.success,
    required this.successText,
    required this.warning,
    required this.warningText,
    required this.danger,
    required this.dangerText,
    required this.tones,
    required this.chart,
    required this.chartGrid,
    required this.overlay,
  });

  final bool dark;
  final Color bg;
  final Color surface;
  final Color surface2;
  final Color surface3;
  final Color border;
  final Color borderStrong;
  final Color input;
  final Color fg;
  final Color fgSecondary;
  final Color muted;
  final Color mutedStrong;
  final BrandRoles brand;
  final Color success;
  final Color successText;
  final Color warning;
  final Color warningText;
  final Color danger;
  final Color dangerText;
  final Map<Tone, ToneColors> tones;
  final List<Color> chart;
  final Color chartGrid;
  final Color overlay;

  Color get accent => brand.accent;
  Color get accentText => brand.accentText;
  Color get accentSoft => brand.accentSoft;
  Color get accentSoftFg => brand.accentSoftFg;
  Color get onAccent => brand.onAccent;

  ToneColors tone(Tone t) => tones[t]!;

  static VColors light(Color? brandColor) {
    const surface = Color(0xFFFFFFFF);
    return VColors(
      dark: false,
      bg: const Color(0xFFF6F7F9),
      surface: surface,
      surface2: const Color(0xFFF8FAFC),
      surface3: const Color(0xFFF1F5F9),
      border: const Color(0xFFE5E7EB),
      borderStrong: const Color(0xFFD1D5DB),
      input: const Color(0xFF8A94A6),
      fg: const Color(0xFF0F172A),
      fgSecondary: const Color(0xFF334155),
      muted: const Color(0xFF64748B),
      mutedStrong: const Color(0xFF56657A),
      brand: BrandRoles.derive(brandColor, dark: false, surface: surface),
      success: const Color(0xFF059669),
      successText: const Color(0xFF047857),
      warning: const Color(0xFFD97706),
      warningText: const Color(0xFFB45309),
      danger: const Color(0xFFDC2626),
      dangerText: const Color(0xFFB91C1C),
      tones: const {
        Tone.neutral: ToneColors(Color(0xFFF1F5F9), Color(0xFF334155), Color(0xFFE2E8F0)),
        Tone.blue: ToneColors(Color(0xFFEFF6FF), Color(0xFF1D4ED8), Color(0xFFBFDBFE)),
        Tone.green: ToneColors(Color(0xFFECFDF5), Color(0xFF047857), Color(0xFFA7F3D0)),
        Tone.amber: ToneColors(Color(0xFFFFFBEB), Color(0xFFB45309), Color(0xFFFDE68A)),
        Tone.grey: ToneColors(Color(0xFFF1F5F9), Color(0xFF475569), Color(0xFFE2E8F0)),
        Tone.red: ToneColors(Color(0xFFFEF2F2), Color(0xFFB91C1C), Color(0xFFFECACA)),
        Tone.indigo: ToneColors(Color(0xFFEEF2FF), Color(0xFF4338CA), Color(0xFFC7D2FE)),
      },
      chart: const [Color(0xFF4F46E5), Color(0xFF0284C7), Color(0xFF059669), Color(0xFFD97706), Color(0xFFE11D48), Color(0xFF64748B)],
      chartGrid: const Color(0xFFEEF0F3),
      overlay: const Color(0x660F172A),
    );
  }

  static VColors darkPalette(Color? brandColor) {
    const surface = Color(0xFF171A21);
    return VColors(
      dark: true,
      bg: const Color(0xFF0F1115),
      surface: surface,
      surface2: const Color(0xFF1C2029),
      surface3: const Color(0xFF222733),
      border: const Color(0xFF262A33),
      borderStrong: const Color(0xFF343A46),
      input: const Color(0xFF5B6475),
      fg: const Color(0xFFE8ECF6),
      fgSecondary: const Color(0xFFC3CADB),
      muted: const Color(0xFF8B96B3),
      mutedStrong: const Color(0xFF9AA4BF),
      brand: BrandRoles.derive(brandColor, dark: true, surface: surface),
      success: const Color(0xFF34D399),
      successText: const Color(0xFF6EE7B7),
      warning: const Color(0xFFFBBF24),
      warningText: const Color(0xFFFCD34D),
      danger: const Color(0xFFDC2626),
      dangerText: const Color(0xFFFCA5A5),
      tones: const {
        Tone.neutral: ToneColors(Color(0xFF20242C), Color(0xFFC3CADB), Color(0xFF2F3541)),
        Tone.blue: ToneColors(Color(0xFF172338), Color(0xFF93C5FD), Color(0xFF1E3A5F)),
        Tone.green: ToneColors(Color(0xFF11261D), Color(0xFF6EE7B7), Color(0xFF14532D)),
        Tone.amber: ToneColors(Color(0xFF2A2112), Color(0xFFFCD34D), Color(0xFF713F12)),
        Tone.grey: ToneColors(Color(0xFF20242C), Color(0xFFA7B0C2), Color(0xFF2F3541)),
        Tone.red: ToneColors(Color(0xFF2C1618), Color(0xFFFCA5A5), Color(0xFF7F1D1D)),
        Tone.indigo: ToneColors(Color(0xFF23224A), Color(0xFFC7D2FE), Color(0xFF3730A3)),
      },
      chart: const [Color(0xFF818CF8), Color(0xFF38BDF8), Color(0xFF34D399), Color(0xFFFBBF24), Color(0xFFFB7185), Color(0xFF94A3B8)],
      chartGrid: const Color(0xFF232833),
      overlay: const Color(0x99000000),
    );
  }

  @override
  VColors copyWith() => this;

  @override
  VColors lerp(ThemeExtension<VColors>? other, double t) => (other is VColors && t >= 0.5) ? other : this;
}

/// Spacing scale (4 pt grid).
abstract final class VSpace {
  static const xxs = 2.0;
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const lg = 16.0;
  static const xl = 20.0;
  static const xxl = 24.0;
  static const xxxl = 32.0;

  /// Horizontal page padding.
  static const page = 16.0;
}

/// Corner radii: controls 10, cards 14, sheets 20, pills.
abstract final class VRadius {
  static const sm = 8.0;
  static const md = 10.0;
  static const lg = 14.0;
  static const xl = 20.0;
  static const pill = 999.0;
}

/// Motion (SPEC 4.3): 150-250 ms, ease out; instant when the OS asks for reduced motion.
abstract final class VMotion {
  static const fast = Duration(milliseconds: 150);
  static const normal = Duration(milliseconds: 200);
  static const slow = Duration(milliseconds: 250);
  static const curve = Curves.easeOutCubic;

  static bool reduced(BuildContext context) => MediaQuery.maybeDisableAnimationsOf(context) ?? false;

  static Duration of(BuildContext context, [Duration d = normal]) => reduced(context) ? Duration.zero : d;
}

/// Elevation: light mode uses soft layered shadows, dark mode relies on borders and surface steps.
abstract final class VElevation {
  static List<BoxShadow> card(VColors c) => c.dark
      ? const []
      : const [
          BoxShadow(color: Color(0x0A0F172A), blurRadius: 2, offset: Offset(0, 1)),
          BoxShadow(color: Color(0x080F172A), blurRadius: 12, offset: Offset(0, 4)),
        ];

  static List<BoxShadow> raised(VColors c) => c.dark
      ? const [BoxShadow(color: Color(0x66000000), blurRadius: 16, offset: Offset(0, 6))]
      : const [
          BoxShadow(color: Color(0x0F0F172A), blurRadius: 4, offset: Offset(0, 2)),
          BoxShadow(color: Color(0x140F172A), blurRadius: 24, offset: Offset(0, 10)),
        ];
}

extension VContext on BuildContext {
  VColors get colors => Theme.of(this).extension<VColors>()!;
  TextTheme get text => Theme.of(this).textTheme;
}
