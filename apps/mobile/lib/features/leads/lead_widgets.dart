import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/haptics.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../common/common.dart';
import '../data.dart';
import '../today/today_screen.dart' show stageTone;

Tone temperatureTone(LeadTemperature t) => switch (t) {
      LeadTemperature.hot => Tone.red,
      LeadTemperature.warm => Tone.amber,
      LeadTemperature.cold => Tone.blue,
    };

String temperatureLabel(LeadTemperature t) => switch (t) {
      LeadTemperature.hot => 'Hot',
      LeadTemperature.warm => 'Warm',
      LeadTemperature.cold => 'Cold',
    };

/// Stage chip that opens the stage sheet (the Board's "Move to stage..." on mobile).
class StageButton extends ConsumerWidget {
  const StageButton({super.key, required this.lead, this.onMoved});
  final Lead lead;
  final ValueChanged<Lead>? onMoved;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stage = ref.watch(stagesProvider)[lead.stageId];
    final c = context.colors;
    final t = c.tone(stage == null ? Tone.neutral : stageTone(stage));
    return Semantics(
      button: true,
      label: 'Stage: ${stage?.name ?? 'unknown'}. Change stage',
      child: ExcludeSemantics(
        child: InkWell(
          borderRadius: BorderRadius.circular(VRadius.pill),
          onTap: () => changeStage(context, ref, lead, onMoved: onMoved),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 40),
            child: Center(
              widthFactor: 1,
              child: Container(
                padding: const EdgeInsets.fromLTRB(9, 3, 6, 3),
                decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(VRadius.pill), border: Border.all(color: t.border)),
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(stage?.name ?? 'Stage', style: context.text.labelSmall!.copyWith(color: t.fg, fontWeight: FontWeight.w600)),
                  Icon(LucideIcons.chevronDown, size: 13, color: t.fg),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Stage sheet with optimistic move and rollback on error.
Future<void> changeStage(BuildContext context, WidgetRef ref, Lead lead, {ValueChanged<Lead>? onMoved}) async {
  final pipelines = await ref.read(pipelinesProvider.future).catchError((_) => <Pipeline>[]);
  if (!context.mounted) return;
  final pipeline = pipelines.where((p) => p.id == lead.pipelineId).firstOrNull ?? pipelines.firstOrNull;
  if (pipeline == null) {
    showToast(context, 'Stages did not load. Try again.', error: true);
    return;
  }
  final picked = await showVSheet<Stage>(
    context,
    title: 'Move ${lead.name}',
    subtitle: 'Pick the new stage',
    builder: (ctx) => Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final s in pipeline.stages)
          _StageOption(stage: s, selected: s.id == lead.stageId, onTap: () => Navigator.of(ctx).pop(s)),
        const SizedBox(height: VSpace.sm),
      ],
    ),
  );
  if (picked == null || picked.id == lead.stageId || !context.mounted) return;
  await Haptics.success();
  onMoved?.call(lead.copyWith(stageId: picked.id));
  try {
    final moved = await ref.read(leadsRepositoryProvider).moveStage(lead, picked.id);
    onMoved?.call(moved);
    ref.invalidate(leadsProvider);
    ref.invalidate(leadProvider(lead.id));
    ref.invalidate(leadTimelineProvider(lead.id));
    ref.invalidate(todayProvider);
    if (context.mounted) showToast(context, 'Lead moved to ${picked.name}');
  } catch (e) {
    onMoved?.call(lead);
    if (context.mounted) showToast(context, friendlyError(e), error: true);
  }
}

class _StageOption extends StatelessWidget {
  const _StageOption({required this.stage, required this.selected, required this.onTap});
  final Stage stage;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final dot = parseHex(stage.color) ?? c.tone(stageTone(stage)).fg;
    return Semantics(
      selected: selected,
      button: true,
      label: '${stage.name}${selected ? ', current stage' : ''}',
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 52),
            padding: const EdgeInsets.symmetric(horizontal: VSpace.xl),
            color: selected ? c.accentSoft : null,
            child: Row(children: [
              Container(width: 10, height: 10, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
              const SizedBox(width: VSpace.md),
              Expanded(child: Text(stage.name, style: context.text.titleSmall!.copyWith(color: selected ? c.accentSoftFg : c.fg))),
              Text('${stage.probability}%', style: context.text.bodySmall),
              const SizedBox(width: VSpace.sm),
              SizedBox(width: 20, child: selected ? Icon(LucideIcons.check, size: 18, color: c.accentSoftFg) : null),
            ]),
          ),
        ),
      ),
    );
  }
}

/// Lead card on the Leads list (mobile Table view = one card per lead, SPEC 9.5).
class LeadCard extends ConsumerStatefulWidget {
  const LeadCard({super.key, required this.lead, required this.onOpen, required this.trailing});
  final Lead lead;
  final VoidCallback onOpen;
  final Widget trailing;

  @override
  ConsumerState<LeadCard> createState() => _LeadCardState();
}

class _LeadCardState extends ConsumerState<LeadCard> {
  late Lead _lead = widget.lead;

  @override
  void didUpdateWidget(covariant LeadCard old) {
    super.didUpdateWidget(old);
    if (old.lead != widget.lead) _lead = widget.lead;
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final l = _lead;
    return VCard(
      padding: const EdgeInsets.fromLTRB(VSpace.md + 2, VSpace.md, VSpace.xs, VSpace.sm),
      onTap: widget.onOpen,
      semanticLabel: '${l.name}${l.companyName == null ? '' : ', ${l.companyName}'}, ${formatInr(l.valueInr, compact: true)}',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(padding: const EdgeInsets.only(top: 2), child: VAvatar(name: l.name, size: 42)),
          const SizedBox(width: VSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [
                  Expanded(child: Text(l.name, style: context.text.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  Text(formatInr(l.valueInr, compact: true), style: context.text.titleSmall!.copyWith(fontFeatures: tabular)),
                ]),
                if (l.subtitle.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 1),
                    child: Text(l.subtitle, style: context.text.bodySmall!.copyWith(color: c.mutedStrong), maxLines: 1, overflow: TextOverflow.ellipsis),
                  ),
                const SizedBox(height: 4),
                Wrap(
                  spacing: 6,
                  runSpacing: 2,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StageButton(lead: l, onMoved: (x) => setState(() => _lead = x)),
                    VChip(temperatureLabel(l.temperature), tone: temperatureTone(l.temperature), dot: true),
                    if (l.nextFollowUpAt != null) DueChip(due: l.nextFollowUpAt, now: now, timezone: tz),
                  ],
                ),
              ],
            ),
          ),
          widget.trailing,
        ],
      ),
    );
  }
}
