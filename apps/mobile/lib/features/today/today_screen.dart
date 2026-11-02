import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../design/design.dart';
import '../calls/call_actions.dart';
import '../common/common.dart';
import '../data.dart';
import '../performance/targets.dart';

/// Today (employee Home, SPEC 17): next call, today's stats, calls to make, follow-ups, tasks due,
/// new leads and targets, in that order.
class TodayScreen extends ConsumerWidget {
  const TodayScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    final today = ref.watch(todayProvider);
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final first = me?.user.firstName ?? '';
    final dueCount = today.value?.data.dueCount;
    return VPage(
      title: '${greeting(now, tz)}, $first',
      subtitle: '${formatDay(now, tz)}${dueCount == null ? '' : ' · $dueCount due today'}',
      leading: Padding(
        padding: const EdgeInsets.only(left: VSpace.page),
        child: Center(child: _CompanyMark(name: me?.workspace.displayName ?? 'Vistar', logo: me?.workspace.branding.logoUrl, darkLogo: me?.workspace.branding.logoDarkUrl)),
      ),
      actions: const [TopActions()],
      onRefresh: () async {
        ref.invalidate(todayProvider);
        ref.invalidate(notificationsProvider);
        try {
          await ref.read(todayProvider.future);
        } catch (_) {
          // The error state shows the retry.
        }
      },
      slivers: [
        AsyncSliver<Fetched<MyToday>>(
          value: today,
          errorTitle: 'Your day did not load',
          onRetry: () => ref.invalidate(todayProvider),
          skeleton: const _TodaySkeleton(),
          data: (f) => SliverPadding(
            padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
            sliver: SliverList.list(
              children: [
                OfflineBanner(fromCache: f.fromCache, savedAt: f.savedAt),
                ..._sections(context, ref, f.data, now, tz),
              ],
            ),
          ),
        ),
      ],
    );
  }

  List<Widget> _sections(BuildContext context, WidgetRef ref, MyToday t, DateTime now, String tz) {
    final next = t.callsToMake.firstOrNull;
    final s = t.stats;
    var i = 0;
    Widget gap(Widget w) => Padding(padding: const EdgeInsets.only(bottom: VSpace.md), child: Reveal(index: i++, child: w));
    return [
      if (next != null) gap(_NextCallCard(task: next, now: now, tz: tz)),
      gap(
        _KpiGrid(children: [
          KpiTile(label: 'Calls today', value: s.callsToday, format: (v) => '${v.round()}', icon: LucideIcons.phoneOutgoing, tone: Tone.blue),
          KpiTile(label: 'Talk time', value: s.talkSecToday, format: (v) => formatSpan(Duration(seconds: v.round())), icon: LucideIcons.timer, tone: Tone.indigo),
          KpiTile(label: 'Leads contacted', value: s.leadsContactedToday, format: (v) => '${v.round()}', icon: LucideIcons.userCheck, tone: Tone.green),
          KpiTile(label: 'Won this month', value: s.wonInrThisMonth, format: (v) => formatInr(v, compact: true), icon: LucideIcons.trophy, tone: Tone.amber),
        ]),
      ),
      gap(
        SectionCard(
          title: 'Calls to make',
          icon: LucideIcons.phone,
          count: t.callsToMake.length,
          trailing: TextButton(onPressed: () => context.go('/calls'), child: const Text('Calls')),
          child: t.callsToMake.isEmpty
              ? const EmptyState(compact: true, icon: LucideIcons.phoneOff, title: 'No calls due', message: 'New call tasks from leads and workflows appear here.')
              : Column(children: [for (final task in t.callsToMake.take(6)) TaskRow(task: task, now: now, tz: tz)]),
        ),
      ),
      gap(
        SectionCard(
          title: 'Follow-ups due',
          icon: LucideIcons.calendarClock,
          count: t.followUps.length,
          child: t.followUps.isEmpty
              ? const EmptyState(compact: true, icon: LucideIcons.calendarCheck, title: 'No follow-ups due', message: 'Leads with a follow-up date today show up here.')
              : Column(children: [for (final l in t.followUps.take(6)) LeadRow(lead: l, now: now, tz: tz, showFollowUp: true)]),
        ),
      ),
      gap(
        SectionCard(
          title: 'Tasks due today',
          icon: LucideIcons.listTodo,
          count: t.tasksDue.length,
          trailing: TextButton(onPressed: () => context.push('/tasks'), child: const Text('All tasks')),
          child: t.tasksDue.isEmpty
              ? const EmptyState(compact: true, icon: LucideIcons.circleCheck, title: 'Nothing due today', message: 'Tasks you add on a lead, and tasks from workflows, appear here.')
              : Column(children: [for (final task in t.tasksDue.take(6)) TaskRow(task: task, now: now, tz: tz)]),
        ),
      ),
      gap(
        SectionCard(
          title: 'New leads for you',
          icon: LucideIcons.sparkles,
          count: t.newAssigned.length,
          child: t.newAssigned.isEmpty
              ? const EmptyState(compact: true, icon: LucideIcons.inbox, title: 'No new leads', message: 'Leads assigned to you in the last 24 hours show up here.')
              : Column(children: [for (final l in t.newAssigned.take(6)) LeadRow(lead: l, now: now, tz: tz, showSource: true)]),
        ),
      ),
      if (t.targets.isNotEmpty)
        gap(
          SectionCard(
            title: 'Targets this month',
            icon: LucideIcons.target,
            trailing: TextButton(onPressed: () => context.push('/performance'), child: const Text('Details')),
            padding: const EdgeInsets.fromLTRB(VSpace.lg, VSpace.xs, VSpace.lg, VSpace.lg),
            child: TargetRings(targets: t.targets, rank: s.rank),
          ),
        ),
    ];
  }
}

class _CompanyMark extends StatelessWidget {
  const _CompanyMark({required this.name, this.logo, this.darkLogo});
  final String name;
  final String? logo;
  final String? darkLogo;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final url = c.dark ? (darkLogo ?? logo) : logo;
    return Semantics(
      label: name,
      child: Container(
        width: 36,
        height: 36,
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(color: url == null ? c.accent : c.surface, borderRadius: BorderRadius.circular(10), border: url == null ? null : Border.all(color: c.border)),
        alignment: Alignment.center,
        child: url == null
            ? Text(initials(name).substring(0, 1), textScaler: TextScaler.noScaling, style: TextStyle(fontFamily: 'Inter', fontWeight: FontWeight.w700, fontSize: 17, color: c.onAccent))
            : Image.network(url, fit: BoxFit.contain, errorBuilder: (_, _, _) => Text(initials(name).substring(0, 1))),
      ),
    );
  }
}

class _KpiGrid extends StatelessWidget {
  const _KpiGrid({required this.children});
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, box) {
      final cols = box.maxWidth >= 640 ? 4 : 2;
      final w = (box.maxWidth - VSpace.md * (cols - 1)) / cols;
      return Wrap(spacing: VSpace.md, runSpacing: VSpace.md, children: [for (final c in children) SizedBox(width: w, child: c)]);
    });
  }
}

class _NextCallCard extends ConsumerWidget {
  const _NextCallCard({required this.task, required this.now, required this.tz});
  final Task task;
  final DateTime now;
  final String tz;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final name = task.leadName ?? task.title;
    return VCard(
      onTap: task.leadId == null ? null : () => context.push('/leads/${task.leadId}'),
      semanticLabel: 'Next call: $name',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              VAvatar(name: name, size: 44),
              const SizedBox(width: VSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Next call', style: context.text.labelMedium!.copyWith(color: c.accentText, fontWeight: FontWeight.w600)),
                    Text(name, style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text(task.notes ?? task.title, style: context.text.bodyMedium, maxLines: 2, overflow: TextOverflow.ellipsis),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: VSpace.md),
          Wrap(spacing: 6, runSpacing: 6, children: [
            DueChip(due: task.effectiveDue, now: now, timezone: tz),
            if (task.isHighPriority) VChip(task.priority == 'urgent' ? 'Urgent' : 'High', tone: task.priority == 'urgent' ? Tone.red : Tone.amber),
          ]),
          const SizedBox(height: VSpace.md),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: task.leadId == null
                  ? null
                  : () => task.leadPhone != null
                      ? callNumber(context, ref, name: name, phone: task.leadPhone, leadId: task.leadId)
                      : callLeadById(context, ref, leadId: task.leadId!, name: name),
              icon: const Icon(LucideIcons.phone, size: 18),
              label: Text('Call ${name.split(' ').first}'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Task row used on Today and Calls.
class TaskRow extends StatelessWidget {
  const TaskRow({super.key, required this.task, required this.now, required this.tz});
  final Task task;
  final DateTime now;
  final String tz;

  @override
  Widget build(BuildContext context) {
    final name = task.leadName ?? task.title;
    return VListTile(
      leading: VAvatar(name: name),
      title: task.title,
      subtitle: task.notes ?? task.leadName,
      meta: [
        DueChip(due: task.effectiveDue, now: now, timezone: tz),
        if (task.isHighPriority) VChip(task.priority == 'urgent' ? 'Urgent' : 'High', tone: task.priority == 'urgent' ? Tone.red : Tone.amber),
      ],
      trailing: TaskCallButton(task: task),
      onTap: task.leadId == null ? null : () => context.push('/leads/${task.leadId}'),
    );
  }
}

/// Lead row used on Today, Calls and Leads.
class LeadRow extends ConsumerWidget {
  const LeadRow({super.key, required this.lead, required this.now, required this.tz, this.showFollowUp = false, this.showSource = false, this.stage});
  final Lead lead;
  final DateTime now;
  final String tz;
  final bool showFollowUp;
  final bool showSource;
  final Stage? stage;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return VListTile(
      leading: VAvatar(name: lead.name),
      title: lead.name,
      subtitle: lead.subtitle,
      meta: [
        if (showFollowUp) DueChip(due: lead.nextFollowUpAt, now: now, timezone: tz),
        if (showSource) ...[VChip(lead.sourceLabel, tone: Tone.indigo), VChip(timeAgo(lead.createdAt, now))],
        if (stage != null) VChip(stage!.name, tone: stageTone(stage!)),
      ],
      trailing: CallButton(name: lead.name, phone: lead.phone, leadId: lead.id),
      onTap: () => context.push('/leads/${lead.id}'),
    );
  }
}

Tone stageTone(Stage s) => switch (s.type) {
      'won' => Tone.green,
      'lost' => Tone.grey,
      _ => s.order == 0 ? Tone.indigo : (s.probability >= 50 ? Tone.amber : Tone.blue),
    };

class _TodaySkeleton extends StatelessWidget {
  const _TodaySkeleton();

  @override
  Widget build(BuildContext context) {
    return const Shimmer(
      label: 'Loading your day',
      child: Column(
        children: [
          SkeletonBox(height: 168, radius: 14),
          SizedBox(height: VSpace.md),
          Row(children: [Expanded(child: SkeletonBox(height: 92, radius: 14)), SizedBox(width: VSpace.md), Expanded(child: SkeletonBox(height: 92, radius: 14))]),
          SizedBox(height: VSpace.md),
          Row(children: [Expanded(child: SkeletonBox(height: 92, radius: 14)), SizedBox(width: VSpace.md), Expanded(child: SkeletonBox(height: 92, radius: 14))]),
          SizedBox(height: VSpace.md),
          SkeletonBox(height: 220, radius: 14),
        ],
      ),
    );
  }
}
