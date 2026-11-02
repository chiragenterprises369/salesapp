import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/providers.dart';
import '../../app/runtime.dart';
import '../../core/calls/call_matching.dart';
import '../../core/format.dart';
import '../../core/haptics.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../../platform/telephony.dart';

/// Tap Call: the phone's own dialer calls from the employee's SIM (D-057). Two SIMs: pick one.
/// No CALL_PHONE permission: the dialer opens with the number filled in. Web preview: Android only.
Future<void> callNumber(BuildContext context, WidgetRef ref, {required String name, required String? phone, String? leadId}) async {
  if (phone == null || phone.isEmpty) {
    showToast(context, 'No phone number for $name.');
    return;
  }
  await Haptics.heavy();
  if (!context.mounted) return;
  if (ref.read(isDemoProvider)) {
    showToast(context, 'Demo mode: no real call is placed. Calling ${formatPhone(phone)} works after you sign in.');
    return;
  }
  final tel = ref.read(telephonyProvider);
  if (!tel.supported) {
    showToast(context, 'Android only: calls are placed from the Vistar app on your phone.');
    return;
  }
  final caps = await tel.capabilities();
  if (!context.mounted) return;
  if (!ref.read(prefsProvider).callSetupDone && !caps.fullCallTracking) {
    // First call: explain the permissions once, then continue.
    await context.push('/call-setup');
    if (!context.mounted) return;
  }
  String? simId;
  final sims = await tel.sims();
  if (!context.mounted) return;
  if (sims.length > 1) {
    simId = await showVSheet<String>(
      context,
      title: 'Call $name',
      subtitle: '${formatPhone(phone)} · choose the SIM',
      builder: (ctx) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final s in sims)
            NavRow(
              icon: LucideIcons.smartphone,
              label: s.label,
              hint: s.number == null ? 'SIM ${s.slot + 1}' : 'SIM ${s.slot + 1} · ${formatPhone(s.number)}',
              onTap: () => Navigator.of(ctx).pop(s.accountId),
            ),
        ],
      ),
    );
    if (simId == null) return;
  }
  ref.read(runtimeProvider)?.callTracker?.expectOutgoing(toE164(phone) ?? phone, leadId: leadId);
  final result = await tel.placeCall(phone, simAccountId: simId);
  if (!context.mounted) return;
  switch (result) {
    case PlaceCallResult.dialer:
      showToast(context, 'The dialer is open. Tap call there; Vistar logs it from the call log.');
    case PlaceCallResult.failed:
      showToast(context, 'The call could not be started. Try again from the dialer.', error: true);
    case PlaceCallResult.placed || PlaceCallResult.unsupported:
      break;
  }
}

/// Opens WhatsApp (app or wa.me) with the number.
Future<void> openWhatsApp(BuildContext context, {required String? phone, String text = ''}) async {
  final digits = (phone ?? '').replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) {
    showToast(context, 'No phone number for WhatsApp.');
    return;
  }
  final uri = Uri.parse('https://wa.me/$digits${text.isEmpty ? '' : '?text=${Uri.encodeComponent(text)}'}');
  final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!ok && context.mounted) showToast(context, 'WhatsApp could not be opened.', error: true);
}

/// Round 48 dp call button for list rows.
class CallButton extends ConsumerWidget {
  const CallButton({super.key, required this.name, required this.phone, this.leadId});
  final String name;
  final String? phone;
  final String? leadId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return IconAction(
      icon: LucideIcons.phone,
      label: 'Call $name',
      filled: true,
      onPressed: phone == null ? null : () => callNumber(context, ref, name: name, phone: phone, leadId: leadId),
    );
  }
}

/// Call a lead whose phone is not in the list payload (tasks): load it first.
Future<void> callLeadById(BuildContext context, WidgetRef ref, {required String leadId, required String name}) async {
  try {
    final lead = await ref.read(leadsRepositoryProvider).get(leadId);
    if (context.mounted) await callNumber(context, ref, name: lead.name, phone: lead.phone, leadId: lead.id);
  } catch (_) {
    if (context.mounted) showToast(context, 'Could not load the number for $name.', error: true);
  }
}

class TaskCallButton extends ConsumerWidget {
  const TaskCallButton({super.key, required this.task});
  final Task task;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final leadId = task.leadId;
    if (leadId == null) return const SizedBox(width: 48);
    final name = task.leadName ?? 'lead';
    return IconAction(
      icon: LucideIcons.phone,
      label: 'Call $name',
      filled: true,
      onPressed: () => task.leadPhone != null
          ? callNumber(context, ref, name: name, phone: task.leadPhone, leadId: leadId)
          : callLeadById(context, ref, leadId: leadId, name: name),
    );
  }
}
