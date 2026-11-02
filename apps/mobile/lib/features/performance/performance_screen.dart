import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../common/common.dart';
import '../data.dart';
import 'targets.dart';

/// My performance: monthly targets, rank (when the company shows it) and calls per day.
class PerformanceScreen extends ConsumerWidget {
  const PerformanceScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final perf = ref.watch(performanceProvider);
    final tz = timezoneOf(ref);
    final showRank = ref.watch(meProvider)?.workspace.showEmployeeRank ?? true;
    return VPage(
      title: 'My performance',
      subtitle: 'Targets, calls and your progress this month',
      onRefresh: () async => ref.invalidate(performanceProvider),
      slivers: [
        AsyncSliver<Performance>(
          value: perf,
          errorTitle: 'Your numbers did not load',
          onRetry: () => ref.invalidate(performanceProvider),
          data: (p) {
            final last14 = p.callsPerDay;
            final totalCalls = last14.fold<int>(0, (s, d) => s + d.calls);
            final connected = last14.fold<int>(0, (s, d) => s + d.connected);
            final talk = last14.fold<int>(0, (s, d) => s + d.talkSec);
            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
              sliver: SliverList.list(children: [
                SectionCard(
                  title: 'Targets this month',
                  icon: LucideIcons.target,
                  padding: const EdgeInsets.fromLTRB(VSpace.lg, VSpace.xs, VSpace.lg, VSpace.lg),
                  child: p.targets.isEmpty
                      ? const EmptyState(compact: true, icon: LucideIcons.target, title: 'No targets yet', message: 'Your manager sets monthly targets in the company panel.')
                      : TargetRings(targets: p.targets, rank: showRank ? p.rank : null, teamSize: p.teamSize),
                ),
                const SizedBox(height: VSpace.md),
                Row(children: [
                  Expanded(child: KpiTile(label: 'Calls, 14 days', value: totalCalls, format: (v) => '${v.round()}', icon: LucideIcons.phoneOutgoing, tone: Tone.blue)),
                  const SizedBox(width: VSpace.md),
                  Expanded(
                    child: KpiTile(
                      label: 'Connected',
                      value: totalCalls == 0 ? 0 : connected * 100 / totalCalls,
                      format: (v) => '${v.round()}%',
                      icon: LucideIcons.phoneCall,
                      tone: Tone.green,
                      hint: 'Talk ${formatSpan(Duration(seconds: talk))}',
                    ),
                  ),
                ]),
                const SizedBox(height: VSpace.md),
                SectionCard(
                  title: 'Calls per day',
                  icon: LucideIcons.chartColumn,
                  padding: const EdgeInsets.fromLTRB(VSpace.md, VSpace.sm, VSpace.lg, VSpace.lg),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      SizedBox(height: 200, child: CallsChart(days: last14, timezone: tz)),
                      const SizedBox(height: VSpace.md),
                      Row(children: [
                        _Legend(color: context.colors.chart[0], label: 'Connected'),
                        const SizedBox(width: VSpace.lg),
                        _Legend(color: context.colors.chart[0].withValues(alpha: 0.28), label: 'Not connected'),
                      ]),
                    ],
                  ),
                ),
                const SizedBox(height: VSpace.md),
                // Text equivalent of the chart (SPEC 4.5).
                SectionCard(
                  title: 'Last 7 days',
                  icon: LucideIcons.list,
                  child: Column(children: [
                    for (final d in last14.reversed.take(7))
                      VListTile(
                        dense: true,
                        title: formatShortDay(d.day, tz),
                        trailing: Text('${d.calls} calls · ${d.connected} connected · ${formatSpan(Duration(seconds: d.talkSec))}', style: context.text.bodySmall!.copyWith(fontFeatures: tabular)),
                      ),
                  ]),
                ),
              ]),
            );
          },
        ),
      ],
    );
  }
}

class _Legend extends StatelessWidget {
  const _Legend({required this.color, required this.label});
  final Color color;
  final String label;

  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(width: 10, height: 10, decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(3))),
        const SizedBox(width: 6),
        Text(label, style: context.text.bodySmall),
      ]);
}

/// Stacked bars: connected (solid) over not connected (tint), animated on first build.
class CallsChart extends StatelessWidget {
  const CallsChart({super.key, required this.days, required this.timezone});
  final List<DayCalls> days;
  final String timezone;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final maxY = days.fold<int>(4, (m, d) => d.calls > m ? d.calls : m).toDouble();
    return Semantics(
      label: 'Calls per day chart, last ${days.length} days. The list below has the numbers.',
      child: ExcludeSemantics(
        child: BarChart(
          BarChartData(
            maxY: (maxY * 1.15).ceilToDouble(),
            alignment: BarChartAlignment.spaceBetween,
            borderData: FlBorderData(show: false),
            gridData: FlGridData(
              drawVerticalLine: false,
              horizontalInterval: (maxY / 3).ceilToDouble().clamp(1, 1000),
              getDrawingHorizontalLine: (_) => FlLine(color: c.chartGrid, strokeWidth: 1),
            ),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(),
              rightTitles: const AxisTitles(),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 28,
                  interval: (maxY / 3).ceilToDouble().clamp(1, 1000),
                  getTitlesWidget: (v, meta) => Text('${v.round()}', style: context.text.labelSmall),
                ),
              ),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 22,
                  getTitlesWidget: (v, meta) {
                    final i = v.toInt();
                    if (i < 0 || i >= days.length || (days.length - 1 - i) % 2 != 0) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(inZone(days[i].day, timezone).day.toString(), style: context.text.labelSmall),
                    );
                  },
                ),
              ),
            ),
            barTouchData: BarTouchData(
              touchTooltipData: BarTouchTooltipData(
                getTooltipColor: (_) => c.dark ? const Color(0xFFE8ECF6) : const Color(0xFF1E2430),
                getTooltipItem: (group, _, rod, _) => BarTooltipItem(
                  '${formatShortDay(days[group.x].day, timezone)}\n${days[group.x].calls} calls, ${days[group.x].connected} connected',
                  context.text.labelMedium!.copyWith(color: c.dark ? const Color(0xFF0F1115) : const Color(0xFFF1F5F9)),
                ),
              ),
            ),
            barGroups: [
              for (var i = 0; i < days.length; i++)
                BarChartGroupData(x: i, barRods: [
                  BarChartRodData(
                    toY: days[i].calls.toDouble(),
                    width: 12,
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                    rodStackItems: [
                      BarChartRodStackItem(0, days[i].connected.toDouble(), c.chart[0]),
                      BarChartRodStackItem(days[i].connected.toDouble(), days[i].calls.toDouble(), c.chart[0].withValues(alpha: 0.28)),
                    ],
                    color: Colors.transparent,
                  ),
                ]),
            ],
          ),
          duration: VMotion.of(context, const Duration(milliseconds: 450)),
        ),
      ),
    );
  }
}
