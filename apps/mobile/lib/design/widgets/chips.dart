import 'package:flutter/material.dart';

import '../../data/models.dart';
import '../tokens.dart';

/// Soft status chip (SPEC 4.1: status colours only as soft chips).
class VChip extends StatelessWidget {
  const VChip(this.label, {super.key, this.tone = Tone.neutral, this.dot = false, this.icon, this.dense = false});

  final String label;
  final Tone tone;
  final bool dot;
  final IconData? icon;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final t = context.colors.tone(tone);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 6 : 8, vertical: dense ? 1 : 2.5),
      decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(VRadius.pill), border: Border.all(color: t.border)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (dot) ...[
            Container(width: 6, height: 6, decoration: BoxDecoration(color: t.fg, shape: BoxShape.circle)),
            const SizedBox(width: 5),
          ],
          if (icon != null) ...[
            Icon(icon, size: 12, color: t.fg),
            const SizedBox(width: 4),
          ],
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: context.text.labelSmall!.copyWith(color: t.fg, fontWeight: FontWeight.w600, letterSpacing: 0.1),
            ),
          ),
        ],
      ),
    );
  }
}

Tone toneForStatus(PresenceStatus s) => switch (s) {
      PresenceStatus.available => Tone.green,
      PresenceStatus.onCall => Tone.blue,
      PresenceStatus.busy => Tone.amber,
      PresenceStatus.breakTime || PresenceStatus.lunch => Tone.amber,
      PresenceStatus.meeting || PresenceStatus.fieldVisit => Tone.indigo,
      PresenceStatus.away || PresenceStatus.offline => Tone.grey,
    };

/// Presence pill used in the app bar, Team Floor and status sheet.
class StatusPill extends StatelessWidget {
  const StatusPill(this.status, {super.key, this.onTap, this.large = false});
  final PresenceStatus status;
  final VoidCallback? onTap;
  final bool large;

  @override
  Widget build(BuildContext context) {
    final t = context.colors.tone(toneForStatus(status));
    final pill = AnimatedContainer(
      duration: VMotion.of(context),
      curve: VMotion.curve,
      padding: EdgeInsets.symmetric(horizontal: large ? 12 : 10, vertical: large ? 6 : 4),
      decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(VRadius.pill), border: Border.all(color: t.border)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _PulseDot(color: t.fg, pulse: status == PresenceStatus.onCall),
          const SizedBox(width: 6),
          Text(status.label, style: (large ? context.text.labelLarge : context.text.labelMedium)!.copyWith(color: t.fg, fontWeight: FontWeight.w600)),
        ],
      ),
    );
    if (onTap == null) return Semantics(label: 'Status: ${status.label}', child: ExcludeSemantics(child: pill));
    return Semantics(
      button: true,
      label: 'Status: ${status.label}. Change status',
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(VRadius.pill),
          child: ConstrainedBox(constraints: const BoxConstraints(minHeight: 48), child: Center(widthFactor: 1, child: pill)),
        ),
      ),
    );
  }
}

class _PulseDot extends StatefulWidget {
  const _PulseDot({required this.color, required this.pulse});
  final Color color;
  final bool pulse;

  @override
  State<_PulseDot> createState() => _PulseDotState();
}

class _PulseDotState extends State<_PulseDot> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1400));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _sync();
  }

  @override
  void didUpdateWidget(covariant _PulseDot oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync();
  }

  void _sync() {
    if (widget.pulse && !VMotion.reduced(context)) {
      if (!_c.isAnimating) _c.repeat();
    } else {
      _c.stop();
      _c.value = 0;
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 8,
      height: 8,
      child: AnimatedBuilder(
        animation: _c,
        builder: (context, _) => CustomPaint(painter: _DotPainter(widget.color, widget.pulse ? _c.value : 0)),
      ),
    );
  }
}

class _DotPainter extends CustomPainter {
  _DotPainter(this.color, this.t);
  final Color color;
  final double t;

  @override
  void paint(Canvas canvas, Size size) {
    final center = size.center(Offset.zero);
    if (t > 0) {
      canvas.drawCircle(center, 4 + 5 * t, Paint()..color = color.withValues(alpha: 0.35 * (1 - t)));
    }
    canvas.drawCircle(center, 4, Paint()..color = color);
  }

  @override
  bool shouldRepaint(_DotPainter old) => old.t != t || old.color != color;
}

/// Horizontal filter chips (single or multi select).
class FilterChipBar<T> extends StatelessWidget {
  const FilterChipBar({super.key, required this.options, required this.selected, required this.onSelected, required this.label, this.counts});

  final List<T> options;
  final T selected;
  final ValueChanged<T> onSelected;
  final String Function(T) label;
  final Map<T, int>? counts;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: VSpace.page),
      child: Row(
        children: [
          for (final o in options)
            Padding(
              padding: const EdgeInsets.only(right: VSpace.sm),
              child: _SelectChip(
                label: label(o),
                count: counts?[o],
                selected: o == selected,
                onTap: () => onSelected(o),
                colors: c,
              ),
            ),
        ],
      ),
    );
  }
}

class _SelectChip extends StatelessWidget {
  const _SelectChip({required this.label, required this.selected, required this.onTap, required this.colors, this.count});
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final VColors colors;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final c = colors;
    final fg = selected ? c.accentSoftFg : c.fgSecondary;
    return Semantics(
      selected: selected,
      button: true,
      label: count == null ? label : '$label, $count',
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(VRadius.pill),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Center(
              widthFactor: 1,
              child: AnimatedContainer(
                duration: VMotion.of(context, VMotion.fast),
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: selected ? c.accentSoft : c.surface,
                  borderRadius: BorderRadius.circular(VRadius.pill),
                  border: Border.all(color: selected ? c.accentSoftFg.withValues(alpha: 0.35) : c.border),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(label, style: context.text.labelLarge!.copyWith(color: fg, fontWeight: selected ? FontWeight.w600 : FontWeight.w500)),
                    if (count != null) ...[
                      const SizedBox(width: 6),
                      Text('$count', style: context.text.labelMedium!.copyWith(color: selected ? c.accentSoftFg : c.muted)),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
