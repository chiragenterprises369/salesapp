import 'package:flutter/material.dart';

import '../tokens.dart';

/// Card surface: 14 px radius, hairline border, soft layered shadow in light mode.
class VCard extends StatelessWidget {
  const VCard({super.key, required this.child, this.padding = const EdgeInsets.all(VSpace.lg), this.onTap, this.color, this.semanticLabel, this.clip = true});

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final Color? color;
  final String? semanticLabel;
  final bool clip;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final radius = BorderRadius.circular(VRadius.lg);
    Widget body = Padding(padding: padding, child: child);
    if (onTap != null) {
      body = InkWell(onTap: onTap, borderRadius: radius, child: body);
    }
    return Semantics(
      container: true,
      label: semanticLabel,
      button: onTap != null,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: color ?? c.surface,
          borderRadius: radius,
          border: Border.all(color: c.border),
          boxShadow: VElevation.card(c),
        ),
        child: Material(type: MaterialType.transparency, clipBehavior: clip ? Clip.antiAlias : Clip.none, borderRadius: radius, child: body),
      ),
    );
  }
}

/// A titled card section ("Calls to make 15").
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, this.icon, this.count, this.trailing, required this.child, this.padding = const EdgeInsets.fromLTRB(VSpace.xs, 0, VSpace.xs, VSpace.xs)});

  final String title;
  final IconData? icon;
  final int? count;
  final Widget? trailing;
  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return VCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(VSpace.lg, VSpace.md, VSpace.sm, VSpace.xs),
            child: Row(
              children: [
                if (icon != null) ...[
                  Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(8)),
                    child: Icon(icon, size: 16, color: c.accentSoftFg),
                  ),
                  const SizedBox(width: VSpace.sm + 2),
                ],
                Flexible(
                  child: Semantics(
                    header: true,
                    child: Text(title, style: context.text.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                ),
                if (count != null) ...[
                  const SizedBox(width: VSpace.sm),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                    decoration: BoxDecoration(color: c.surface3, borderRadius: BorderRadius.circular(VRadius.pill)),
                    child: Text('$count', style: context.text.labelSmall!.copyWith(color: c.fgSecondary, fontFeatures: const [FontFeature.tabularFigures()])),
                  ),
                ],
                const Spacer(),
                if (trailing != null) trailing! else const SizedBox(height: 40),
              ],
            ),
          ),
          Padding(padding: padding, child: child),
        ],
      ),
    );
  }
}

/// Small uppercase-free group label above a list ("Overdue", "Today").
class GroupLabel extends StatelessWidget {
  const GroupLabel(this.label, {super.key, this.count, this.color});
  final String label;
  final int? count;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.fromLTRB(VSpace.xs, VSpace.lg, VSpace.xs, VSpace.sm),
      child: Semantics(
        header: true,
        child: Row(
          children: [
            Text(label, style: context.text.labelMedium!.copyWith(color: color ?? c.mutedStrong, fontWeight: FontWeight.w600, letterSpacing: 0.2)),
            if (count != null) ...[
              const SizedBox(width: 6),
              Text('$count', style: context.text.labelMedium!.copyWith(color: c.muted)),
            ],
          ],
        ),
      ),
    );
  }
}
