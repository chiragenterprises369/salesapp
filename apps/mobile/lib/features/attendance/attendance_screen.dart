import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/providers.dart';
import '../../app/runtime.dart';
import '../../core/format.dart';
import '../../core/haptics.dart';
import '../../core/time/working_hours.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../design/design.dart';
import '../../platform/location.dart';
import '../common/common.dart';
import '../data.dart';

/// Attendance and GPS for field staff (D-063): consent before first use, check-in and check-out
/// with location, today's sessions and a small map of today's trail. Location is shared only while
/// checked in and inside working hours.
class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key});

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  bool _busy = false;

  Future<void> _check(bool checkIn) async {
    setState(() => _busy = true);
    final loc = ref.read(locationProvider);
    try {
      final access = await loc.access(request: true);
      LocationFix? fix;
      if (access == LocationAccess.granted) fix = await loc.current();
      if (!mounted) return;
      if (fix == null) {
        final go = await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            title: const Text('Location not available'),
            content: Text(access == LocationAccess.serviceOff
                ? 'Turn on location (GPS) to attach your position.'
                : 'Allow location for Vistar to attach your position. You can still ${checkIn ? 'check in' : 'check out'} without it.'),
            actions: [
              TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
              FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(checkIn ? 'Check in anyway' : 'Check out anyway')),
            ],
          ),
        );
        if (go != true) return;
      }
      final repo = ref.read(attendanceRepositoryProvider);
      await (checkIn ? repo.checkIn(fix) : repo.checkOut(fix));
      await Haptics.success();
      ref.invalidate(attendanceProvider);
      if (mounted) showToast(context, checkIn ? 'Checked in. Have a good day.' : 'Checked out.');
    } on OutsideWorkingHours {
      if (mounted) showToast(context, 'Outside working hours. Check-in opens when your working hours start.', error: true);
    } catch (e) {
      if (mounted) showToast(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final day = ref.watch(attendanceProvider);
    final me = ref.watch(meProvider);
    final now = ref.watch(clockProvider)().toUtc();
    final tz = timezoneOf(ref);
    final consentLocal = ref.watch(prefsProvider.select((p) => p.locationConsent));
    final loc = ref.watch(locationProvider);
    final hours = me == null ? null : WorkingHours.forMe(me);
    return VPage(
      title: 'Attendance',
      subtitle: formatDay(now, tz),
      onRefresh: () async => ref.invalidate(attendanceProvider),
      slivers: [
        AsyncSliver<AttendanceDay>(
          value: day,
          errorTitle: 'Attendance did not load',
          onRetry: () => ref.invalidate(attendanceProvider),
          data: (d) {
            if (!d.fieldStaff && !(me?.user.isFieldStaff ?? false)) {
              return const SliverToBoxAdapter(
                child: EmptyState(icon: LucideIcons.mapPinOff, title: 'Attendance is for field staff', message: 'Ask your company admin to mark you as field staff to use check-in and GPS.'),
              );
            }
            if (!d.consentGiven && !consentLocal) {
              return SliverPadding(padding: const EdgeInsets.all(VSpace.page), sliver: SliverToBoxAdapter(child: _Consent(hoursLabel: hours?.todayLabel(now))));
            }
            final within = hours?.isWithin(now) ?? true;
            final open = d.openSession;
            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
              sliver: SliverList.list(children: [
                if (!loc.canTrack) ...[const AndroidOnlyNote(feature: 'Background GPS during field visits'), const SizedBox(height: VSpace.md)],
                VCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Row(children: [
                      Container(
                        width: 44,
                        height: 44,
                        decoration: BoxDecoration(color: context.colors.tone(open != null ? Tone.green : Tone.grey).bg, borderRadius: BorderRadius.circular(13)),
                        child: Icon(open != null ? LucideIcons.mapPinCheck : LucideIcons.mapPin, color: context.colors.tone(open != null ? Tone.green : Tone.grey).fg),
                      ),
                      const SizedBox(width: VSpace.md),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(open != null ? 'Checked in since ${formatTime(open.checkInAt, tz)}' : 'Not checked in', style: context.text.titleMedium),
                          Text(
                            within ? 'Working hours today: ${hours?.todayLabel(now) ?? 'not set'}' : 'Outside working hours. Tracking is off.',
                            style: context.text.bodySmall!.copyWith(color: context.colors.mutedStrong),
                          ),
                        ]),
                      ),
                    ]),
                    const SizedBox(height: VSpace.lg),
                    Row(children: [
                      Expanded(child: _Metric(label: 'Today', value: formatSpan(d.total(now)))),
                      Expanded(child: _Metric(label: 'Sessions', value: '${d.sessions.length}')),
                      Expanded(child: _Metric(label: 'Points', value: '${d.trail.length}')),
                    ]),
                    const SizedBox(height: VSpace.lg),
                    FilledButton.icon(
                      onPressed: _busy ? null : () => _check(open == null),
                      style: FilledButton.styleFrom(
                        minimumSize: const Size.fromHeight(52),
                        backgroundColor: open == null ? null : context.colors.surface3,
                        foregroundColor: open == null ? null : context.colors.fg,
                      ),
                      icon: _busy
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : Icon(open == null ? LucideIcons.logIn : LucideIcons.logOut, size: 18),
                      label: Text(open == null ? 'Check in' : 'Check out'),
                    ),
                    if (open != null && within) ...[
                      const SizedBox(height: VSpace.sm),
                      Text(
                        'Your location is shared with your company while you are checked in, until ${hours?.currentSlotEnd(now) == null ? 'the end of working hours' : formatTime(hours!.currentSlotEnd(now)!, tz)}.',
                        style: context.text.bodySmall!.copyWith(color: context.colors.mutedStrong),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ]),
                ),
                const SizedBox(height: VSpace.md),
                SectionCard(
                  title: 'Today\'s route',
                  icon: LucideIcons.route,
                  trailing: d.trail.isEmpty
                      ? null
                      : TextButton.icon(
                          onPressed: () => launchUrl(Uri.parse('https://www.google.com/maps/search/?api=1&query=${d.trail.last.lat},${d.trail.last.lng}'), mode: LaunchMode.externalApplication),
                          icon: const Icon(LucideIcons.externalLink, size: 15),
                          label: const Text('Open map'),
                        ),
                  padding: const EdgeInsets.fromLTRB(VSpace.md, 0, VSpace.md, VSpace.md),
                  child: d.trail.isEmpty
                      ? const EmptyState(compact: true, icon: LucideIcons.route, title: 'No points yet', message: 'Your route appears here after you check in.')
                      : SizedBox(height: 180, child: TrailMap(points: d.trail)),
                ),
                const SizedBox(height: VSpace.md),
                SectionCard(
                  title: 'Sessions',
                  icon: LucideIcons.clock,
                  count: d.sessions.length,
                  child: d.sessions.isEmpty
                      ? const EmptyState(compact: true, icon: LucideIcons.clock, title: 'No sessions today', message: 'Check in when you start your field day.')
                      : Column(children: [
                          for (final s in d.sessions.reversed)
                            VListTile(
                              leading: Icon(s.open ? LucideIcons.circleDot : LucideIcons.circleCheck, size: 18, color: s.open ? context.colors.successText : context.colors.muted),
                              title: '${formatTime(s.checkInAt, tz)} to ${s.checkOutAt == null ? 'now' : formatTime(s.checkOutAt!, tz)}',
                              subtitle: s.address,
                              trailing: Text(formatSpan(s.duration(now)), style: context.text.labelLarge!.copyWith(fontFeatures: tabular)),
                            ),
                        ]),
                ),
              ]),
            );
          },
        ),
      ],
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => MergeSemantics(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: context.text.labelMedium!.copyWith(color: context.colors.mutedStrong)),
          Text(value, style: context.text.titleLarge!.copyWith(fontFeatures: tabular)),
        ]),
      );
}

class _Consent extends ConsumerWidget {
  const _Consent({this.hoursLabel});
  final String? hoursLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.colors;
    Widget point(IconData icon, String text) => Padding(
          padding: const EdgeInsets.only(bottom: VSpace.md),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, size: 18, color: c.accentText),
            const SizedBox(width: VSpace.md),
            Expanded(child: Text(text, style: context.text.bodyMedium)),
          ]),
        );
    return VCard(
      padding: const EdgeInsets.all(VSpace.xl),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Container(
          width: 52,
          height: 52,
          decoration: BoxDecoration(color: c.accentSoft, borderRadius: BorderRadius.circular(16)),
          child: Icon(LucideIcons.shieldCheck, color: c.accentSoftFg),
        ),
        const SizedBox(height: VSpace.lg),
        Text('Location for field visits', style: context.text.headlineSmall),
        const SizedBox(height: VSpace.sm),
        Text('Before you start, here is exactly what Vistar shares with your company:', style: context.text.bodyMedium!.copyWith(color: c.mutedStrong)),
        const SizedBox(height: VSpace.lg),
        point(LucideIcons.mapPin, 'Your location at check-in and check-out, and your route while you are checked in.'),
        point(LucideIcons.clock, 'Only inside your working hours${hoursLabel == null ? '' : ' ($hoursLabel today)'}. Tracking stops when you check out or the working day ends.'),
        point(LucideIcons.bell, 'A notification is always shown while location is shared.'),
        point(LucideIcons.lock, 'Your company sees it; nobody else. You can withdraw consent with your admin at any time.'),
        const SizedBox(height: VSpace.sm),
        FilledButton(
          onPressed: () async {
            try {
              await ref.read(attendanceRepositoryProvider).giveConsent();
            } catch (_) {
              // Recorded locally; sent again with the first check-in.
            }
            await ref.read(prefsProvider.notifier).setLocationConsent(true);
            ref.invalidate(attendanceProvider);
            ref.read(runtimeProvider);
          },
          child: const Text('I agree, continue'),
        ),
        const SizedBox(height: VSpace.sm),
        TextButton(onPressed: () => Navigator.of(context).maybePop(), child: const Text('Not now')),
      ]),
    );
  }
}

/// Schematic map of today's trail (no map tiles): normalised polyline with start and current pins.
class TrailMap extends StatelessWidget {
  const TrailMap({super.key, required this.points});
  final List<LocationFix> points;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Route with ${points.length} points. Open map shows the latest position.',
      child: ClipRRect(borderRadius: BorderRadius.circular(VRadius.md), child: CustomPaint(painter: _TrailPainter(points, context.colors), size: Size.infinite)),
    );
  }
}

class _TrailPainter extends CustomPainter {
  _TrailPainter(this.points, this.c);
  final List<LocationFix> points;
  final VColors c;

  @override
  void paint(Canvas canvas, Size size) {
    canvas.drawRect(Offset.zero & size, Paint()..color = c.dark ? const Color(0xFF141821) : const Color(0xFFF1F5F9));
    final grid = Paint()
      ..color = c.chartGrid
      ..strokeWidth = 1;
    for (var x = 0.0; x < size.width; x += 28) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), grid);
    }
    for (var y = 0.0; y < size.height; y += 28) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }
    if (points.isEmpty) return;
    var minLat = points.first.lat, maxLat = minLat, minLng = points.first.lng, maxLng = minLng;
    for (final p in points) {
      minLat = math.min(minLat, p.lat);
      maxLat = math.max(maxLat, p.lat);
      minLng = math.min(minLng, p.lng);
      maxLng = math.max(maxLng, p.lng);
    }
    final spanLat = math.max(maxLat - minLat, 0.002);
    final spanLng = math.max(maxLng - minLng, 0.002);
    const pad = 24.0;
    Offset map(LocationFix p) => Offset(
          pad + (p.lng - minLng) / spanLng * (size.width - pad * 2),
          size.height - pad - (p.lat - minLat) / spanLat * (size.height - pad * 2),
        );
    final path = Path()..moveTo(map(points.first).dx, map(points.first).dy);
    for (final p in points.skip(1)) {
      path.lineTo(map(p).dx, map(p).dy);
    }
    canvas.drawPath(
      path,
      Paint()
        ..color = c.accent
        ..style = PaintingStyle.stroke
        ..strokeWidth = 3
        ..strokeJoin = StrokeJoin.round
        ..strokeCap = StrokeCap.round,
    );
    canvas.drawCircle(map(points.first), 6, Paint()..color = c.success);
    canvas.drawCircle(map(points.last), 9, Paint()..color = c.accent.withValues(alpha: 0.25));
    canvas.drawCircle(map(points.last), 5, Paint()..color = c.accent);
  }

  @override
  bool shouldRepaint(_TrailPainter old) => old.points.length != points.length || old.c != c;
}
