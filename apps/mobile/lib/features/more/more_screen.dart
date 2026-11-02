import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../design/design.dart';
import '../common/common.dart';
import '../data.dart';
import '../status/status_sheet.dart';

/// More tab (SPEC 17): status, Team Floor, Tasks, Attendance, My performance, notifications,
/// profile, preferences, about, sign out. Items the company switched off are hidden (5.3).
class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final me = ref.watch(meProvider);
    final status = ref.watch(myStatusProvider);
    final zone = ref.watch(myPresenceProvider.select((p) => p.location));
    final unread = ref.watch(notificationsProvider).value?.unreadCount ?? 0;
    final openTasks = ref.watch(tasksProvider).value?.tasks.where((t) => t.status == 'open').length;
    final demo = ref.watch(isDemoProvider);
    final c = context.colors;
    final canFloor = me?.can('teamfloor.read') ?? true;
    final fieldStaff = me?.user.isFieldStaff ?? false;
    final tracking = me?.workspace.feature('field_tracking') ?? true;

    Widget group(String label, List<Widget> rows) => Padding(
          padding: const EdgeInsets.only(bottom: VSpace.md),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            GroupLabel(label),
            VCard(
              padding: EdgeInsets.zero,
              child: Column(children: [
                for (var i = 0; i < rows.length; i++) ...[
                  if (i > 0) Divider(height: 1, indent: 68, color: c.border),
                  rows[i],
                ],
              ]),
            ),
          ]),
        );

    return VPage(
      title: 'More',
      actions: const [TopActions(showStatus: false)],
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.xs, VSpace.page, 0),
          sliver: SliverList.list(children: [
            if (demo) ...[
              const InfoBanner(icon: LucideIcons.flaskConical, tone: Tone.indigo, text: 'Demo mode: sample data, nothing is sent to a server. Sign out to use your company account.'),
              const SizedBox(height: VSpace.sm),
            ],
            VCard(
              onTap: () => context.push('/profile'),
              semanticLabel: 'My profile, ${me?.user.name ?? ''}',
              child: Row(children: [
                VAvatar(name: me?.user.name ?? 'You', size: 52, status: status),
                const SizedBox(width: VSpace.md),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(me?.user.name ?? 'You', style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                    Text(
                      [me?.user.title ?? me?.roleName, me?.workspace.displayName].whereType<String>().join(' · '),
                      style: context.text.bodySmall!.copyWith(color: c.mutedStrong),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ]),
                ),
                Icon(LucideIcons.chevronRight, size: 18, color: c.muted),
              ]),
            ),
            const SizedBox(height: VSpace.xs),
            group('Today', [
              NavRow(
                icon: LucideIcons.activity,
                label: 'My status',
                hint: zone?.zoneName == null ? status.label : '${status.label} · ${zone!.zoneName}',
                trailing: StatusPill(status),
                onTap: () => showStatusSheet(context, ref),
              ),
              NavRow(icon: LucideIcons.listTodo, label: 'Tasks and reminders', hint: openTasks == null ? null : '$openTasks open', onTap: () => context.push('/tasks')),
              if (canFloor) NavRow(icon: LucideIcons.layoutDashboard, label: 'Team Floor', hint: 'Who is free, on a call or away, and where', onTap: () => context.push('/team-floor')),
              if (fieldStaff && tracking) NavRow(icon: LucideIcons.mapPinCheck, label: 'Attendance', hint: 'Check in and out of field visits', onTap: () => context.push('/attendance')),
              NavRow(icon: LucideIcons.chartColumn, label: 'My performance', hint: 'Targets, calls and talk time', onTap: () => context.push('/performance')),
            ]),
            group('Account', [
              NavRow(
                icon: LucideIcons.bell,
                label: 'Notifications',
                hint: unread > 0 ? '$unread unread' : 'All caught up',
                onTap: () => context.push('/notifications'),
              ),
              NavRow(icon: LucideIcons.slidersHorizontal, label: 'Preferences', hint: 'Theme, notifications, calls and office location', onTap: () => context.push('/preferences')),
              NavRow(icon: LucideIcons.info, label: 'About and updates', hint: 'Version, app download and privacy', onTap: () => context.push('/about')),
            ]),
            VCard(
              padding: EdgeInsets.zero,
              child: NavRow(
                icon: LucideIcons.logOut,
                label: 'Sign out',
                destructive: true,
                onTap: () async {
                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('Sign out?'),
                      content: const Text('Queued call logs and task updates are sent first. Call tracking and location sharing stop on this phone.'),
                      actions: [
                        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
                        FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Sign out')),
                      ],
                    ),
                  );
                  if (ok == true) await ref.read(sessionProvider.notifier).signOut();
                },
              ),
            ),
          ]),
        ),
      ],
    );
  }
}
