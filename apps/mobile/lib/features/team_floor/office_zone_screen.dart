import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../../app/providers.dart';
import '../../app/runtime.dart';
import '../../core/format.dart';
import '../../core/haptics.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../design/design.dart';
import '../../platform/telephony.dart' show isAndroidApp;
import '../common/common.dart';
import '../data.dart';

/// Marker token from a scanned QR code: the raw token, or a link carrying it as `t` or `token`.
String? markerTokenFrom(String? raw) {
  if (raw == null) return null;
  final v = raw.trim();
  final uri = Uri.tryParse(v);
  final fromLink = uri != null && uri.hasScheme ? (uri.queryParameters['t'] ?? uri.queryParameters['token'] ?? (uri.pathSegments.isNotEmpty ? uri.pathSegments.last : null)) : null;
  final token = fromLink ?? v;
  return token.length >= 16 && token.length <= 300 ? token : null;
}

/// "Where am I in the office" (SPEC 29.11): the room the server has for me, with its source and
/// confidence; scan a door or desk QR code (exact), or pick the room by hand. Automatic beacon and
/// Wi-Fi detection is switched on in Preferences.
class OfficeZoneScreen extends ConsumerStatefulWidget {
  const OfficeZoneScreen({super.key});

  @override
  ConsumerState<OfficeZoneScreen> createState() => _OfficeZoneScreenState();
}

class _OfficeZoneScreenState extends ConsumerState<OfficeZoneScreen> {
  bool _sending = false;

  Future<void> _send(ZoneSignal signal, String done) async {
    setState(() => _sending = true);
    try {
      final rt = ref.read(runtimeProvider);
      final MyPresence p;
      if (rt != null) {
        p = await rt.sendZone(signal);
      } else {
        p = await ref.read(presenceRepositoryProvider).zone(signal);
        ref.read(myPresenceProvider.notifier).applyZone(p.location);
      }
      ref.read(myPresenceProvider.notifier).applyZone(p.location);
      await Haptics.success();
      if (mounted) showToast(context, p.location?.zoneName == null ? done : '$done: ${p.location!.zoneName}');
    } catch (e) {
      if (mounted) showToast(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _scan() async {
    final raw = await Navigator.of(context).push<String>(MaterialPageRoute(fullscreenDialog: true, builder: (_) => const QrScanPage()));
    final token = markerTokenFrom(raw);
    if (raw == null) return;
    if (token == null) {
      if (mounted) showToast(context, 'This QR code is not a Vistar room marker.', error: true);
      return;
    }
    await _send(ZoneSignal(source: 'qr', at: ref.read(clockProvider)().toUtc(), markerToken: token), 'Room set');
  }

  Future<void> _pick(FloorPlan plan) async {
    final picked = await showVSheet<FloorZone>(
      context,
      title: 'Which room are you in?',
      subtitle: 'Your team sees this on the Team Floor until another signal moves you.',
      builder: (ctx) => Column(mainAxisSize: MainAxisSize.min, children: [
        for (final z in plan.zones)
          ListTile(
            leading: Icon(_zoneIcon(z.kind), size: 20),
            title: Text(z.label),
            onTap: () => Navigator.of(ctx).pop(z),
          ),
      ]),
    );
    if (picked == null) return;
    await _send(ZoneSignal(source: 'manual', at: ref.read(clockProvider)().toUtc(), zoneId: picked.id), 'Room set');
  }

  @override
  Widget build(BuildContext context) {
    final presence = ref.watch(myPresenceProvider);
    final plan = ref.watch(floorPlanProvider).value;
    final auto = ref.watch(prefsProvider.select((p) => p.zoneDetection));
    final now = ref.watch(clockProvider)().toUtc();
    final z = presence.location;
    final c = context.colors;
    return VPage(
      title: 'My room',
      subtitle: 'Where you are in the office',
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
          sliver: SliverList.list(children: [
            if (!isAndroidApp) ...[const AndroidOnlyNote(feature: 'QR scanning and room beacons'), const SizedBox(height: VSpace.md)],
            VCard(
              child: Row(children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(color: z?.zoneId == null ? c.surface3 : c.accentSoft, borderRadius: BorderRadius.circular(14)),
                  child: Icon(z?.zoneId == null ? LucideIcons.mapPinOff : LucideIcons.mapPinned, color: z?.zoneId == null ? c.muted : c.accentSoftFg),
                ),
                const SizedBox(width: VSpace.md),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(z?.zoneName ?? (z?.zoneId == null ? 'Room not known' : z!.zoneId!), style: context.text.titleMedium),
                    Text(
                      z?.zoneId == null
                          ? 'Scan the QR code at a door or desk, or pick the room.'
                          : '${z!.sourceLabel} · ${z.confidenceLabel} confidence${z.at == null ? '' : ' · ${timeAgo(z.at!, now)}'}',
                      style: context.text.bodySmall!.copyWith(color: c.mutedStrong),
                    ),
                  ]),
                ),
              ]),
            ),
            const SizedBox(height: VSpace.md),
            FilledButton.icon(
              onPressed: _sending || !isAndroidApp ? null : _scan,
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
              icon: const Icon(LucideIcons.scanLine, size: 18),
              label: const Text('Scan a door or desk QR code'),
            ),
            const SizedBox(height: VSpace.sm),
            OutlinedButton.icon(
              // The server accepts zones of the published floor (or zones with markers); the default
              // template has none, so picking needs the company's custom floor.
              onPressed: _sending || plan == null || !plan.isPublished || plan.zones.isEmpty ? null : () => _pick(plan),
              style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
              icon: const Icon(LucideIcons.listChecks, size: 18),
              label: const Text('Pick the room by hand'),
            ),
            if (plan != null && !plan.isPublished) ...[
              const SizedBox(height: VSpace.xs),
              Text('Picking a room works once your company\'s own floor is published. QR codes work as soon as your admin prints them.', style: context.text.bodySmall!.copyWith(color: c.mutedStrong), textAlign: TextAlign.center),
            ],
            const SizedBox(height: VSpace.lg),
            SectionCard(
              title: 'Automatic detection',
              icon: LucideIcons.radar,
              trailing: TextButton(onPressed: () => context.push('/preferences'), child: Text(auto ? 'On' : 'Turn on')),
              padding: const EdgeInsets.fromLTRB(VSpace.lg, 0, VSpace.lg, VSpace.lg),
              child: Text(
                'With detection on, the app listens for room beacons and the office Wi-Fi once a minute during working hours. '
                'Beacons place you in a room; Wi-Fi tells the office from outside. The server only moves you after a steady signal, '
                'so one weak reading does not jump you between rooms.',
                style: context.text.bodyMedium,
              ),
            ),
          ]),
        ),
      ],
    );
  }
}

IconData _zoneIcon(String kind) => switch (kind) {
      'cabin' => LucideIcons.doorClosed,
      'meeting' => LucideIcons.presentation,
      'reception' => LucideIcons.conciergeBell,
      'pantry' => LucideIcons.coffee,
      _ => LucideIcons.layoutGrid,
    };

/// Full-screen camera that returns the first QR code it reads.
class QrScanPage extends StatefulWidget {
  const QrScanPage({super.key});

  @override
  State<QrScanPage> createState() => _QrScanPageState();
}

class _QrScanPageState extends State<QrScanPage> {
  final _controller = MobileScannerController(formats: const [BarcodeFormat.qrCode], detectionSpeed: DetectionSpeed.noDuplicates);
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Scan room QR code'),
        actions: [
          IconButton(tooltip: 'Torch', icon: const Icon(LucideIcons.flashlight), onPressed: () => _controller.toggleTorch()),
        ],
      ),
      body: Stack(children: [
        MobileScanner(
          controller: _controller,
          onDetect: (capture) {
            if (_done) return;
            final raw = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
            if (raw == null) return;
            _done = true;
            Navigator.of(context).pop(raw);
          },
          errorBuilder: (context, error) => Center(
            child: Padding(
              padding: const EdgeInsets.all(VSpace.xxl),
              child: Text('The camera is not available: ${error.errorCode.name}. Allow camera access for Vistar.', style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
            ),
          ),
        ),
        IgnorePointer(
          child: Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(24)),
            ),
          ),
        ),
        const Positioned(
          left: VSpace.xl,
          right: VSpace.xl,
          bottom: 48,
          child: Text('Point the camera at the Vistar code at the room door or on the desk.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 15)),
        ),
      ]),
    );
  }
}
