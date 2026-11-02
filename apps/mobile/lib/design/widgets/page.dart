import 'package:flutter/material.dart';

import '../tokens.dart';

/// Page scaffold with a large title that collapses into a pinned bar on scroll
/// (implicit animation driven by the scroll offset), pull-to-refresh and sliver content.
class VPage extends StatelessWidget {
  const VPage({
    super.key,
    required this.title,
    this.subtitle,
    this.actions = const [],
    required this.slivers,
    this.onRefresh,
    this.leading,
    this.floatingActionButton,
    this.bottom,
    this.showBack,
    this.controller,
  });

  final String title;
  final String? subtitle;
  final List<Widget> actions;
  final List<Widget> slivers;
  final Future<void> Function()? onRefresh;
  final Widget? leading;
  final Widget? floatingActionButton;

  /// Pinned widget under the bar (search field, filter chips).
  final PreferredSizeWidget? bottom;
  final bool? showBack;
  final ScrollController? controller;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final canPop = showBack ?? Navigator.of(context).canPop();
    final textScale = MediaQuery.textScalerOf(context).scale(1);
    final largeH = (subtitle == null ? 52.0 : 74.0) * textScale.clamp(1.0, 1.3);
    final expanded = kToolbarHeight + largeH + (bottom?.preferredSize.height ?? 0);

    final scroll = CustomScrollView(
      controller: controller,
      physics: const AlwaysScrollableScrollPhysics(parent: BouncingScrollPhysics()),
      slivers: [
        SliverAppBar(
          pinned: true,
          automaticallyImplyLeading: false,
          leading: leading ?? (canPop ? const BackButton() : null),
          backgroundColor: c.bg,
          expandedHeight: expanded,
          toolbarHeight: kToolbarHeight,
          actions: [...actions, const SizedBox(width: VSpace.xs)],
          bottom: bottom,
          flexibleSpace: LayoutBuilder(
            builder: (context, box) {
              final top = MediaQuery.paddingOf(context).top;
              final bottomH = bottom?.preferredSize.height ?? 0;
              final min = kToolbarHeight + top + bottomH;
              final max = expanded + top;
              final t = ((box.maxHeight - min) / (max - min)).clamp(0.0, 1.0);
              return Stack(
                children: [
                  // Small title fades in once the large one has scrolled away.
                  Positioned(
                    left: canPop || leading != null ? 56 : VSpace.page,
                    right: 120,
                    top: top,
                    height: kToolbarHeight,
                    child: Align(
                      alignment: Alignment.centerLeft,
                      child: Opacity(
                        opacity: (1 - t * 2.2).clamp(0.0, 1.0),
                        child: Text(title, style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                      ),
                    ),
                  ),
                  Positioned(
                    left: VSpace.page,
                    right: VSpace.page,
                    bottom: bottomH + VSpace.sm,
                    child: Opacity(
                      opacity: t,
                      child: Transform.translate(
                        offset: Offset(0, (1 - t) * 8),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Semantics(
                              header: true,
                              child: Text(title, style: context.text.headlineMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                            ),
                            if (subtitle != null) ...[
                              const SizedBox(height: 2),
                              Text(subtitle!, style: context.text.bodyMedium!.copyWith(color: c.mutedStrong), maxLines: 1, overflow: TextOverflow.ellipsis),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                  if (t < 0.05)
                    Positioned(left: 0, right: 0, bottom: 0, child: Divider(height: 1, color: c.border)),
                ],
              );
            },
          ),
        ),
        ...slivers,
        const SliverToBoxAdapter(child: SizedBox(height: 96)),
      ],
    );

    return Scaffold(
      backgroundColor: c.bg,
      floatingActionButton: floatingActionButton,
      body: onRefresh == null ? scroll : RefreshIndicator(onRefresh: onRefresh!, color: c.accent, backgroundColor: c.surface, edgeOffset: kToolbarHeight, child: scroll),
    );
  }
}

/// Horizontal page padding for a sliver.
class PagePad extends StatelessWidget {
  const PagePad({super.key, required this.child, this.top = 0, this.bottom = 0});
  final Widget child;
  final double top;
  final double bottom;

  @override
  Widget build(BuildContext context) => SliverPadding(
        padding: EdgeInsets.fromLTRB(VSpace.page, top, VSpace.page, bottom),
        sliver: SliverToBoxAdapter(child: child),
      );
}

/// Fade + slide in for list items (implicit, once). Instant with reduced motion.
class Reveal extends StatelessWidget {
  const Reveal({super.key, required this.child, this.index = 0});
  final Widget child;
  final int index;

  @override
  Widget build(BuildContext context) {
    if (VMotion.reduced(context)) return child;
    final delay = (index.clamp(0, 8)) * 30;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: Duration(milliseconds: 220 + delay),
      curve: Interval(delay / (220 + delay), 1, curve: VMotion.curve),
      builder: (context, v, child) => Opacity(opacity: v, child: Transform.translate(offset: Offset(0, (1 - v) * 10), child: child)),
      child: child,
    );
  }
}
