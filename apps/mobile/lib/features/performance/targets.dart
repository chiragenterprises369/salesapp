import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../data/models.dart';
import '../../design/design.dart';

String formatTargetValue(TargetProgress t, num v) => t.metric == 'revenue_inr' ? formatInr(v, compact: true) : formatNumber(v.round());

/// Target progress rings (Revenue, Calls, Deals won) with achieved / target under each.
class TargetRings extends StatelessWidget {
  const TargetRings({super.key, required this.targets, this.rank, this.teamSize});
  final List<TargetProgress> targets;
  final int? rank;
  final int? teamSize;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final colors = [c.chart[0], c.chart[1], c.chart[2], c.chart[3]];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(builder: (context, box) {
          final n = targets.length.clamp(1, 4);
          final w = (box.maxWidth - VSpace.md * (n - 1)) / n;
          final ring = (w - 8).clamp(56.0, 84.0);
          return Wrap(
            spacing: VSpace.md,
            runSpacing: VSpace.md,
            children: [
              for (var i = 0; i < targets.length; i++)
                SizedBox(
                  width: w,
                  child: Semantics(
                    label: '${targets[i].label}: ${formatTargetValue(targets[i], targets[i].achieved)} of ${formatTargetValue(targets[i], targets[i].target)}, ${(targets[i].ratio * 100).round()} percent',
                    child: ExcludeSemantics(
                      child: Column(
                        children: [
                          ProgressRing(ratio: targets[i].ratio, size: ring, stroke: ring / 10, color: colors[i % colors.length]),
                          const SizedBox(height: VSpace.sm),
                          Text(targets[i].label, style: context.text.labelLarge, maxLines: 1, overflow: TextOverflow.ellipsis),
                          Text(
                            '${formatTargetValue(targets[i], targets[i].achieved)} / ${formatTargetValue(targets[i], targets[i].target)}',
                            style: context.text.bodySmall!.copyWith(fontFeatures: tabular, color: c.mutedStrong),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          );
        }),
        if (rank != null) ...[
          const SizedBox(height: VSpace.lg),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: VSpace.md, vertical: VSpace.sm + 2),
            decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(VRadius.md)),
            child: Text.rich(
              TextSpan(children: [
                const TextSpan(text: 'You are '),
                TextSpan(text: '#$rank', style: TextStyle(fontWeight: FontWeight.w700, color: c.accentSoftFg)),
                TextSpan(text: teamSize == null ? ' on the team leaderboard this month.' : ' of $teamSize on the team this month.'),
              ]),
              style: context.text.bodyMedium!.copyWith(color: c.accentSoftFg),
            ),
          ),
        ],
      ],
    );
  }
}
