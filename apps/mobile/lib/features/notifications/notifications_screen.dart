import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../../platform/push.dart';
import '../common/common.dart';
import '../data.dart';

const _icons = {
  'lead_assigned': LucideIcons.userPlus,
  'message_received': LucideIcons.messageCircle,
  'task_due': LucideIcons.clock,
  'task_overdue': LucideIcons.alarmClock,
  'workflow_failed': LucideIcons.triangleAlert,
  'mention': LucideIcons.atSign,
  'import_completed': LucideIcons.fileCheck,
  'system': LucideIcons.info,
};

const _tones = {
  'lead_assigned': Tone.indigo,
  'message_received': Tone.green,
  'task_due': Tone.blue,
  'task_overdue': Tone.red,
  'workflow_failed': Tone.amber,
  'mention': Tone.indigo,
};

/// Notifications (newest first, grouped Today / Earlier) with mark-all-read; tapping one opens
/// the lead, chat or task it is about.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final page = ref.watch(notificationsProvider);
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final unread = page.value?.unreadCount ?? 0;
    return VPage(
      title: 'Notifications',
      subtitle: unread == 0 ? 'All caught up' : '$unread unread',
      actions: [
        if (unread > 0)
          TextButton(
            onPressed: () async {
              try {
                await ref.read(notificationsProvider.notifier).markAllRead();
              } catch (e) {
                if (context.mounted) showToast(context, friendlyError(e), error: true);
              }
            },
            child: const Text('Mark all read'),
          ),
      ],
      onRefresh: () async => ref.invalidate(notificationsProvider),
      slivers: [
        AsyncSliver<NotificationPage>(
          value: page,
          errorTitle: 'Notifications did not load',
          onRetry: () => ref.invalidate(notificationsProvider),
          data: (p) {
            if (p.items.isEmpty) {
              return const SliverToBoxAdapter(
                child: EmptyState(icon: LucideIcons.bellOff, title: 'No notifications yet', message: 'New leads, due tasks and WhatsApp replies show up here and as push notifications on your phone.'),
              );
            }
            final today = p.items.where((n) => dayKey(n.createdAt, tz) == dayKey(now, tz)).toList();
            final earlier = p.items.where((n) => dayKey(n.createdAt, tz) != dayKey(now, tz)).toList();
            Widget section(String label, List<AppNotification> items) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  GroupLabel(label, count: items.length),
                  VCard(
                    padding: const EdgeInsets.symmetric(vertical: VSpace.xs),
                    child: Column(children: [
                      for (var i = 0; i < items.length; i++) ...[
                        if (i > 0) Divider(height: 1, indent: 64, color: context.colors.border),
                        _NotificationRow(n: items[i], now: now, tz: tz),
                      ],
                    ]),
                  ),
                ]);
            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(VSpace.page, 0, VSpace.page, 0),
              sliver: SliverList.list(children: [
                if (today.isNotEmpty) section('Today', today),
                if (earlier.isNotEmpty) section('Earlier', earlier),
              ]),
            );
          },
        ),
      ],
    );
  }
}

class _NotificationRow extends ConsumerWidget {
  const _NotificationRow({required this.n, required this.now, required this.tz});
  final AppNotification n;
  final DateTime now;
  final String tz;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final t = c.tone(_tones[n.type] ?? Tone.neutral);
    final when = dayKey(n.createdAt, tz) == dayKey(now, tz) ? timeAgo(n.createdAt, now) : formatDayTime(n.createdAt, tz);
    return VListTile(
      semanticLabel: '${n.unread ? 'Unread. ' : ''}${n.title}. ${n.body ?? ''}. $when',
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(12), border: Border.all(color: t.border)),
        child: Icon(_icons[n.type] ?? LucideIcons.bell, size: 18, color: t.fg),
      ),
      title: n.title,
      titleStyle: context.text.titleSmall!.copyWith(fontWeight: n.unread ? FontWeight.w700 : FontWeight.w500),
      subtitle: n.body,
      meta: [VChip(when, dense: true)],
      trailing: n.unread
          ? Padding(
              padding: const EdgeInsets.only(right: VSpace.xs),
              child: Container(width: 9, height: 9, decoration: BoxDecoration(color: c.accent, shape: BoxShape.circle)),
            )
          : null,
      onTap: () {
        ref.read(notificationsProvider.notifier).markRead(n);
        final route = routeForNotification({'href': n.href, ...n.data});
        if (route != '/notifications') context.push(route);
      },
    );
  }
}
