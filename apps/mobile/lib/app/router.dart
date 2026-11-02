import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/about/about_screen.dart';
import '../features/attendance/attendance_screen.dart';
import '../features/auth/login_screen.dart';
import '../features/calls/call_setup_screen.dart';
import '../features/calls/calls_screen.dart';
import '../features/inbox/chat_screen.dart';
import '../features/inbox/inbox_screen.dart';
import '../features/leads/lead_detail_screen.dart';
import '../features/leads/leads_screen.dart';
import '../features/more/more_screen.dart';
import '../features/more/preferences_screen.dart';
import '../features/more/profile_screen.dart';
import '../features/notifications/notifications_screen.dart';
import '../features/performance/performance_screen.dart';
import '../features/shell/shell.dart';
import '../features/tasks/tasks_screen.dart';
import '../features/team_floor/office_zone_screen.dart';
import '../features/team_floor/team_floor_screen.dart';
import '../features/today/today_screen.dart';
import 'providers.dart';

final rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'root');

class _SessionListenable extends ChangeNotifier {
  void ping() => notifyListeners();
}

/// Routes. Tabs (Today, Leads, Calls, Inbox, More) keep their state in an indexed stack; details
/// and More pages open full screen on the root navigator.
final routerProvider = Provider<GoRouter>((ref) {
  final listenable = _SessionListenable();
  ref.listen(sessionProvider, (_, _) => listenable.ping());
  ref.onDispose(listenable.dispose);

  GoRoute page(String path, Widget Function(GoRouterState s) build) =>
      GoRoute(path: path, parentNavigatorKey: rootNavigatorKey, builder: (context, s) => build(s));

  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/today',
    refreshListenable: listenable,
    redirect: (context, state) {
      final s = ref.read(sessionProvider);
      final loc = state.matchedLocation;
      if (s is SessionRestoring) return loc == '/splash' ? null : '/splash';
      if (s is SignedOut) return loc == '/login' ? null : '/login';
      if (loc == '/login' || loc == '/splash' || loc == '/') return '/today';
      return null;
    },
    routes: [
      GoRoute(path: '/', redirect: (_, _) => '/today'),
      GoRoute(path: '/splash', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/today', builder: (_, _) => const TodayScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/leads', builder: (_, _) => const LeadsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/calls', builder: (_, _) => const CallsScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/inbox', builder: (_, _) => const InboxScreen())]),
          StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (_, _) => const MoreScreen())]),
        ],
      ),
      page('/leads/:id', (s) => LeadDetailScreen(leadId: s.pathParameters['id']!)),
      page('/inbox/:id', (s) => ChatScreen(conversationId: s.pathParameters['id']!)),
      page('/tasks', (_) => const TasksScreen()),
      page('/team-floor', (_) => const TeamFloorScreen()),
      page('/attendance', (_) => const AttendanceScreen()),
      page('/performance', (_) => const PerformanceScreen()),
      page('/notifications', (_) => const NotificationsScreen()),
      page('/profile', (_) => const ProfileScreen()),
      page('/preferences', (_) => const PreferencesScreen()),
      page('/about', (_) => const AboutScreen()),
      page('/call-setup', (_) => const CallSetupScreen()),
      page('/office-zone', (_) => const OfficeZoneScreen()),
    ],
  );
});
