import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../../platform/telephony.dart';
import '../common/common.dart';
import '../data.dart';
import '../today/today_screen.dart' show TaskRow, LeadRow;
import 'call_actions.dart';

const outcomeTones = {
  'answered': Tone.blue,
  'interested': Tone.green,
  'not_interested': Tone.grey,
  'callback': Tone.amber,
  'missed': Tone.red,
  'wrong_number': Tone.grey,
  'voicemail': Tone.grey,
};

/// Calls: who to call now and the call history with outcomes and durations. Calls are placed from
/// the employee's own SIM and logged from the phone's call log (D-057).
class CallsScreen extends ConsumerWidget {
  const CallsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final today = ref.watch(todayProvider);
    final calls = ref.watch(callsProvider);
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final tel = ref.watch(telephonyProvider);
    final demo = ref.watch(isDemoProvider);
    return VPage(
      title: 'Calls',
      subtitle: 'Tap to call from your SIM. Vistar logs it for you.',
      actions: const [TopActions(showStatus: false)],
      onRefresh: () async {
        ref.invalidate(callsProvider);
        ref.invalidate(todayProvider);
      },
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
          sliver: SliverList.list(children: [
            if (!tel.supported && !demo) ...[
              const AndroidOnlyNote(feature: 'Calling from your SIM, the call log and recordings'),
              const SizedBox(height: VSpace.md),
            ],
            if (tel.supported && !demo) const _CallSetupBanner(),
            SectionCard(
              title: 'To call',
              icon: LucideIcons.phoneForwarded,
              count: today.value == null ? null : today.value!.data.callsToMake.length + today.value!.data.followUps.length,
              child: today.when(
                loading: () => const Padding(padding: EdgeInsets.all(VSpace.md), child: SkeletonList(rows: 3, card: false)),
                error: (e, _) => ErrorState(compact: true, title: 'The call list did not load', onRetry: () => ref.invalidate(todayProvider)),
                data: (f) {
                  final t = f.data;
                  if (t.callsToMake.isEmpty && t.followUps.isEmpty) {
                    return const EmptyState(compact: true, icon: LucideIcons.phoneOff, title: 'Nobody to call right now', message: 'Call tasks and follow-ups due today appear here.');
                  }
                  return Column(children: [
                    for (final task in t.callsToMake) TaskRow(task: task, now: now, tz: tz),
                    for (final l in t.followUps) LeadRow(lead: l, now: now, tz: tz, showFollowUp: true),
                  ]);
                },
              ),
            ),
            const SizedBox(height: VSpace.md),
          ]),
        ),
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: VSpace.page),
          sliver: SliverToBoxAdapter(child: GroupLabel('Recent calls', count: calls.value?.items.length)),
        ),
        AsyncSliver<Paged<Call>>(
          value: calls,
          errorTitle: 'Call history did not load',
          onRetry: () => ref.invalidate(callsProvider),
          data: (p) {
            if (p.items.isEmpty) {
              return const SliverToBoxAdapter(
                child: EmptyState(icon: LucideIcons.history, title: 'No calls yet', message: 'Calls you make from Vistar show up here with outcome and duration.'),
              );
            }
            final groups = <String, List<Call>>{};
            for (final c in p.items) {
              groups.putIfAbsent(dayKey(c.startedAt, tz), () => []).add(c);
            }
            final todayKey = dayKey(now, tz);
            final yKey = dayKey(now.subtract(const Duration(days: 1)), tz);
            return SliverPadding(
              padding: const EdgeInsets.symmetric(horizontal: VSpace.page),
              sliver: SliverList.list(children: [
                for (final e in groups.entries.take(7)) ...[
                  Padding(
                    padding: const EdgeInsets.fromLTRB(VSpace.xs, VSpace.sm, 0, VSpace.xs + 2),
                    child: Text(
                      e.key == todayKey ? 'Today' : (e.key == yKey ? 'Yesterday' : formatDay(e.value.first.startedAt, tz)),
                      style: context.text.labelMedium!.copyWith(color: context.colors.mutedStrong),
                    ),
                  ),
                  VCard(
                    padding: const EdgeInsets.symmetric(vertical: VSpace.xs),
                    child: Column(children: [
                      for (var i = 0; i < e.value.length; i++) ...[
                        if (i > 0) Divider(indent: 64, color: context.colors.border),
                        CallTile(call: e.value[i], tz: tz),
                      ],
                    ]),
                  ),
                  const SizedBox(height: VSpace.sm),
                ],
              ]),
            );
          },
        ),
      ],
    );
  }
}

class _CallSetupBanner extends ConsumerWidget {
  const _CallSetupBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final caps = ref.watch(_capsProvider);
    final c = caps.value;
    if (c == null || (c.fullCallTracking && c.batteryExempt)) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: VSpace.md),
      child: InfoBanner(
        icon: LucideIcons.shieldAlert,
        tone: Tone.amber,
        text: c.fullCallTracking ? 'Allow Vistar to run in the background so calls are tracked when the screen is off.' : 'Allow phone and call log access so your calls are logged with exact durations.',
        action: TextButton(onPressed: () => context.push('/call-setup'), child: const Text('Set up')),
      ),
    );
  }
}

final _capsProvider = FutureProvider.autoDispose<TelephonyCapabilities>((ref) => ref.watch(telephonyProvider).capabilities());

class CallTile extends ConsumerWidget {
  const CallTile({super.key, required this.call, required this.tz});
  final Call call;
  final String tz;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final missed = call.isMissed;
    final icon = missed ? LucideIcons.phoneMissed : (call.isInbound ? LucideIcons.phoneIncoming : LucideIcons.phoneOutgoing);
    final dirLabel = missed ? 'Missed call' : (call.isInbound ? 'Incoming call' : 'Outgoing call');
    final tone = c.tone(missed ? Tone.red : Tone.neutral);
    final name = call.leadName ?? formatPhone(call.otherNumber);
    return VListTile(
      semanticLabel: '$dirLabel, $name, ${call.durationSec > 0 ? formatDuration(call.durationSec) : 'no answer'}, ${formatTime(call.startedAt, tz)}',
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: tone.bg, shape: BoxShape.circle, border: Border.all(color: tone.border)),
        child: Icon(icon, size: 17, color: missed ? tone.fg : c.fgSecondary),
      ),
      title: name,
      titleStyle: context.text.titleSmall!.copyWith(color: missed ? c.dangerText : c.fg),
      subtitle: '${formatTime(call.startedAt, tz)} · ${call.durationSec > 0 ? formatDuration(call.durationSec) : 'No answer'}${call.hasRecording ? ' · Recording' : ''}',
      meta: [if (call.outcomeLabel != null) VChip(call.outcomeLabel!, tone: outcomeTones[call.outcome] ?? Tone.grey)],
      trailing: Row(mainAxisSize: MainAxisSize.min, children: [
        IconAction(icon: LucideIcons.squarePen, label: 'Set outcome for $name', onPressed: () => showOutcomeSheet(context, ref, call)),
        CallButton(name: name, phone: call.otherNumber, leadId: call.leadId),
      ]),
      onTap: call.leadId == null ? null : () => context.push('/leads/${call.leadId}'),
    );
  }
}

/// Disposition after a call (SPEC 15.1): outcome and a note.
Future<void> showOutcomeSheet(BuildContext context, WidgetRef ref, Call call) async {
  final notes = TextEditingController(text: call.notes ?? '');
  String? outcome = call.outcome;
  final saved = await showVSheet<bool>(
    context,
    title: 'Call outcome',
    subtitle: call.leadName ?? formatPhone(call.otherNumber),
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setState) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: VSpace.xl),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Wrap(spacing: VSpace.sm, runSpacing: VSpace.sm, children: [
            for (final e in callOutcomeLabels.entries)
              ChoiceChip(
                label: Text(e.value),
                selected: outcome == e.key,
                onSelected: (_) => setState(() => outcome = e.key),
                showCheckmark: false,
                materialTapTargetSize: MaterialTapTargetSize.padded,
              ),
          ]),
          const SizedBox(height: VSpace.lg),
          TextField(controller: notes, minLines: 2, maxLines: 4, decoration: const InputDecoration(labelText: 'Note (optional)')),
          const SizedBox(height: VSpace.lg),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Save')),
        ]),
      ),
    ),
  );
  final text = notes.text.trim();
  notes.dispose();
  if (saved != true || !context.mounted) return;
  try {
    await ref.read(callsRepositoryProvider).setOutcome(call.id, outcome: outcome, notes: text.isEmpty ? null : text);
    ref.invalidate(callsProvider);
    if (context.mounted) showToast(context, 'Call updated');
  } catch (e) {
    if (context.mounted) showToast(context, friendlyError(e), error: true);
  }
}
