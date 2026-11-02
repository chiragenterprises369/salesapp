import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/api/api_error.dart';
import '../../core/format.dart';
import '../../core/time/zoned.dart';
import '../../design/design.dart';
import '../data.dart';
import '../status/status_sheet.dart';

/// App bar actions on the tab screens: my status pill and the notifications bell.
class TopActions extends ConsumerWidget {
  const TopActions({super.key, this.showStatus = true});
  final bool showStatus;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(myStatusProvider);
    final unread = ref.watch(notificationsProvider).value?.unreadCount ?? 0;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (showStatus) StatusPill(status, onTap: () => showStatusSheet(context, ref)),
        IconAction(icon: LucideIcons.bell, label: 'Notifications', badge: unread, onPressed: () => context.push('/notifications')),
      ],
    );
  }
}

/// Renders an AsyncValue as a sliver: shimmer skeleton, error with retry, or the data.
class AsyncSliver<T> extends StatelessWidget {
  const AsyncSliver({super.key, required this.value, required this.data, required this.onRetry, this.errorTitle = 'This did not load', this.skeletonRows = 5, this.skeleton});

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final VoidCallback onRetry;
  final String errorTitle;
  final int skeletonRows;
  final Widget? skeleton;

  @override
  Widget build(BuildContext context) {
    final v = value;
    if (v.hasValue) return data(v.requireValue);
    if (v.hasError) {
      final f = ApiFailure.from(v.error!);
      return SliverToBoxAdapter(
        child: ErrorState(title: errorTitle, message: f.network ? 'Check your connection, then try again.' : f.message, onRetry: onRetry),
      );
    }
    return SliverPadding(
      padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
      sliver: SliverToBoxAdapter(child: skeleton ?? SkeletonList(rows: skeletonRows)),
    );
  }
}

/// "Offline: showing what was saved at 10:42 am" and "3 changes waiting to upload".
class OfflineBanner extends ConsumerWidget {
  const OfflineBanner({super.key, this.fromCache = false, this.savedAt});
  final bool fromCache;
  final DateTime? savedAt;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pending = ref.watch(pendingWritesProvider).value ?? 0;
    final tz = timezoneOf(ref);
    if (!fromCache && pending == 0) return const SizedBox.shrink();
    final text = fromCache
        ? 'Offline. Showing what was saved${savedAt == null ? '' : ' at ${formatTime(savedAt!, tz)}'}. ${pending > 0 ? '$pending ${pending == 1 ? 'change waits' : 'changes wait'} to upload.' : 'Pull down to refresh.'}'
        : '$pending ${pending == 1 ? 'change' : 'changes'} waiting to upload. They are sent as soon as you are online.';
    return Padding(
      padding: const EdgeInsets.only(bottom: VSpace.md),
      child: InfoBanner(icon: fromCache ? LucideIcons.wifiOff : LucideIcons.cloudUpload, text: text),
    );
  }
}

/// Due time chip: red "Overdue 2 days", or the time today, or the date.
class DueChip extends StatelessWidget {
  const DueChip({super.key, required this.due, required this.now, required this.timezone});
  final DateTime? due;
  final DateTime now;
  final String timezone;

  @override
  Widget build(BuildContext context) {
    final d = due;
    if (d == null) return const SizedBox.shrink();
    if (d.isBefore(now)) return VChip(overdueLabel(d, now), tone: Tone.red, dot: true);
    final sameDay = dayKey(d, timezone) == dayKey(now, timezone);
    return VChip(sameDay ? formatTime(d, timezone) : formatDayTime(d, timezone), icon: LucideIcons.clock);
  }
}

String friendlyError(Object e) => ApiFailure.from(e).message;
