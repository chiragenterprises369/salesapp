import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/haptics.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../calls/call_actions.dart';
import '../common/common.dart';
import '../data.dart';
import '../today/today_screen.dart' show stageTone;
import 'lead_widgets.dart';

/// Lead detail (SPEC 10): profile, score, value, stage progress, fields, tasks, unified timeline
/// and notes.
class LeadDetailScreen extends ConsumerWidget {
  const LeadDetailScreen({super.key, required this.leadId});
  final String leadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lead = ref.watch(leadProvider(leadId));
    return VPage(
      title: lead.value?.name ?? 'Lead',
      subtitle: lead.value?.subtitle,
      showBack: true,
      onRefresh: () async {
        ref.invalidate(leadProvider(leadId));
        ref.invalidate(leadTimelineProvider(leadId));
        ref.invalidate(leadTasksProvider(leadId));
      },
      slivers: [
        AsyncSliver<Lead>(
          value: lead,
          errorTitle: 'This lead did not load',
          onRetry: () => ref.invalidate(leadProvider(leadId)),
          data: (l) => SliverPadding(
            padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
            sliver: SliverList.list(children: [
              _Header(lead: l),
              const SizedBox(height: VSpace.md),
              _QuickActions(lead: l),
              const SizedBox(height: VSpace.md),
              _StageProgress(lead: l),
              const SizedBox(height: VSpace.md),
              _Fields(lead: l),
              const SizedBox(height: VSpace.md),
              _LeadTasks(leadId: l.id),
              const SizedBox(height: VSpace.md),
              _Timeline(lead: l),
            ]),
          ),
        ),
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.lead});
  final Lead lead;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return VCard(
      child: Column(children: [
        Row(children: [
          VAvatar(name: lead.name, size: 52),
          const SizedBox(width: VSpace.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(lead.name, style: context.text.titleLarge, maxLines: 2, overflow: TextOverflow.ellipsis),
              if (lead.companyName != null) Text(lead.companyName!, style: context.text.bodyMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 4),
              Wrap(spacing: 6, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
                StageButton(lead: lead),
                VChip(temperatureLabel(lead.temperature), tone: temperatureTone(lead.temperature), dot: true),
                VChip(lead.sourceLabel, tone: Tone.indigo),
              ]),
            ]),
          ),
          Semantics(
            label: 'Lead score ${lead.score} of 100',
            child: ExcludeSemantics(
              child: ProgressRing(
                ratio: lead.score / 100,
                size: 58,
                stroke: 6,
                color: lead.score >= 70 ? c.success : (lead.score >= 40 ? c.warning : c.muted),
                center: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text('${lead.score}', textScaler: TextScaler.noScaling, style: context.text.titleSmall!.copyWith(fontFeatures: tabular)),
                  Text('score', textScaler: TextScaler.noScaling, style: context.text.labelSmall!.copyWith(fontSize: 9)),
                ]),
              ),
            ),
          ),
        ]),
        const SizedBox(height: VSpace.md),
        Divider(color: c.border),
        const SizedBox(height: VSpace.sm),
        Row(children: [
          Expanded(child: _Stat(label: 'Deal value', value: formatInr(lead.valueInr))),
          Expanded(child: _Stat(label: 'Owner', value: lead.owner?.name ?? 'Unassigned')),
        ]),
      ]),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => MergeSemantics(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: context.text.labelMedium!.copyWith(color: context.colors.mutedStrong)),
          const SizedBox(height: 2),
          Text(value, style: context.text.titleMedium!.copyWith(fontFeatures: tabular), maxLines: 1, overflow: TextOverflow.ellipsis),
        ]),
      );
}

class _QuickActions extends ConsumerWidget {
  const _QuickActions({required this.lead});
  final Lead lead;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Widget action(IconData icon, String label, VoidCallback? onTap, {bool primary = false}) => Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4),
            child: primary
                ? FilledButton.icon(onPressed: onTap, icon: Icon(icon, size: 18), label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis))
                : OutlinedButton.icon(onPressed: onTap, icon: Icon(icon, size: 18), label: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis)),
          ),
        );
    return Row(children: [
      action(LucideIcons.phone, 'Call', lead.phone == null ? null : () => callNumber(context, ref, name: lead.name, phone: lead.phone, leadId: lead.id), primary: true),
      action(LucideIcons.messageCircle, 'WhatsApp', lead.phone == null ? null : () => openWhatsApp(context, phone: lead.phone)),
      action(LucideIcons.notebookPen, 'Note', () => addNote(context, ref, lead)),
    ]);
  }
}

Future<void> addNote(BuildContext context, WidgetRef ref, Lead lead) async {
  final ctl = TextEditingController();
  final body = await showVSheet<String>(
    context,
    title: 'Add a note',
    subtitle: lead.name,
    builder: (ctx) => Padding(
      padding: const EdgeInsets.symmetric(horizontal: VSpace.xl),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        TextField(controller: ctl, autofocus: true, minLines: 3, maxLines: 6, maxLength: 10000, decoration: const InputDecoration(hintText: 'What did you discuss? Next steps?')),
        const SizedBox(height: VSpace.md),
        FilledButton(onPressed: () => Navigator.of(ctx).pop(ctl.text.trim()), child: const Text('Save note')),
      ]),
    ),
  );
  ctl.dispose();
  if (body == null || body.isEmpty || !context.mounted) return;
  try {
    await ref.read(leadsRepositoryProvider).addNote(lead.id, body);
    await Haptics.success();
    ref.invalidate(leadTimelineProvider(lead.id));
    if (context.mounted) showToast(context, 'Note saved');
  } catch (e) {
    if (context.mounted) showToast(context, friendlyError(e), error: true);
  }
}

class _StageProgress extends ConsumerWidget {
  const _StageProgress({required this.lead});
  final Lead lead;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pipelines = ref.watch(pipelinesProvider).value ?? const [];
    final p = pipelines.where((x) => x.id == lead.pipelineId).firstOrNull ?? pipelines.firstOrNull;
    if (p == null) return const SizedBox.shrink();
    final open = p.stages.where((s) => s.type == 'open').toList();
    final current = p.stage(lead.stageId);
    final idx = open.indexWhere((s) => s.id == lead.stageId);
    final c = context.colors;
    final closedTone = current == null || current.type == 'open' ? null : c.tone(stageTone(current));
    return VCard(
      semanticLabel: 'Stage ${current?.name ?? ''}, ${idx < 0 ? '' : 'step ${idx + 1} of ${open.length}'}',
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Text('Pipeline', style: context.text.labelMedium!.copyWith(color: c.mutedStrong)),
          const Spacer(),
          Text(current?.name ?? '', style: context.text.labelLarge!.copyWith(color: closedTone?.fg ?? c.accentText)),
        ]),
        const SizedBox(height: VSpace.sm),
        ExcludeSemantics(
          child: Row(children: [
            for (var i = 0; i < open.length; i++) ...[
              Expanded(
                child: AnimatedContainer(
                  duration: VMotion.of(context),
                  height: 6,
                  decoration: BoxDecoration(
                    color: closedTone != null ? closedTone.fg : (i <= idx ? c.accent : c.surface3),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              ),
              if (i < open.length - 1) const SizedBox(width: 4),
            ],
          ]),
        ),
        const SizedBox(height: 6),
        ExcludeSemantics(
          child: Row(children: [
            for (final s in open)
              Expanded(child: Text(s.name, style: context.text.labelSmall!.copyWith(fontSize: 10), maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center)),
          ]),
        ),
      ]),
    );
  }
}

class _Fields extends StatelessWidget {
  const _Fields({required this.lead});
  final Lead lead;

  @override
  Widget build(BuildContext context) {
    final rows = <(IconData, String, String?)>[
      (LucideIcons.phone, 'Phone', lead.phone == null ? null : formatPhone(lead.phone)),
      (LucideIcons.mail, 'Email', lead.email),
      (LucideIcons.mapPin, 'City', [lead.city, lead.state].whereType<String>().join(', ')),
      (LucideIcons.package, 'Product', lead.productInterest),
      (LucideIcons.messageSquareText, 'Requirement', lead.requirement),
      (LucideIcons.tag, 'Tags', lead.tags.isEmpty ? null : lead.tags.join(', ')),
      for (final e in lead.customFields.entries) (LucideIcons.listPlus, _label(e.key), e.value == null ? null : '${e.value}'),
    ].where((r) => r.$3 != null && r.$3!.isNotEmpty).toList();
    return SectionCard(
      title: 'Details',
      icon: LucideIcons.idCard,
      child: Column(children: [
        for (final r in rows)
          MergeSemantics(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: VSpace.md, vertical: VSpace.sm),
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Icon(r.$1, size: 16, color: context.colors.muted),
                const SizedBox(width: VSpace.md),
                SizedBox(width: 96, child: Text(r.$2, style: context.text.bodySmall!.copyWith(color: context.colors.mutedStrong))),
                Expanded(child: SelectableText(r.$3!, style: context.text.bodyMedium!.copyWith(color: context.colors.fg))),
              ]),
            ),
          ),
      ]),
    );
  }

  static String _label(String key) {
    final s = key.replaceAll('_', ' ');
    return s.isEmpty ? key : s[0].toUpperCase() + s.substring(1);
  }
}

class _LeadTasks extends ConsumerWidget {
  const _LeadTasks({required this.leadId});
  final String leadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(leadTasksProvider(leadId));
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final open = tasks.value?.where((t) => !t.isDone).toList();
    return SectionCard(
      title: 'Tasks',
      icon: LucideIcons.listTodo,
      count: open?.length,
      child: tasks.when(
        loading: () => const Padding(padding: EdgeInsets.all(VSpace.lg), child: SkeletonList(rows: 2, card: false)),
        error: (e, _) => ErrorState(compact: true, title: 'Tasks did not load', onRetry: () => ref.invalidate(leadTasksProvider(leadId))),
        data: (_) => open!.isEmpty
            ? const EmptyState(compact: true, icon: LucideIcons.circleCheck, title: 'No open tasks', message: 'Tasks for this lead show up here.')
            : Column(children: [
                for (final t in open)
                  VListTile(
                    leading: Icon(t.type == 'call' ? LucideIcons.phone : LucideIcons.squareCheck, size: 18, color: context.colors.fgSecondary),
                    title: t.title,
                    meta: [VChip(t.typeLabel), DueChip(due: t.effectiveDue, now: now, timezone: tz)],
                  ),
              ]),
      ),
    );
  }
}

class _Timeline extends ConsumerWidget {
  const _Timeline({required this.lead});
  final Lead lead;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(leadTimelineProvider(lead.id));
    final stages = ref.watch(stagesProvider);
    final tz = timezoneOf(ref);
    final c = context.colors;
    return SectionCard(
      title: 'Timeline',
      icon: LucideIcons.history,
      trailing: TextButton.icon(onPressed: () => addNote(context, ref, lead), icon: const Icon(LucideIcons.plus, size: 16), label: const Text('Note')),
      child: items.when(
        loading: () => const Padding(padding: EdgeInsets.all(VSpace.lg), child: SkeletonList(rows: 3, card: false)),
        error: (e, _) => ErrorState(compact: true, title: 'Timeline did not load', onRetry: () => ref.invalidate(leadTimelineProvider(lead.id))),
        data: (list) => list.isEmpty
            ? const EmptyState(compact: true, icon: LucideIcons.history, title: 'Nothing yet', message: 'Calls, WhatsApp messages, notes and stage changes appear here.')
            : Padding(
                padding: const EdgeInsets.fromLTRB(VSpace.md, VSpace.xs, VSpace.md, VSpace.sm),
                child: Column(children: [
                  for (var i = 0; i < list.length; i++) _TimelineItem(a: list[i], last: i == list.length - 1, stages: stages, tz: tz, colors: c),
                ]),
              ),
      ),
    );
  }
}

class _TimelineItem extends StatelessWidget {
  const _TimelineItem({required this.a, required this.last, required this.stages, required this.tz, required this.colors});
  final Activity a;
  final bool last;
  final Map<String, Stage> stages;
  final String tz;
  final VColors colors;

  (IconData, Tone, String, String?) _describe() {
    final p = a.payload;
    final who = a.actor?.name ?? 'Vistar';
    switch (a.type) {
      case 'call':
        final dur = (p['durationSec'] ?? 0) as int;
        final outcome = callOutcomeLabels['${p['outcome']}'];
        return (LucideIcons.phone, Tone.blue, '$who called', [if (outcome != null) outcome, dur > 0 ? formatDuration(dur) : 'No answer', if (p['hasRecording'] == true) 'recording'].join(' · '));
      case 'message':
        return (LucideIcons.messageCircle, Tone.green, p['direction'] == 'inbound' ? 'WhatsApp received' : '$who sent a WhatsApp', '${p['preview'] ?? ''}');
      case 'note':
        return (LucideIcons.notebookPen, Tone.amber, '$who added a note', '${p['body'] ?? ''}');
      case 'stage_changed':
        return (LucideIcons.arrowRightLeft, Tone.indigo, '$who moved the lead', '${stages[p['fromStageId']]?.name ?? 'Start'} to ${stages[p['toStageId']]?.name ?? 'a new stage'}');
      case 'assigned':
        return (LucideIcons.userCheck, Tone.grey, 'Lead assigned', p['rule'] == null ? null : 'Rule: ${'${p['rule']}'.replaceAll('_', ' ')}');
      case 'lead_created':
        return (LucideIcons.sparkles, Tone.indigo, 'Lead created', 'Source: ${leadSourceLabels['${p['source']}'] ?? p['source']}');
      case 'task_created':
        return (LucideIcons.listPlus, Tone.grey, '$who added a task', '${p['title'] ?? ''}');
      case 'task_completed':
        return (LucideIcons.circleCheck, Tone.green, '$who completed a task', '${p['title'] ?? ''}');
      case 'workflow_step':
        return (LucideIcons.workflow, Tone.indigo, 'Workflow: ${p['workflowName'] ?? ''}', '${p['summary'] ?? ''}');
      case 'email':
        return (LucideIcons.mail, Tone.blue, 'Email', '${p['subject'] ?? ''}');
      default:
        return (LucideIcons.dot, Tone.grey, a.type.replaceAll('_', ' '), null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final (icon, tone, title, body) = _describe();
    final t = colors.tone(tone);
    return MergeSemantics(
      child: IntrinsicHeight(
        child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          SizedBox(
            width: 32,
            child: Column(children: [
              Container(
                width: 30,
                height: 30,
                decoration: BoxDecoration(color: t.bg, shape: BoxShape.circle, border: Border.all(color: t.border)),
                child: Icon(icon, size: 14, color: t.fg),
              ),
              if (!last) Expanded(child: Container(width: 1.5, color: colors.border)),
            ]),
          ),
          const SizedBox(width: VSpace.md),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: last ? VSpace.xs : VSpace.lg, top: 4),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Row(children: [
                  Expanded(child: Text(title, style: context.text.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  Text(formatDayTime(a.createdAt, tz), style: context.text.labelSmall),
                ]),
                if (body != null && body.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(body, style: context.text.bodyMedium, maxLines: 4, overflow: TextOverflow.ellipsis),
                ],
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
