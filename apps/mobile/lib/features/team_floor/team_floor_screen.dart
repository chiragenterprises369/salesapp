import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../common/common.dart';
import '../data.dart';

/// Team Floor (read-only, flat): the published seat map of the company's custom floor (made from
/// the Super Admin's uploaded AI-made file, SPEC 29.5) or the default template, with live status
/// from the server snapshot and realtime events; plus a people list. The 3D floor stays on the web.
class TeamFloorScreen extends ConsumerStatefulWidget {
  const TeamFloorScreen({super.key});

  @override
  ConsumerState<TeamFloorScreen> createState() => _TeamFloorScreenState();
}

class _TeamFloorScreenState extends ConsumerState<TeamFloorScreen> {
  PresenceStatus? _filter;

  @override
  Widget build(BuildContext context) {
    final snap = ref.watch(teamFloorProvider);
    final plan = ref.watch(floorPlanProvider);
    final live = ref.watch(realtimeConnectedProvider);
    final now = ref.watch(clockProvider)().toUtc();
    final k = snap.value?.kpis;
    return VPage(
      title: 'Team Floor',
      subtitle: k == null ? 'Who is free, on a call or away' : '${k['active'] ?? 0} active · ${k['onCall'] ?? 0} on call · ${k['idle'] ?? 0} available',
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: VSpace.xs),
          child: VChip(live ? 'Live' : 'Reconnecting', tone: live ? Tone.green : Tone.amber, dot: true),
        ),
        IconAction(
          icon: LucideIcons.maximize,
          label: 'Full screen floor',
          onPressed: snap.hasValue && plan.hasValue
              ? () => Navigator.of(context).push(MaterialPageRoute<void>(fullscreenDialog: true, builder: (_) => const _FullScreenFloor()))
              : null,
        ),
      ],
      onRefresh: () async {
        ref.invalidate(teamFloorProvider);
        ref.invalidate(floorPlanProvider);
      },
      slivers: [
        AsyncSliver<TeamFloorSnapshot>(
          value: snap,
          errorTitle: 'The floor did not load',
          onRetry: () => ref.invalidate(teamFloorProvider),
          data: (s) {
            final people = _filter == null ? s.people : s.people.where((p) => p.status == _filter).toList();
            final counts = <PresenceStatus, int>{};
            for (final p in s.people) {
              counts[p.status] = (counts[p.status] ?? 0) + 1;
            }
            final present = PresenceStatus.values.where((x) => counts.containsKey(x)).toList();
            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
              sliver: SliverList.list(children: [
                plan.when(
                  loading: () => const Shimmer(child: SkeletonBox(height: 280, radius: 14)),
                  error: (_, _) => const SizedBox.shrink(),
                  data: (pl) => Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    if (!pl.isPublished) ...[
                      InfoBanner(
                        icon: LucideIcons.hammer,
                        tone: Tone.indigo,
                        text: pl.preparing ? 'Your office floor is being prepared. This is the default layout until it is published.' : 'Default floor layout. Your company admin can request a custom floor of your office.',
                      ),
                      const SizedBox(height: VSpace.md),
                    ],
                    VCard(
                      padding: const EdgeInsets.all(VSpace.sm),
                      child: FloorPlanView(plan: pl, people: s.people, onPerson: (p) => showPersonSheet(context, p, now)),
                    ),
                  ]),
                ),
                const SizedBox(height: VSpace.md),
                SizedBox(
                  height: 48,
                  child: ListView(scrollDirection: Axis.horizontal, children: [
                    _StatusFilter(label: 'Everyone', count: s.people.length, selected: _filter == null, onTap: () => setState(() => _filter = null)),
                    for (final st in present)
                      _StatusFilter(label: st.label, count: counts[st]!, tone: toneForStatus(st), selected: _filter == st, onTap: () => setState(() => _filter = st)),
                  ]),
                ),
                const SizedBox(height: VSpace.sm),
                VCard(
                  padding: const EdgeInsets.symmetric(vertical: VSpace.xs),
                  child: people.isEmpty
                      ? const EmptyState(compact: true, icon: LucideIcons.users, title: 'Nobody here', message: 'No one has this status right now.')
                      : Column(children: [
                          for (var i = 0; i < people.length; i++) ...[
                            if (i > 0) Divider(indent: 68, color: context.colors.border),
                            _PersonRow(person: people[i], now: now, onTap: () => showPersonSheet(context, people[i], now)),
                          ],
                        ]),
                ),
                const SizedBox(height: VSpace.md),
                Text(
                  'Status comes from the app and web (heartbeats), phone calls, attendance and what people set themselves. '
                  'Offline means no heartbeat for 45 seconds. On call starts when dialing; the talk time comes from the call log.',
                  style: context.text.bodySmall!.copyWith(color: context.colors.mutedStrong),
                ),
              ]),
            );
          },
        ),
      ],
    );
  }
}

class _StatusFilter extends StatelessWidget {
  const _StatusFilter({required this.label, required this.count, required this.selected, required this.onTap, this.tone});
  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  final Tone? tone;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.only(right: VSpace.sm),
      child: ChoiceChip(
        selected: selected,
        onSelected: (_) => onTap(),
        showCheckmark: false,
        avatar: tone == null ? null : Container(width: 8, height: 8, decoration: BoxDecoration(color: c.tone(tone!).fg, shape: BoxShape.circle)),
        label: Text('$label $count'),
        selectedColor: c.accentSoft,
        labelStyle: context.text.labelLarge!.copyWith(color: selected ? c.accentSoftFg : c.fgSecondary),
        side: BorderSide(color: selected ? c.accentSoftFg.withValues(alpha: 0.35) : c.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(VRadius.pill)),
      ),
    );
  }
}

class _PersonRow extends StatelessWidget {
  const _PersonRow({required this.person, required this.now, required this.onTap});
  final FloorPerson person;
  final DateTime now;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final p = person;
    final detail = switch (p.status) {
      PresenceStatus.onCall => [if (p.currentLeadName != null) 'With ${p.currentLeadName}', if (p.activeCallStartedAt != null) formatSpan(now.difference(p.activeCallStartedAt!))].join(' · '),
      PresenceStatus.offline => p.lastSeenAt == null ? 'Not seen today' : 'Last seen ${timeAgo(p.lastSeenAt!, now)}',
      _ => '${p.callsToday} calls today',
    };
    return VListTile(
      onTap: onTap,
      semanticLabel: '${p.user.name}, ${p.status.label}. $detail',
      leading: VAvatar(name: p.user.name, size: 40, status: p.status),
      title: p.user.name,
      subtitle: detail,
      trailing: Padding(padding: const EdgeInsets.only(right: VSpace.xs), child: StatusPill(p.status)),
    );
  }
}

void showPersonSheet(BuildContext context, FloorPerson p, DateTime now) {
  showVSheet<void>(
    context,
    title: p.user.name,
    subtitle: p.status == PresenceStatus.onCall && p.activeCallStartedAt != null ? 'On call for ${formatSpan(now.difference(p.activeCallStartedAt!))}' : p.status.label,
    builder: (ctx) => Padding(
      padding: const EdgeInsets.fromLTRB(VSpace.xl, 0, VSpace.xl, VSpace.sm),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, mainAxisSize: MainAxisSize.min, children: [
        Row(children: [
          VAvatar(name: p.user.name, size: 52, status: p.status),
          const SizedBox(width: VSpace.md),
          StatusPill(p.status, large: true),
        ]),
        const SizedBox(height: VSpace.lg),
        Row(children: [
          Expanded(child: KpiTile(label: 'Calls today', value: p.callsToday, format: (v) => '${v.round()}', icon: LucideIcons.phone, tone: Tone.blue)),
          const SizedBox(width: VSpace.md),
          Expanded(child: KpiTile(label: 'Avg talk', value: p.avgTalkSec, format: (v) => formatDuration(v.round()), icon: LucideIcons.timer)),
        ]),
        if (p.currentLeadName != null) ...[
          const SizedBox(height: VSpace.md),
          InfoBanner(icon: LucideIcons.user, tone: Tone.blue, text: 'Working on ${p.currentLeadName}'),
        ],
        if (p.targetPct != null) ...[
          const SizedBox(height: VSpace.md),
          Text('Monthly target ${p.targetPct!.round()}%', style: ctx.text.labelLarge),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(value: (p.targetPct! / 100).clamp(0, 1), minHeight: 8),
          ),
        ],
      ]),
    ),
  );
}

/// Flat plan: zones as soft rooms, seats as avatars with status rings. Seat i takes the person
/// with deskIndex i (or the seat's userId on a published floor). Tap a person for details.
class FloorPlanView extends StatelessWidget {
  const FloorPlanView({super.key, required this.plan, required this.people, required this.onPerson, this.maxHeight});
  final FloorPlan plan;
  final List<FloorPerson> people;
  final ValueChanged<FloorPerson> onPerson;
  final double? maxHeight;

  static const zoneTones = {
    'work': Tone.neutral,
    'cabin': Tone.indigo,
    'meeting': Tone.blue,
    'reception': Tone.green,
    'pantry': Tone.amber,
    'lounge': Tone.amber,
  };

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return LayoutBuilder(builder: (context, box) {
      var w = box.maxWidth;
      var h = w / plan.aspect;
      if (maxHeight != null && h > maxHeight!) {
        h = maxHeight!;
        w = h * plan.aspect;
      }
      final avatar = (w / 11).clamp(26.0, 44.0);
      final byUser = {for (final p in people) p.user.id: p};
      final byDesk = {for (final p in people) p.deskIndex: p};
      return Center(
        child: SizedBox(
          width: w,
          height: h,
          child: Semantics(
            label: '${plan.name} floor plan with ${people.length} people. The list below has everyone and their status.',
            child: Stack(children: [
              Positioned.fill(child: CustomPaint(painter: _FloorPainter(plan: plan, colors: c))),
              for (final z in plan.zones)
                Positioned(
                  left: z.x * w + 8,
                  top: z.y * h + 6,
                  child: ExcludeSemantics(
                    child: Text(
                      z.label,
                      textScaler: TextScaler.noScaling,
                      style: context.text.labelSmall!.copyWith(color: c.tone(zoneTones[z.kind] ?? Tone.neutral).fg, fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
              for (final seat in plan.seats)
                Builder(builder: (context) {
                  final person = seat.userId != null ? byUser[seat.userId] : byDesk[seat.index];
                  final size = person == null ? avatar * 0.5 : avatar;
                  return AnimatedPositioned(
                    duration: VMotion.of(context, VMotion.slow),
                    left: seat.x * w - size / 2 - 3,
                    top: seat.y * h - size / 2 - 3,
                    child: person == null
                        ? ExcludeSemantics(
                            child: Container(
                              width: size,
                              height: size,
                              decoration: BoxDecoration(shape: BoxShape.circle, color: c.surface, border: Border.all(color: c.borderStrong, width: 1.2)),
                            ),
                          )
                        : Semantics(
                            button: true,
                            label: '${person.user.name}, ${person.status.label}',
                            child: GestureDetector(
                              onTap: () => onPerson(person),
                              child: Tooltip(message: '${person.user.name} · ${person.status.label}', child: VAvatar(name: person.user.name, size: size, status: person.status)),
                            ),
                          ),
                  );
                }),
            ]),
          ),
        ),
      );
    });
  }
}

class _FloorPainter extends CustomPainter {
  _FloorPainter({required this.plan, required this.colors});
  final FloorPlan plan;
  final VColors colors;

  @override
  void paint(Canvas canvas, Size size) {
    final c = colors;
    final floor = RRect.fromRectAndRadius(Offset.zero & size, const Radius.circular(10));
    canvas.drawRRect(floor, Paint()..color = c.dark ? const Color(0xFF13161C) : const Color(0xFFF8FAFC));
    // Subtle grid.
    final grid = Paint()
      ..color = c.chartGrid
      ..strokeWidth = 1;
    for (var x = 0.0; x < size.width; x += size.width / 20) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), grid);
    }
    for (var y = 0.0; y < size.height; y += size.width / 20) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), grid);
    }
    for (final z in plan.zones) {
      final t = c.tone(FloorPlanView.zoneTones[z.kind] ?? Tone.neutral);
      final r = RRect.fromRectAndRadius(Rect.fromLTWH(z.x * size.width, z.y * size.height, z.w * size.width, z.h * size.height), const Radius.circular(8));
      canvas.drawRRect(r, Paint()..color = z.kind == 'work' ? c.surface : t.bg);
      canvas.drawRRect(
        r,
        Paint()
          ..color = z.kind == 'work' ? c.border : t.border
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.2,
      );
    }
    // Desks under the work-area seats.
    final desk = Paint()..color = c.dark ? c.surface3 : const Color(0xFFEEF1F5);
    for (final s in plan.seats.where((s) => s.zoneId == 'work' || s.zoneId == null)) {
      canvas.drawRRect(
        RRect.fromRectAndRadius(Rect.fromCenter(center: Offset(s.x * size.width, s.y * size.height + size.height * 0.055), width: size.width * 0.1, height: size.height * 0.035), const Radius.circular(3)),
        desk,
      );
    }
  }

  @override
  bool shouldRepaint(_FloorPainter old) => old.plan != plan || old.colors != colors;
}

/// Full-screen floor (immersive on Android) for watching the team while working.
class _FullScreenFloor extends ConsumerStatefulWidget {
  const _FullScreenFloor();

  @override
  ConsumerState<_FullScreenFloor> createState() => _FullScreenFloorState();
}

class _FullScreenFloorState extends ConsumerState<_FullScreenFloor> {
  @override
  void initState() {
    super.initState();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }

  @override
  void dispose() {
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final snap = ref.watch(teamFloorProvider).value;
    final plan = ref.watch(floorPlanProvider).value;
    final now = ref.watch(clockProvider)().toUtc();
    final c = context.colors;
    return Scaffold(
      backgroundColor: c.bg,
      body: SafeArea(
        child: Stack(children: [
          if (snap != null && plan != null)
            Positioned.fill(
              child: InteractiveViewer(
                minScale: 1,
                maxScale: 3,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(VSpace.md, 64, VSpace.md, VSpace.md),
                  child: LayoutBuilder(
                    builder: (context, box) => FloorPlanView(plan: plan, people: snap.people, maxHeight: box.maxHeight, onPerson: (p) => showPersonSheet(context, p, now)),
                  ),
                ),
              ),
            ),
          Positioned(
            left: VSpace.sm,
            right: VSpace.sm,
            top: VSpace.xs,
            child: Row(children: [
              IconAction(icon: LucideIcons.minimize, label: 'Exit full screen', onPressed: () => Navigator.of(context).pop()),
              Expanded(child: Text(plan?.name ?? 'Team Floor', style: context.text.titleMedium)),
              if (snap != null) VChip('${snap.kpis['onCall'] ?? 0} on call', tone: Tone.blue, dot: true),
              const SizedBox(width: VSpace.sm),
              if (snap != null) VChip('${snap.kpis['idle'] ?? 0} available', tone: Tone.green, dot: true),
            ]),
          ),
        ]),
      ),
    );
  }
}
