import 'package:flutter/material.dart';

import '../tokens.dart';

/// Shimmer for skeleton loaders. One animation for the whole subtree; static with reduced motion.
class Shimmer extends StatefulWidget {
  const Shimmer({super.key, required this.child, this.label = 'Loading'});
  final Widget child;
  final String label;

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(vsync: this, duration: const Duration(milliseconds: 1300));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (VMotion.reduced(context)) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final base = c.dark ? c.surface3 : const Color(0xFFEDF0F4);
    final hi = c.dark ? const Color(0xFF2C3240) : const Color(0xFFF8FAFC);
    return Semantics(
      label: widget.label,
      liveRegion: true,
      child: ExcludeSemantics(
        child: AnimatedBuilder(
          animation: _c,
          child: widget.child,
          builder: (context, child) {
            final t = _c.value;
            return ShaderMask(
              blendMode: BlendMode.srcATop,
              shaderCallback: (rect) => LinearGradient(
                begin: Alignment(-1.6 + 3.2 * t, -0.2),
                end: Alignment(-0.6 + 3.2 * t, 0.2),
                colors: [base, hi, base],
                stops: const [0.1, 0.5, 0.9],
              ).createShader(rect),
              child: child,
            );
          },
        ),
      ),
    );
  }
}

class SkeletonBox extends StatelessWidget {
  const SkeletonBox({super.key, this.width, this.height = 14, this.radius = 6, this.circle = false});
  final double? width;
  final double height;
  final double radius;
  final bool circle;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Container(
      width: circle ? height : width,
      height: height,
      decoration: BoxDecoration(
        color: c.dark ? c.surface3 : const Color(0xFFEDF0F4),
        borderRadius: circle ? null : BorderRadius.circular(radius),
        shape: circle ? BoxShape.circle : BoxShape.rectangle,
      ),
    );
  }
}

/// A list of row skeletons inside a card: avatar circle, two text lines and a chip.
class SkeletonList extends StatelessWidget {
  const SkeletonList({super.key, this.rows = 5, this.card = true});
  final int rows;
  final bool card;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final list = Column(
      children: [
        for (var i = 0; i < rows; i++)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: VSpace.lg, vertical: VSpace.md),
            child: Row(
              children: [
                const SkeletonBox(height: 40, circle: true),
                const SizedBox(width: VSpace.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SkeletonBox(width: 140.0 + (i % 3) * 30, height: 13),
                      const SizedBox(height: 8),
                      SkeletonBox(width: 90.0 + (i % 2) * 50, height: 11),
                    ],
                  ),
                ),
                const SkeletonBox(width: 36, height: 36, radius: 10),
              ],
            ),
          ),
      ],
    );
    return Shimmer(
      child: card
          ? Container(
              decoration: BoxDecoration(color: c.surface, borderRadius: BorderRadius.circular(VRadius.lg), border: Border.all(color: c.border)),
              padding: const EdgeInsets.symmetric(vertical: VSpace.xs),
              child: list,
            )
          : list,
    );
  }
}
