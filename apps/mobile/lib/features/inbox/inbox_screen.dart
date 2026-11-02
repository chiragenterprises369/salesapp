import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../design/design.dart';
import '../common/common.dart';
import '../data.dart';

/// WhatsApp inbox (SPEC 14): my conversations with unread counts and the 24 h window indicator.
class InboxScreen extends ConsumerStatefulWidget {
  const InboxScreen({super.key});

  @override
  ConsumerState<InboxScreen> createState() => _InboxScreenState();
}

class _InboxScreenState extends ConsumerState<InboxScreen> {
  InboxFilter _filter = InboxFilter.all;
  String _q = '';
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  static String label(InboxFilter f) => switch (f) {
        InboxFilter.all => 'All',
        InboxFilter.unread => 'Unread',
        InboxFilter.needsReply => 'Needs reply',
        InboxFilter.closed => 'Closed',
      };

  @override
  Widget build(BuildContext context) {
    final key = (_filter, _q);
    final list = ref.watch(conversationsProvider(key));
    final unread = ref.watch(inboxUnreadProvider).value ?? 0;
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    return VPage(
      title: 'Inbox',
      subtitle: unread > 0 ? '$unread unread · WhatsApp chats with your leads' : 'WhatsApp chats with your leads',
      actions: const [TopActions(showStatus: false)],
      onRefresh: () async {
        ref.invalidate(conversationsProvider(key));
        ref.invalidate(inboxUnreadProvider);
      },
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(116),
        child: Column(children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(VSpace.page, 0, VSpace.page, 0),
            child: VSearchField(
              hint: 'Search name, number or message',
              onChanged: (v) {
                _debounce?.cancel();
                _debounce = Timer(const Duration(milliseconds: 300), () => setState(() => _q = v));
              },
            ),
          ),
          FilterChipBar<InboxFilter>(options: InboxFilter.values, selected: _filter, label: label, onSelected: (f) => setState(() => _filter = f)),
        ]),
      ),
      slivers: [
        AsyncSliver<List<Conversation>>(
          value: list,
          errorTitle: 'Chats did not load',
          onRetry: () => ref.invalidate(conversationsProvider(key)),
          data: (items) {
            if (items.isEmpty) {
              return SliverToBoxAdapter(
                child: EmptyState(
                  icon: LucideIcons.messageCircle,
                  title: _q.isNotEmpty || _filter != InboxFilter.all ? 'No chats match' : 'No chats yet',
                  message: _q.isNotEmpty || _filter != InboxFilter.all ? 'Try another search or filter.' : 'WhatsApp conversations assigned to you appear here.',
                ),
              );
            }
            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
              sliver: SliverToBoxAdapter(
                child: VCard(
                  padding: const EdgeInsets.symmetric(vertical: VSpace.xs),
                  child: Column(children: [
                    for (var i = 0; i < items.length; i++) ...[
                      if (i > 0) Divider(indent: 68, color: context.colors.border),
                      ConversationTile(conversation: items[i], now: now, tz: tz),
                    ],
                  ]),
                ),
              ),
            );
          },
        ),
      ],
    );
  }
}

class ConversationTile extends StatelessWidget {
  const ConversationTile({super.key, required this.conversation, required this.now, required this.tz});
  final Conversation conversation;
  final DateTime now;
  final String tz;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final cv = conversation;
    final unread = cv.unreadCount > 0;
    final at = cv.lastMessageAt;
    final sameDay = at != null && dayKey(at, tz) == dayKey(now, tz);
    final when = at == null ? '' : (sameDay ? formatTime(at, tz) : formatShortDay(at, tz));
    final left = cv.windowLeft(now);
    return Semantics(
      button: true,
      label: '${cv.contactName}${unread ? ', ${cv.unreadCount} unread' : ''}. ${cv.lastMessagePreview ?? ''}. $when',
      child: ExcludeSemantics(
        child: InkWell(
          onTap: () => context.push('/inbox/${cv.id}'),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: VSpace.md, vertical: VSpace.md - 2),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              VAvatar(name: cv.contactName, size: 44),
              const SizedBox(width: VSpace.md),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(cv.contactName, style: context.text.titleSmall!.copyWith(fontWeight: unread ? FontWeight.w700 : FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis)),
                    Text(when, style: context.text.labelMedium!.copyWith(color: unread ? c.accentText : c.muted, fontWeight: unread ? FontWeight.w700 : FontWeight.w500)),
                  ]),
                  const SizedBox(height: 2),
                  Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Text(
                        cv.lastMessagePreview ?? 'No messages yet',
                        style: context.text.bodyMedium!.copyWith(color: unread ? c.fg : c.mutedStrong),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    if (unread)
                      Container(
                        margin: const EdgeInsets.only(left: VSpace.sm, top: 2),
                        constraints: const BoxConstraints(minWidth: 22),
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(color: c.accent, borderRadius: BorderRadius.circular(VRadius.pill)),
                        child: Text('${cv.unreadCount}', textAlign: TextAlign.center, style: context.text.labelSmall!.copyWith(color: c.onAccent, fontWeight: FontWeight.w700)),
                      ),
                  ]),
                  if (cv.status != 'closed') ...[
                    const SizedBox(height: 6),
                    left != null
                        ? VChip('24h window · ${formatSpan(left)} left', tone: left.inHours < 2 ? Tone.amber : Tone.green, icon: LucideIcons.clock, dense: true)
                        : const VChip('Window closed · template only', tone: Tone.grey, icon: LucideIcons.lock, dense: true),
                  ],
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
  }
}
