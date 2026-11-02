import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/runtime.dart';
import '../../core/haptics.dart';
import '../../design/design.dart';
import '../data.dart';

/// Bottom navigation: Today, Leads, Calls, Inbox, More (SPEC 17), each tab keeps its state.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});
  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    final unread = ref.watch(inboxUnreadProvider).value ?? 0;
    ref.listen<InAppNotice?>(inAppNoticeProvider, (_, n) {
      if (n == null) return;
      final m = ScaffoldMessenger.maybeOf(context);
      m?.hideCurrentSnackBar();
      m?.showSnackBar(
        SnackBar(
          content: Text(n.body == null ? n.title : '${n.title}\n${n.body}', maxLines: 3, overflow: TextOverflow.ellipsis),
          action: SnackBarAction(label: 'Open', onPressed: () => context.push(n.route)),
          duration: const Duration(seconds: 5),
        ),
      );
    });

    NavigationDestination dest(IconData icon, String label, {int badge = 0}) => NavigationDestination(
          icon: badge > 0 ? Badge(label: Text(badge > 99 ? '99+' : '$badge'), backgroundColor: c.danger, child: Icon(icon)) : Icon(icon),
          selectedIcon: badge > 0 ? Badge(label: Text(badge > 99 ? '99+' : '$badge'), backgroundColor: c.danger, child: Icon(icon)) : Icon(icon),
          label: label,
          tooltip: badge > 0 ? '$label, $badge unread' : label,
        );

    return Scaffold(
      body: shell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(border: Border(top: BorderSide(color: c.border))),
        child: NavigationBar(
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) {
            Haptics.tap();
            shell.goBranch(i, initialLocation: i == shell.currentIndex);
          },
          destinations: [
            dest(LucideIcons.house, 'Today'),
            dest(LucideIcons.users, 'Leads'),
            dest(LucideIcons.phone, 'Calls'),
            dest(LucideIcons.messageCircle, 'Inbox', badge: unread),
            dest(LucideIcons.layoutGrid, 'More'),
          ],
        ),
      ),
    );
  }
}
