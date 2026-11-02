import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/haptics.dart';
import '../../core/time/zoned.dart';
import '../../data/api/endpoints.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../calls/call_actions.dart';
import '../common/common.dart';
import '../data.dart';

/// Chat with delivery ticks (queued, sent, delivered, read), templates, quick replies and the
/// 24 h customer-service window (free text only inside it; templates outside).
class ChatScreen extends ConsumerStatefulWidget {
  const ChatScreen({super.key, required this.conversationId});
  final String conversationId;

  @override
  ConsumerState<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends ConsumerState<ChatScreen> {
  final _text = TextEditingController();
  final _scroll = ScrollController();

  @override
  void dispose() {
    _text.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final body = _text.text.trim();
    if (body.isEmpty) return;
    _text.clear();
    setState(() {});
    await Haptics.tap();
    try {
      await ref.read(chatProvider(widget.conversationId).notifier).sendText(body);
      ref.invalidate(conversationsProvider);
    } catch (e) {
      if (!mounted) return;
      final msg = friendlyError(e);
      showToast(context, msg.contains('window') || e.toString().contains(Codes.windowClosed) ? 'The 24 hour window is closed. Send an approved template.' : msg, error: true);
    }
  }

  Future<void> _pickTemplate(Conversation cv) async {
    final templates = await ref.read(templatesProvider.future).catchError((_) => <MessageTemplate>[]);
    if (!mounted) return;
    final approved = templates.where((t) => t.approved).toList();
    final me = ref.read(meProvider);
    final picked = await showVSheet<MessageTemplate>(
      context,
      title: 'Send a template',
      subtitle: 'Approved WhatsApp templates work at any time',
      builder: (ctx) => approved.isEmpty
          ? const EmptyState(compact: true, icon: LucideIcons.fileText, title: 'No approved templates', message: 'Your admin adds templates in Settings.')
          : Column(mainAxisSize: MainAxisSize.min, children: [
              for (final t in approved) NavRow(icon: LucideIcons.fileText, label: t.displayName, hint: t.body, onTap: () => Navigator.of(ctx).pop(t)),
            ]),
    );
    if (picked == null) return;
    // Variables: lead name and my name are filled in; others stay as typed by the template.
    final vars = <String, String>{};
    for (var i = 0; i < picked.variables.length; i++) {
      final key = picked.variables[i];
      vars['${i + 1}'] = key == 'lead.name' ? cv.contactName.split(' ').first : (key == 'owner.name' ? (me?.user.firstName ?? '') : '');
    }
    try {
      await ref.read(chatProvider(widget.conversationId).notifier).sendTemplate(picked, vars);
      ref.invalidate(conversationsProvider);
    } catch (e) {
      if (mounted) showToast(context, friendlyError(e), error: true);
    }
  }

  Future<void> _quickReplies() async {
    final replies = await ref.read(quickRepliesProvider.future).catchError((_) => <QuickReply>[]);
    if (!mounted) return;
    final picked = await showVSheet<QuickReply>(
      context,
      title: 'Quick replies',
      builder: (ctx) => replies.isEmpty
          ? const EmptyState(compact: true, icon: LucideIcons.zap, title: 'No quick replies', message: 'Your admin adds them in Settings.')
          : Column(mainAxisSize: MainAxisSize.min, children: [
              for (final r in replies) NavRow(icon: LucideIcons.zap, label: r.shortcut, hint: r.body, onTap: () => Navigator.of(ctx).pop(r)),
            ]),
    );
    if (picked != null) {
      _text.text = picked.body;
      _text.selection = TextSelection.collapsed(offset: picked.body.length);
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final conv = ref.watch(conversationProvider(widget.conversationId));
    final messages = ref.watch(chatProvider(widget.conversationId));
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final cv = conv.value;
    final windowOpen = cv?.windowOpen(now) ?? false;
    final left = cv?.windowLeft(now);

    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: cv == null
            ? const Text('Chat')
            : InkWell(
                onTap: cv.leadId == null ? null : () => context.push('/leads/${cv.leadId}'),
                child: Row(children: [
                  VAvatar(name: cv.contactName, size: 36),
                  const SizedBox(width: VSpace.md),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
                      Text(cv.contactName, style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                      Text(formatPhone(cv.contactPhone), style: context.text.bodySmall),
                    ]),
                  ),
                ]),
              ),
        actions: [if (cv != null) IconAction(icon: LucideIcons.phone, label: 'Call ${cv.contactName}', onPressed: () => callNumber(context, ref, name: cv.contactName, phone: cv.contactPhone, leadId: cv.leadId))],
        bottom: PreferredSize(preferredSize: const Size.fromHeight(1), child: Divider(height: 1, color: c.border)),
      ),
      body: Column(children: [
        if (cv != null)
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(horizontal: VSpace.page, vertical: VSpace.sm),
            color: c.surface,
            child: Semantics(
              liveRegion: true,
              child: Row(children: [
                Icon(windowOpen ? LucideIcons.clock : LucideIcons.lock, size: 15, color: windowOpen ? c.successText : c.mutedStrong),
                const SizedBox(width: VSpace.sm),
                Expanded(
                  child: Text(
                    windowOpen ? '24 hour window open · ${formatSpan(left!)} left to reply freely' : 'Window closed. Send an approved template to restart the chat.',
                    style: context.text.bodySmall!.copyWith(color: windowOpen ? c.successText : c.mutedStrong),
                  ),
                ),
              ]),
            ),
          ),
        Expanded(
          child: messages.when(
            loading: () => const Padding(padding: EdgeInsets.all(VSpace.page), child: SkeletonList(rows: 6, card: false)),
            error: (e, _) => ErrorState(title: 'Messages did not load', onRetry: () => ref.invalidate(chatProvider(widget.conversationId))),
            data: (list) => list.isEmpty
                ? const EmptyState(icon: LucideIcons.messageCircle, title: 'No messages yet', message: 'Send a template to start the conversation.')
                : ListView.builder(
                    controller: _scroll,
                    reverse: true,
                    padding: const EdgeInsets.fromLTRB(VSpace.md, VSpace.md, VSpace.md, VSpace.md),
                    itemCount: list.length,
                    itemBuilder: (context, i) {
                      final m = list[list.length - 1 - i];
                      final prev = list.length - 2 - i >= 0 ? list[list.length - 2 - i] : null;
                      final showDay = prev == null || dayKey(prev.createdAt, tz) != dayKey(m.createdAt, tz);
                      return Column(children: [
                        if (showDay) _DayDivider(label: dayKey(m.createdAt, tz) == dayKey(now, tz) ? 'Today' : formatDay(m.createdAt, tz)),
                        Bubble(message: m, tz: tz),
                      ]);
                    },
                  ),
          ),
        ),
        _Composer(
          controller: _text,
          windowOpen: windowOpen,
          optedOut: cv?.optedOut ?? false,
          onChanged: () => setState(() {}),
          onSend: _send,
          onTemplate: cv == null ? null : () => _pickTemplate(cv),
          onQuickReply: _quickReplies,
        ),
      ]),
    );
  }
}

class _DayDivider extends StatelessWidget {
  const _DayDivider({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: VSpace.md),
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
            decoration: BoxDecoration(color: context.colors.surface3, borderRadius: BorderRadius.circular(VRadius.pill)),
            child: Text(label, style: context.text.labelSmall!.copyWith(color: context.colors.mutedStrong)),
          ),
        ),
      );
}

class Bubble extends StatelessWidget {
  const Bubble({super.key, required this.message, required this.tz});
  final Message message;
  final String tz;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final out = message.isOutbound;
    final bg = out ? c.accentSoft : c.surface;
    final fg = out ? (c.dark ? c.fg : c.fg) : c.fg;
    final statusLabel = switch (message.status) {
      'queued' => 'Sending',
      'sent' => 'Sent',
      'delivered' => 'Delivered',
      'read' => 'Read',
      'failed' => 'Not delivered',
      _ => message.status,
    };
    return Semantics(
      label: '${out ? 'You' : 'They'}: ${message.body ?? ''}. ${formatTime(message.createdAt, tz)}${out ? ', $statusLabel' : ''}',
      child: ExcludeSemantics(
        child: Align(
          alignment: out ? Alignment.centerRight : Alignment.centerLeft,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.8),
            child: Container(
              margin: const EdgeInsets.symmetric(vertical: 3),
              padding: const EdgeInsets.fromLTRB(VSpace.md, VSpace.sm, VSpace.md, 6),
              decoration: BoxDecoration(
                color: bg,
                border: Border.all(color: out ? c.accentSoftFg.withValues(alpha: 0.18) : c.border),
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(16),
                  topRight: const Radius.circular(16),
                  bottomLeft: Radius.circular(out ? 16 : 4),
                  bottomRight: Radius.circular(out ? 4 : 16),
                ),
              ),
              child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
                if (message.type == 'template')
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: Row(mainAxisSize: MainAxisSize.min, children: [
                        Icon(LucideIcons.fileText, size: 12, color: c.accentSoftFg),
                        const SizedBox(width: 4),
                        Text('Template', style: context.text.labelSmall!.copyWith(color: c.accentSoftFg)),
                      ]),
                    ),
                  ),
                Align(alignment: Alignment.centerLeft, child: Text(message.body ?? '', style: context.text.bodyLarge!.copyWith(color: fg))),
                const SizedBox(height: 2),
                Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(formatTime(message.createdAt, tz), style: context.text.labelSmall),
                  if (out) ...[const SizedBox(width: 4), _Ticks(status: message.status)],
                ]),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}

class _Ticks extends StatelessWidget {
  const _Ticks({required this.status});
  final String status;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return AnimatedSwitcher(
      duration: VMotion.of(context, VMotion.fast),
      child: switch (status) {
        'queued' => Icon(LucideIcons.clock3, key: const ValueKey('q'), size: 13, color: c.muted),
        'sent' => Icon(LucideIcons.check, key: const ValueKey('s'), size: 14, color: c.muted),
        'delivered' => Icon(LucideIcons.checkCheck, key: const ValueKey('d'), size: 14, color: c.muted),
        'read' => Icon(LucideIcons.checkCheck, key: const ValueKey('r'), size: 14, color: c.tone(Tone.blue).fg),
        'failed' => Icon(LucideIcons.circleAlert, key: const ValueKey('f'), size: 14, color: c.dangerText),
        _ => const SizedBox.shrink(),
      },
    );
  }
}

class _Composer extends StatelessWidget {
  const _Composer({
    required this.controller,
    required this.windowOpen,
    required this.optedOut,
    required this.onChanged,
    required this.onSend,
    required this.onTemplate,
    required this.onQuickReply,
  });

  final TextEditingController controller;
  final bool windowOpen;
  final bool optedOut;
  final VoidCallback onChanged;
  final VoidCallback onSend;
  final VoidCallback? onTemplate;
  final VoidCallback onQuickReply;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    if (optedOut) {
      return const SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.all(VSpace.page),
          child: InfoBanner(icon: LucideIcons.ban, tone: Tone.grey, text: 'This contact opted out of WhatsApp messages. Call them instead.'),
        ),
      );
    }
    return Container(
      decoration: BoxDecoration(color: c.surface, border: Border(top: BorderSide(color: c.border))),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(VSpace.xs, VSpace.sm, VSpace.sm, VSpace.sm),
          child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
            IconAction(icon: LucideIcons.fileText, label: 'Send a template', onPressed: onTemplate),
            if (windowOpen) IconAction(icon: LucideIcons.zap, label: 'Quick replies', onPressed: onQuickReply),
            Expanded(
              child: windowOpen
                  ? TextField(
                      controller: controller,
                      minLines: 1,
                      maxLines: 5,
                      textCapitalization: TextCapitalization.sentences,
                      onChanged: (_) => onChanged(),
                      decoration: InputDecoration(
                        hintText: 'Message',
                        fillColor: c.surface2,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide(color: c.border)),
                        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(22), borderSide: BorderSide(color: c.brand.ring, width: 2)),
                      ),
                    )
                  : OutlinedButton.icon(onPressed: onTemplate, icon: const Icon(LucideIcons.fileText, size: 18), label: const Text('Choose a template')),
            ),
            if (windowOpen) ...[
              const SizedBox(width: VSpace.xs),
              IconButton.filled(
                tooltip: 'Send',
                onPressed: controller.text.trim().isEmpty ? null : onSend,
                style: IconButton.styleFrom(minimumSize: const Size(48, 48), backgroundColor: c.accent, foregroundColor: c.onAccent, disabledBackgroundColor: c.surface3),
                icon: const Icon(LucideIcons.sendHorizontal, size: 20),
              ),
            ],
          ]),
        ),
      ),
    );
  }
}
