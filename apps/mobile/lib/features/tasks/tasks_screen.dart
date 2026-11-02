import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/haptics.dart';
import '../../core/tasks/buckets.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../calls/call_actions.dart';
import '../common/common.dart';
import '../data.dart';

/// Tasks and reminders by due time: tick to complete (with Undo), snooze, call. Works offline:
/// completions are queued and sent when the phone is back online (SPEC 15.2).
class TasksScreen extends ConsumerWidget {
  const TasksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasks = ref.watch(tasksProvider);
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final openCount = tasks.value?.tasks.where((t) => !t.isDone).length;
    return VPage(
      title: 'Tasks',
      subtitle: openCount == null ? 'Follow-ups and reminders by due time' : '$openCount open · tick a task when it is done',
      onRefresh: () async => ref.invalidate(tasksProvider),
      slivers: [
        AsyncSliver<TasksState>(
          value: tasks,
          errorTitle: 'Your tasks did not load',
          onRetry: () => ref.invalidate(tasksProvider),
          data: (s) {
            final groups = bucketTasks(s.tasks, now: now, timezone: tz);
            if (s.tasks.isEmpty) {
              return const SliverToBoxAdapter(
                child: EmptyState(icon: LucideIcons.listTodo, title: 'No tasks', message: 'Tasks you add on a lead, and tasks from workflows, appear here.'),
              );
            }
            final allDone = !groups.keys.any((b) => b != TaskBucket.done);
            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.xs, VSpace.page, 0),
              sliver: SliverList.list(children: [
                OfflineBanner(fromCache: s.fromCache, savedAt: s.savedAt),
                if (allDone)
                  const EmptyState(compact: true, icon: LucideIcons.partyPopper, title: 'All done for now', message: 'New tasks appear here as soon as they are assigned to you.'),
                for (final e in groups.entries) ...[
                  GroupLabel(e.key.label, count: e.value.length, color: e.key == TaskBucket.overdue ? context.colors.dangerText : null),
                  VCard(
                    padding: const EdgeInsets.symmetric(vertical: VSpace.xs),
                    child: Column(children: [
                      for (var i = 0; i < e.value.length; i++) ...[
                        if (i > 0) Divider(indent: 60, color: context.colors.border),
                        TaskTile(task: e.value[i], now: now, tz: tz),
                      ],
                    ]),
                  ),
                ],
              ]),
            );
          },
        ),
      ],
    );
  }
}

class TaskTile extends ConsumerWidget {
  const TaskTile({super.key, required this.task, required this.now, required this.tz});
  final Task task;
  final DateTime now;
  final String tz;

  Future<void> _toggle(BuildContext context, WidgetRef ref) async {
    final done = !task.isDone;
    await (done ? Haptics.success() : Haptics.tap());
    try {
      await ref.read(tasksProvider.notifier).setDone(task, done);
      if (!context.mounted) return;
      if (done) {
        showToast(context, 'Task completed', actionLabel: 'Undo', onAction: () => ref.read(tasksProvider.notifier).setDone(task.copyWith(status: 'done'), false));
      }
    } catch (e) {
      if (context.mounted) showToast(context, friendlyError(e), error: true);
    }
  }

  Future<void> _snooze(BuildContext context, WidgetRef ref) async {
    final opts = snoozeOptions(now, tz);
    final until = await showVSheet<DateTime>(
      context,
      title: 'Snooze task',
      subtitle: task.title,
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        for (final o in opts) NavRow(icon: LucideIcons.alarmClock, label: o.$1, hint: formatDayTime(o.$2, tz), onTap: () => Navigator.of(ctx).pop(o.$2)),
      ]),
    );
    if (until == null || !context.mounted) return;
    try {
      await ref.read(tasksProvider.notifier).snooze(task, until);
      if (context.mounted) showToast(context, 'Snoozed until ${formatDayTime(until, tz)}');
    } catch (e) {
      if (context.mounted) showToast(context, friendlyError(e), error: true);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final done = task.isDone;
    return Semantics(
      container: true,
      child: Padding(
        padding: const EdgeInsets.only(left: VSpace.xs, right: VSpace.xs),
        child: Row(crossAxisAlignment: CrossAxisAlignment.center, children: [
          Semantics(
            checked: done,
            label: '${done ? 'Reopen' : 'Complete'}: ${task.title}',
            child: SizedBox(
              width: 52,
              height: 52,
              child: Center(
                child: Checkbox(value: done, onChanged: (_) => _toggle(context, ref), semanticLabel: '${done ? 'Reopen' : 'Complete'}: ${task.title}'),
              ),
            ),
          ),
          Expanded(
            child: InkWell(
              onTap: task.leadId == null ? null : () => context.push('/leads/${task.leadId}'),
              borderRadius: BorderRadius.circular(VRadius.md),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: VSpace.sm + 2),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  AnimatedDefaultTextStyle(
                    duration: VMotion.of(context, VMotion.fast),
                    style: context.text.titleSmall!.copyWith(
                      color: done ? c.muted : c.fg,
                      decoration: done ? TextDecoration.lineThrough : null,
                      decorationColor: c.muted,
                    ),
                    child: Text(task.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                  ),
                  if (task.leadName != null) Text(task.leadName!, style: context.text.bodySmall!.copyWith(color: c.mutedStrong), maxLines: 1),
                  const SizedBox(height: 4),
                  Wrap(spacing: 6, runSpacing: 4, children: [
                    VChip(task.typeLabel),
                    if (!done) DueChip(due: task.effectiveDue, now: now, timezone: tz),
                    if (!done && task.isHighPriority) VChip(task.priority == 'urgent' ? 'Urgent' : 'High', tone: task.priority == 'urgent' ? Tone.red : Tone.amber),
                    if (!done && task.snoozedUntil != null && task.snoozedUntil!.isAfter(now)) VChip('Snoozed', tone: Tone.indigo, icon: LucideIcons.alarmClock),
                  ]),
                ]),
              ),
            ),
          ),
          if (!done) ...[
            IconAction(icon: LucideIcons.alarmClock, label: 'Snooze ${task.title}', onPressed: () => _snooze(context, ref)),
            if (task.leadId != null && (task.type == 'call' || task.type == 'follow_up')) TaskCallButton(task: task),
          ],
        ]),
      ),
    );
  }
}
