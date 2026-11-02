import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:permission_handler/permission_handler.dart';

import '../../app/providers.dart';
import '../../app/runtime.dart';
import '../../design/design.dart';
import '../../platform/telephony.dart';

/// Permission rationale for SIM calling (D-057). Each permission says why it is needed and what
/// still works without it (graceful degradation).
class CallSetupScreen extends ConsumerStatefulWidget {
  const CallSetupScreen({super.key});

  @override
  ConsumerState<CallSetupScreen> createState() => _CallSetupScreenState();
}

class _CallSetupScreenState extends ConsumerState<CallSetupScreen> with WidgetsBindingObserver {
  TelephonyCapabilities? _caps;
  bool _notifications = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _reload();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _reload();
  }

  Future<void> _reload() async {
    final tel = ref.read(telephonyProvider);
    final caps = await tel.capabilities();
    var n = false;
    if (tel.supported) {
      try {
        n = await Permission.notification.isGranted;
      } catch (_) {}
    }
    if (mounted) {
      setState(() {
        _caps = caps;
        _notifications = n;
      });
    }
  }

  Future<void> _request(Permission p) async {
    final s = await p.request();
    if (s.isPermanentlyDenied) await openAppSettings();
    await _reload();
    await ref.read(runtimeProvider)?.refreshCallTracking();
  }

  Future<void> _battery() async {
    await ref.read(telephonyProvider).requestBatteryExemption();
    await Future<void>.delayed(const Duration(milliseconds: 600));
    await _reload();
  }

  @override
  Widget build(BuildContext context) {
    final caps = _caps;
    final tel = ref.watch(telephonyProvider);
    final audio = (caps?.sdkInt ?? 33) >= 33 ? Permission.audio : Permission.storage;
    return VPage(
      title: 'Set up calling',
      subtitle: 'Call from your own SIM, logged automatically',
      showBack: true,
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
          sliver: SliverList.list(children: [
            if (!tel.supported) ...[
              const AndroidOnlyNote(feature: 'SIM calling, call tracking and recordings'),
              const SizedBox(height: VSpace.md),
            ],
            Text(
              'Vistar uses your phone\'s dialer and SIM. It reports when a work call starts and ends during working hours, '
              'reads the call log for the exact duration, and uploads the phone\'s own recording if your phone records calls. '
              'Vistar never records audio itself.',
              style: context.text.bodyMedium,
            ),
            const SizedBox(height: VSpace.lg),
            _PermissionCard(
              icon: LucideIcons.phone,
              title: 'Phone and call log',
              why: 'Place calls from your SIM, show you as On call, and log exact durations.',
              without: 'Without it the dialer opens with the number filled in, and calls are not logged automatically.',
              granted: caps?.fullCallTracking ?? false,
              onAllow: tel.supported ? () => _request(Permission.phone) : null,
            ),
            _PermissionCard(
              icon: LucideIcons.fileAudio,
              title: 'Call recordings',
              why: 'Attach the recording your phone makes to the call (Samsung, Xiaomi, Realme, Oppo, OnePlus, Vivo, Motorola and Google dialers).',
              without: 'Without it calls are still logged, just without the recording.',
              granted: caps?.readAudio ?? false,
              onAllow: tel.supported ? () => _request(audio) : null,
            ),
            _PermissionCard(
              icon: LucideIcons.bell,
              title: 'Notifications',
              why: 'New leads, due tasks and WhatsApp replies, plus the "tracking work calls" notice.',
              without: 'Without it you see updates only when the app is open.',
              granted: _notifications,
              onAllow: tel.supported ? () => _request(Permission.notification) : null,
            ),
            _PermissionCard(
              icon: LucideIcons.batteryCharging,
              title: 'Run in the background',
              why: 'Keeps call tracking alive when the screen is off. Tracking runs only in working hours.',
              without: 'Without it some phones stop tracking after a few minutes in the background.',
              granted: caps?.batteryExempt ?? false,
              onAllow: tel.supported ? _battery : null,
            ),
            const SizedBox(height: VSpace.md),
            FilledButton(
              onPressed: () async {
                await ref.read(prefsProvider.notifier).setCallSetupDone(true);
                await ref.read(runtimeProvider)?.refreshCallTracking();
                if (context.mounted && Navigator.of(context).canPop()) Navigator.of(context).pop();
              },
              child: const Text('Done'),
            ),
          ]),
        ),
      ],
    );
  }
}

class _PermissionCard extends StatelessWidget {
  const _PermissionCard({required this.icon, required this.title, required this.why, required this.without, required this.granted, required this.onAllow});
  final IconData icon;
  final String title;
  final String why;
  final String without;
  final bool granted;
  final VoidCallback? onAllow;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = c.tone(granted ? Tone.green : Tone.neutral);
    return Padding(
      padding: const EdgeInsets.only(bottom: VSpace.md),
      child: VCard(
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(12), border: Border.all(color: t.border)),
            child: Icon(granted ? LucideIcons.check : icon, size: 19, color: t.fg),
          ),
          const SizedBox(width: VSpace.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(title, style: context.text.titleSmall)),
                if (granted) const VChip('Allowed', tone: Tone.green),
              ]),
              const SizedBox(height: 4),
              Text(why, style: context.text.bodyMedium),
              const SizedBox(height: 4),
              Text(without, style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
              if (!granted && onAllow != null) ...[
                const SizedBox(height: VSpace.sm),
                OutlinedButton(onPressed: onAllow, child: const Text('Allow')),
              ],
            ]),
          ),
        ]),
      ),
    );
  }
}
