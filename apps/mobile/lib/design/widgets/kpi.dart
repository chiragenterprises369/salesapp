import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme.dart';
import '../tokens.dart';

/// Number that ticks up to its value (SPEC 4.3), instant with reduced motion.
class AnimatedCount extends StatelessWidget {
  const AnimatedCount({super.key, required this.value, required this.format, this.style});
  final num value;
  final String Function(num) format;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: value.toDouble()),
      duration: VMotion.of(context, const Duration(milliseconds: 650)),
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => Text(format(value is int ? v.round() : v), style: style, maxLines: 1, overflow: TextOverflow.ellipsis),
    );
  }
}

/// KPI tile: label, big tabular value, optional icon and hint.
class KpiTile extends StatelessWidget {
  const KpiTile({super.key, required this.label, required this.value, required this.format, this.icon, this.hint, this.tone = Tone.indigo});

  final String label;
  final num value;
  final String Function(num) format;
  final IconData? icon;
  final String? hint;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = c.tone(tone);
    return Semantics(
      container: true,
      label: '$label: ${format(value)}${hint == null ? '' : ', $hint'}',
      child: ExcludeSemantics(
        child: Container(
          padding: const EdgeInsets.fromLTRB(VSpace.md + 2, VSpace.md, VSpace.md, VSpace.md + 2),
          decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(VRadius.lg), border: Border.all(color: c.border), boxShadow: VElevation.card(c)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(label, style: context.text.labelMedium!.copyWith(color: c.mutedStrong), maxLines: 1, overflow: TextOverflow.ellipsis)),
                  if (icon != null)
                    Container(
                      width: 26,
                      height: 26,
                      decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(8)),
                      child: Icon(icon, size: 14, color: t.fg),
                    ),
                ],
              ),
              const SizedBox(height: VSpace.sm),
              AnimatedCount(
                value: value,
                format: format,
                style: context.text.headlineSmall!.copyWith(fontFeatures: tabular, fontWeight: FontWeight.w700),
              ),
              if (hint != null) ...[
                const SizedBox(height: 2),
                Text(hint!, style: context.text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Target progress ring with the percentage in the middle.
class ProgressRing extends StatelessWidget {
  const ProgressRing({super.key, required this.ratio, this.size = 76, this.stroke = 8, this.color, this.center});
  final double ratio;
  final double size;
  final double stroke;
  final Color? color;
  final Widget? center;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: ratio.clamp(0, 1).toDouble()),
      duration: VMotion.of(context, const Duration(milliseconds: 700)),
      curve: Curves.easeOutCubic,
      builder: (context, v, _) => SizedBox(
        width: size,
        height: size,
        child: CustomPaint(
          painter: _RingPainter(v, color ?? c.accent, c.surface3, stroke),
          child: Center(
            child: center ??
                Text('${(ratio * 100).round()}%', textScaler: TextScaler.noScaling, style: context.text.titleSmall!.copyWith(fontFeatures: tabular)),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter(this.value, this.color, this.track, this.stroke);
  final double value;
  final Color color;
  final Color track;
  final double stroke;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset(stroke / 2, stroke / 2) & Size(size.width - stroke, size.height - stroke);
    final base = Paint()
      ..color = track
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    canvas.drawArc(rect, 0, math.pi * 2, false, base);
    if (value <= 0) return;
    final fg = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = stroke;
    canvas.drawArc(rect, -math.pi / 2, math.pi * 2 * value, false, fg);
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.value != value || old.color != color;
}
