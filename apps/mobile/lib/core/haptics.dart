import 'package:flutter/services.dart';

/// Haptic feedback for key actions (complete, call, status change). No-op in the browser.
abstract final class Haptics {
  static Future<void> tap() => HapticFeedback.selectionClick();
  static Future<void> success() => HapticFeedback.lightImpact();
  static Future<void> heavy() => HapticFeedback.mediumImpact();
  static Future<void> warning() => HapticFeedback.heavyImpact();
}
