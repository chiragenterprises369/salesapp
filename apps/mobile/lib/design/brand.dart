import 'dart:math' as math;

import 'package:flutter/painting.dart';

/// WCAG relative luminance of an sRGB colour.
double luminance(Color c) {
  double ch(double v) => v <= 0.03928 ? v / 12.92 : math.pow((v + 0.055) / 1.055, 2.4).toDouble();
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

/// WCAG contrast ratio (1..21).
double contrastRatio(Color a, Color b) {
  final la = luminance(a);
  final lb = luminance(b);
  final hi = math.max(la, lb);
  final lo = math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

Color? parseHex(String? hex) {
  if (hex == null) return null;
  final m = RegExp(r'^#?([0-9a-fA-F]{6})$').firstMatch(hex.trim());
  if (m == null) return null;
  return Color(0xFF000000 | int.parse(m[1]!, radix: 16));
}

String toHex(Color c) => '#${(c.toARGB32() & 0xFFFFFF).toRadixString(16).padLeft(6, '0').toUpperCase()}';

/// Moves the lightness of [c] towards black (darken) or white (lighten) until it reaches
/// [minRatio] against [against]. Hue and saturation stay, so the brand stays recognisable.
Color ensureContrast(Color c, Color against, {double minRatio = 4.5, bool? darken}) {
  if (contrastRatio(c, against) >= minRatio) return c;
  final goDark = darken ?? luminance(against) > 0.4;
  var hsl = HSLColor.fromColor(c);
  for (var i = 0; i < 60; i++) {
    final l = (hsl.lightness + (goDark ? -0.015 : 0.015)).clamp(0.0, 1.0);
    hsl = hsl.withLightness(l);
    final out = hsl.toColor();
    if (contrastRatio(out, against) >= minRatio) return out;
    if (l == 0.0 || l == 1.0) break;
  }
  return goDark ? const Color(0xFF000000) : const Color(0xFFFFFFFF);
}

Color mix(Color a, Color b, double t) => Color.lerp(a, b, t)!;

/// Accent colour roles derived from the company brand colour with the automatic contrast guard
/// (D-060, SPEC 29.4): filled buttons keep white text at 4.5:1, accent text keeps 4.5:1 on the
/// surface, soft fills keep their text at 4.5:1.
class BrandRoles {
  const BrandRoles({
    required this.accent,
    required this.accentHover,
    required this.onAccent,
    required this.accentSoft,
    required this.accentSoftFg,
    required this.accentText,
    required this.ring,
  });

  final Color accent;
  final Color accentHover;
  final Color onAccent;
  final Color accentSoft;
  final Color accentSoftFg;
  final Color accentText;
  final Color ring;

  static const defaultBrand = Color(0xFF4F46E5);

  /// Exact token values for the default indigo (packages/shared/src/design/tokens.ts).
  static const indigoLight = BrandRoles(
    accent: Color(0xFF4F46E5),
    accentHover: Color(0xFF4338CA),
    onAccent: Color(0xFFFFFFFF),
    accentSoft: Color(0xFFEEF2FF),
    accentSoftFg: Color(0xFF4338CA),
    accentText: Color(0xFF4F46E5),
    ring: Color(0xFF4F46E5),
  );

  static const indigoDark = BrandRoles(
    accent: Color(0xFF4F46E5),
    accentHover: Color(0xFF5850EC),
    onAccent: Color(0xFFFFFFFF),
    accentSoft: Color(0xFF23224A),
    accentSoftFg: Color(0xFFC7D2FE),
    accentText: Color(0xFF818CF8),
    ring: Color(0xFF818CF8),
  );

  static BrandRoles derive(Color? brand, {required bool dark, required Color surface}) {
    if (brand == null || brand.toARGB32() == defaultBrand.toARGB32()) return dark ? indigoDark : indigoLight;
    const white = Color(0xFFFFFFFF);
    final accent = ensureContrast(brand, white, darken: true);
    final hover = HSLColor.fromColor(accent).withLightness((HSLColor.fromColor(accent).lightness + (dark ? 0.05 : -0.06)).clamp(0.0, 1.0)).toColor();
    final soft = dark ? mix(surface, brand, 0.22) : mix(white, brand, 0.09);
    final softFg = ensureContrast(dark ? mix(brand, white, 0.55) : brand, soft, darken: !dark);
    final text = ensureContrast(brand, surface, darken: !dark);
    return BrandRoles(
      accent: accent,
      accentHover: ensureContrast(hover, white, darken: true),
      onAccent: white,
      accentSoft: soft,
      accentSoftFg: softFg,
      accentText: text,
      ring: ensureContrast(text, surface, minRatio: 3, darken: !dark),
    );
  }
}
