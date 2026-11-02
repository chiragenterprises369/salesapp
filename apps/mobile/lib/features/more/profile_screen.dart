import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/format.dart';
import '../../core/time/working_hours.dart';
import '../../design/design.dart';
import '../common/common.dart';
import '../data.dart';

/// Profile: name, phone and job title (PATCH /me/profile); email, role, team and working hours
/// are read-only (the company admin sets them).
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _phone;
  late final TextEditingController _title;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final u = ref.read(meProvider)?.user;
    _name = TextEditingController(text: u?.name ?? '');
    _phone = TextEditingController(text: u?.phone ?? '');
    _title = TextEditingController(text: u?.title ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _title.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() => _saving = true);
    try {
      final me = await ref.read(accountRepositoryProvider).updateProfile(name: _name.text.trim(), phone: _phone.text.trim(), title: _title.text.trim());
      ref.read(sessionProvider.notifier).replaceMe(me);
      if (mounted) showToast(context, 'Profile saved');
    } catch (e) {
      if (mounted) showToast(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final status = ref.watch(myStatusProvider);
    final c = context.colors;
    final now = ref.watch(clockProvider)().toUtc();
    final hours = me == null ? null : WorkingHours.forMe(me);
    return VPage(
      title: 'Profile',
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
          sliver: SliverToBoxAdapter(
            child: Form(
              key: _form,
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Center(child: VAvatar(name: me?.user.name ?? 'You', size: 76, status: status)),
                const SizedBox(height: VSpace.md),
                Center(child: Text(me?.user.name ?? '', style: context.text.titleLarge)),
                Center(child: Text(me?.user.email ?? '', style: context.text.bodyMedium!.copyWith(color: c.mutedStrong))),
                const SizedBox(height: VSpace.xl),
                VCard(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    TextFormField(
                      controller: _name,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'Full name', prefixIcon: Icon(LucideIcons.user, size: 18)),
                      validator: (v) => (v == null || v.trim().length < 2) ? 'Enter your name' : null,
                    ),
                    const SizedBox(height: VSpace.md),
                    TextFormField(
                      controller: _phone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Mobile number', hintText: '+91 98765 43210', prefixIcon: Icon(LucideIcons.phone, size: 18)),
                    ),
                    const SizedBox(height: VSpace.md),
                    TextFormField(
                      controller: _title,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(labelText: 'Job title', prefixIcon: Icon(LucideIcons.briefcase, size: 18)),
                    ),
                    const SizedBox(height: VSpace.lg),
                    FilledButton(
                      onPressed: _saving ? null : _save,
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      child: Text(_saving ? 'Saving...' : 'Save changes'),
                    ),
                  ]),
                ),
                const SizedBox(height: VSpace.md),
                SectionCard(
                  title: 'Set by your company',
                  icon: LucideIcons.building2,
                  child: Column(children: [
                    _ReadOnly(label: 'Company', value: me?.workspace.displayName ?? ''),
                    _ReadOnly(label: 'Role', value: me?.roleName ?? ''),
                    _ReadOnly(label: 'Phone on file', value: formatPhone(me?.user.phone)),
                    _ReadOnly(label: 'Working hours today', value: hours?.todayLabel(now) ?? 'Closed today'),
                    _ReadOnly(label: 'Field staff', value: (me?.user.isFieldStaff ?? false) ? 'Yes, attendance and GPS apply' : 'No'),
                  ]),
                ),
              ]),
            ),
          ),
        ),
      ],
    );
  }
}

class _ReadOnly extends StatelessWidget {
  const _ReadOnly({required this.label, required this.value});
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => MergeSemantics(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: VSpace.md, vertical: VSpace.sm + 2),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Expanded(flex: 2, child: Text(label, style: context.text.bodyMedium!.copyWith(color: context.colors.mutedStrong))),
            Expanded(flex: 3, child: Text(value, style: context.text.bodyMedium, textAlign: TextAlign.end)),
          ]),
        ),
      );
}
