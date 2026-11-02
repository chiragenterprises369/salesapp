import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../data/models.dart';
import '../../data/repositories.dart';
import '../../design/design.dart';
import '../calls/call_actions.dart';
import '../common/common.dart';
import '../data.dart';
import 'lead_widgets.dart';

/// Leads (own scope): search, filters (stage, temperature, source, sort), stage change, quick call
/// and WhatsApp. One card per lead (the Table view on mobile, SPEC 9.5).
class LeadsScreen extends ConsumerStatefulWidget {
  const LeadsScreen({super.key});

  @override
  ConsumerState<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends ConsumerState<LeadsScreen> {
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    super.dispose();
  }

  void _search(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () => ref.read(leadFiltersProvider.notifier).search(q));
  }

  @override
  Widget build(BuildContext context) {
    final leads = ref.watch(leadsProvider);
    final filters = ref.watch(leadFiltersProvider);
    final c = context.colors;
    final total = leads.value?.data.total ?? leads.value?.data.items.length;
    return VPage(
      title: 'Leads',
      subtitle: total == null ? 'Your leads' : '$total ${total == 1 ? 'lead' : 'leads'} assigned to you',
      actions: const [TopActions(showStatus: false)],
      onRefresh: () async {
        ref.invalidate(leadsProvider);
        ref.invalidate(pipelinesProvider);
      },
      bottom: PreferredSize(
        preferredSize: const Size.fromHeight(64),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, 0, VSpace.page, VSpace.sm + 2),
          child: VSearchField(
            hint: 'Search name, company or phone',
            initial: filters.q,
            onChanged: _search,
            trailing: Badge(
              isLabelVisible: filters.activeCount > 0,
              label: Text('${filters.activeCount}'),
              backgroundColor: c.accent,
              child: IconAction(icon: LucideIcons.slidersHorizontal, label: 'Filters', filled: filters.activeCount > 0, onPressed: () => _openFilters(context)),
            ),
          ),
        ),
      ),
      slivers: [
        AsyncSliver<Fetched<Paged<Lead>>>(
          value: leads,
          errorTitle: 'Leads did not load',
          onRetry: () => ref.invalidate(leadsProvider),
          data: (f) {
            final items = f.data.items;
            if (items.isEmpty) {
              return SliverToBoxAdapter(
                child: filters.q.isNotEmpty || filters.activeCount > 0
                    ? EmptyState(
                        icon: LucideIcons.searchX,
                        title: 'No leads match',
                        message: 'Try another search or clear the filters.',
                        action: OutlinedButton(onPressed: () => ref.read(leadFiltersProvider.notifier).set(const LeadFilters()), child: const Text('Clear filters')),
                      )
                    : const EmptyState(icon: LucideIcons.users, title: 'No leads yet', message: 'Leads assigned to you from IndiaMART, the website and WhatsApp appear here.'),
              );
            }
            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.md, VSpace.page, 0),
              sliver: SliverList.separated(
                itemCount: items.length + 1,
                separatorBuilder: (_, _) => const SizedBox(height: VSpace.sm + 2),
                itemBuilder: (context, i) {
                  if (i == 0) return OfflineBanner(fromCache: f.fromCache, savedAt: f.savedAt);
                  final l = items[i - 1];
                  return Reveal(
                    index: i,
                    child: LeadCard(
                      lead: l,
                      onOpen: () => context.push('/leads/${l.id}'),
                      trailing: Column(mainAxisSize: MainAxisSize.min, children: [
                        CallButton(name: l.name, phone: l.phone, leadId: l.id),
                        IconAction(icon: LucideIcons.messageCircle, label: 'WhatsApp ${l.name}', onPressed: l.phone == null ? null : () => openWhatsApp(context, phone: l.phone)),
                      ]),
                    ),
                  );
                },
              ),
            );
          },
        ),
      ],
    );
  }

  Future<void> _openFilters(BuildContext context) async {
    final current = ref.read(leadFiltersProvider);
    final stages = await ref.read(pipelinesProvider.future).then((p) => p.expand((x) => x.stages).toList()).catchError((_) => <Stage>[]);
    if (!context.mounted) return;
    final result = await showVSheet<LeadFilters>(
      context,
      title: 'Filter leads',
      builder: (_) => _FilterSheet(initial: current, stages: stages),
    );
    if (result != null) ref.read(leadFiltersProvider.notifier).set(result.copyWith(q: ref.read(leadFiltersProvider).q));
  }
}

class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.initial, required this.stages});
  final LeadFilters initial;
  final List<Stage> stages;

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late LeadFilters f = widget.initial;

  static const sorts = {'createdAt': 'Newest', 'nextFollowUpAt': 'Next follow-up', 'valueInr': 'Highest value', 'score': 'Best score', 'name': 'Name A to Z'};
  static const sources = {'indiamart': 'IndiaMART', 'website': 'Website', 'whatsapp': 'WhatsApp', 'manual': 'Added by hand', 'import': 'Import'};

  Widget _group(String label, List<Widget> chips) => Padding(
        padding: const EdgeInsets.only(bottom: VSpace.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: context.text.labelLarge!.copyWith(color: context.colors.mutedStrong)),
          const SizedBox(height: VSpace.sm),
          Wrap(spacing: VSpace.sm, runSpacing: VSpace.sm, children: chips),
        ]),
      );

  Widget _chip(String label, bool selected, VoidCallback onTap) => FilterChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
        showCheckmark: false,
        selectedColor: context.colors.accentSoft,
        labelStyle: context.text.labelLarge!.copyWith(color: selected ? context.colors.accentSoftFg : context.colors.fgSecondary, fontWeight: selected ? FontWeight.w600 : FontWeight.w500),
        side: BorderSide(color: selected ? context.colors.accentSoftFg.withValues(alpha: 0.35) : context.colors.border),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(VRadius.pill)),
        materialTapTargetSize: MaterialTapTargetSize.padded,
      );

  Set<T> _toggle<T>(Set<T> s, T v) => s.contains(v) ? ({...s}..remove(v)) : {...s, v};

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(VSpace.xl, VSpace.sm, VSpace.xl, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          _group('Sort by', [for (final e in sorts.entries) _chip(e.value, f.sort == e.key, () => setState(() => f = f.copyWith(sort: e.key)))]),
          if (widget.stages.isNotEmpty)
            _group('Stage', [for (final s in widget.stages) _chip(s.name, f.stageIds.contains(s.id), () => setState(() => f = f.copyWith(stageIds: _toggle(f.stageIds, s.id))))]),
          _group('Temperature', [
            for (final t in LeadTemperature.values) _chip(temperatureLabel(t), f.temperatures.contains(t), () => setState(() => f = f.copyWith(temperatures: _toggle(f.temperatures, t)))),
          ]),
          _group('Source', [for (final e in sources.entries) _chip(e.value, f.sources.contains(e.key), () => setState(() => f = f.copyWith(sources: _toggle(f.sources, e.key))))]),
          Row(children: [
            Expanded(child: OutlinedButton(onPressed: () => Navigator.of(context).pop(LeadFilters(q: f.q)), child: const Text('Clear all'))),
            const SizedBox(width: VSpace.md),
            Expanded(child: FilledButton(onPressed: () => Navigator.of(context).pop(f), child: const Text('Show leads'))),
          ]),
          const SizedBox(height: VSpace.sm),
        ],
      ),
    );
  }
}
