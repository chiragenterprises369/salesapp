import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../core/haptics.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../common/common.dart';
import '../data.dart';

const statusHints = {
  PresenceStatus.available: 'Ready for calls and new leads',
  PresenceStatus.breakTime: 'A short break. New leads skip you',
  PresenceStatus.lunch: 'Out for lunch. New leads skip you',
  PresenceStatus.meeting: 'In a meeting. Calls can wait',
  PresenceStatus.fieldVisit: 'Visiting a customer outside the office',
  PresenceStatus.offline: 'Done for the day',
};

const statusIcons = {
  PresenceStatus.available: LucideIcons.circleCheck,
  PresenceStatus.breakTime: LucideIcons.coffee,
  PresenceStatus.lunch: LucideIcons.utensils,
  PresenceStatus.meeting: LucideIcons.users,
  PresenceStatus.fieldVisit: LucideIcons.mapPin,
  PresenceStatus.offline: LucideIcons.moon,
};

Future<void> showStatusSheet(BuildContext context, WidgetRef ref) => showVSheet<void>(
      context,
      title: 'My status',
      subtitle: 'Your team and lead routing see this on the Team Floor.',
      builder: (_) => const StatusOptions(),
    );

class StatusOptions extends ConsumerWidget {
  const StatusOptions({super.key, this.closeOnPick = true});
  final bool closeOnPick;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final current = ref.watch(myStatusProvider);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: VSpace.lg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (current == PresenceStatus.onCall || current == PresenceStatus.busy)
            Padding(
              padding: const EdgeInsets.only(bottom: VSpace.md),
              child: InfoBanner(
                icon: LucideIcons.phone,
                tone: Tone.blue,
                text: current == PresenceStatus.onCall ? 'You are On call. Vistar sets this from your phone and clears it when the call ends.' : 'You are Busy while you wrap up a call. Pick a status to change it.',
              ),
            ),
          for (final s in PresenceStatus.selfService)
            Padding(
              padding: const EdgeInsets.only(bottom: VSpace.sm),
              child: _StatusOption(
                status: s,
                selected: s == current,
                onTap: () async {
                  await Haptics.tap();
                  final nav = Navigator.of(context);
                  try {
                    await ref.read(myStatusProvider.notifier).set(s);
                    if (closeOnPick && nav.canPop()) nav.pop();
                    if (context.mounted) showToast(context, 'Status set to ${s.label}');
                  } catch (e) {
                    if (context.mounted) showToast(context, friendlyError(e), error: true);
                  }
                },
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(VSpace.xs, VSpace.sm, VSpace.xs, VSpace.sm),
            child: Text(
              'On call is set from your phone while a call is live. You show as Offline when the app has not been seen for 45 seconds. '
              'Vistar cannot know whether you are at your desk.',
              style: context.text.bodySmall!.copyWith(color: c.mutedStrong),
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusOption extends StatelessWidget {
  const _StatusOption({required this.status, required this.selected, required this.onTap});
  final PresenceStatus status;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = c.tone(toneForStatus(status));
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      button: true,
      label: '${status.label}. ${statusHints[status]}',
      child: ExcludeSemantics(
        child: Material(
          color: selected ? c.accentSoft : c.surface,
          borderRadius: BorderRadius.circular(VRadius.lg),
          child: InkWell(
            borderRadius: BorderRadius.circular(VRadius.lg),
            onTap: onTap,
            child: AnimatedContainer(
              duration: VMotion.of(context, VMotion.fast),
              constraints: const BoxConstraints(minHeight: 64),
              padding: const EdgeInsets.symmetric(horizontal: VSpace.md + 2, vertical: VSpace.md),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(VRadius.lg),
                border: Border.all(color: selected ? c.brand.ring : c.border, width: selected ? 1.6 : 1),
              ),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(11), border: Border.all(color: t.border)),
                    child: Icon(statusIcons[status], size: 18, color: t.fg),
                  ),
                  const SizedBox(width: VSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(status.label, style: context.text.titleSmall!.copyWith(color: selected ? c.accentSoftFg : c.fg)),
                        Text(statusHints[status]!, style: context.text.bodySmall!.copyWith(color: selected ? c.accentSoftFg.withValues(alpha: 0.85) : c.mutedStrong)),
                      ],
                    ),
                  ),
                  AnimatedOpacity(
                    opacity: selected ? 1 : 0,
                    duration: VMotion.of(context, VMotion.fast),
                    child: Icon(LucideIcons.check, size: 20, color: c.accentSoftFg),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
