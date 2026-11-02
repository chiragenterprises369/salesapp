import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../app/runtime.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../../platform/telephony.dart' show isAndroidApp;
import '../common/common.dart';

/// Preferences: theme (System, Light, Dark, Scheduled), motion, notifications (PATCH /me/settings),
/// SIM calling setup and automatic office location (this phone only).
class PreferencesScreen extends ConsumerStatefulWidget {
  const PreferencesScreen({super.key});

  @override
  ConsumerState<PreferencesScreen> createState() => _PreferencesScreenState();
}

class _PreferencesScreenState extends ConsumerState<PreferencesScreen> {
  bool _saving = false;

  Future<void> _save({ThemePreference? theme, String? darkFrom, String? darkTo, bool? push, bool? inApp, String? emailDigest, String? reducedMotion}) async {
    final me = ref.read(meProvider);
    if (me == null) return;
    if (theme != null) await ref.read(prefsProvider.notifier).setTheme(theme);
    final before = me.settings;
    // Optimistic: the screen and the theme change at once, the server follows.
    ref.read(sessionProvider.notifier).replaceMe(me.withSettings(before.copyWith(
          themeMode: theme,
          darkFrom: darkFrom,
          darkTo: darkTo,
          pushEnabled: push,
          inAppEnabled: inApp,
          emailDigest: emailDigest,
          reducedMotion: reducedMotion,
        )));
    setState(() => _saving = true);
    try {
      final saved = await ref.read(accountRepositoryProvider).updateSettings(
            theme: theme,
            darkFrom: darkFrom,
            darkTo: darkTo,
            push: push,
            inApp: inApp,
            emailDigest: emailDigest,
            reducedMotion: reducedMotion,
          );
      final cur = ref.read(meProvider);
      if (cur != null) ref.read(sessionProvider.notifier).replaceMe(cur.withSettings(saved));
    } catch (e) {
      final cur = ref.read(meProvider);
      if (cur != null) ref.read(sessionProvider.notifier).replaceMe(cur.withSettings(before));
      if (mounted) showToast(context, friendlyError(e), error: true);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _pickTime(bool from) async {
    final s = ref.read(meProvider)?.settings;
    final cur = (from ? s?.darkFrom : s?.darkTo) ?? (from ? '19:00' : '07:00');
    final parts = cur.split(':');
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: int.tryParse(parts.first) ?? 19, minute: int.tryParse(parts.last) ?? 0),
      helpText: from ? 'Dark theme from' : 'Light theme from',
    );
    if (picked == null) return;
    final v = '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
    await _save(darkFrom: from ? v : null, darkTo: from ? null : v);
  }

  @override
  Widget build(BuildContext context) {
    final me = ref.watch(meProvider);
    final s = me?.settings ?? const UserSettings();
    final local = ref.watch(prefsProvider);
    final theme = local.theme ?? s.themeMode;
    final c = context.colors;

    Widget card(List<Widget> rows) => VCard(
          padding: EdgeInsets.zero,
          child: Column(children: [
            for (var i = 0; i < rows.length; i++) ...[
              if (i > 0) Divider(height: 1, color: c.border),
              rows[i],
            ],
          ]),
        );

    return VPage(
      title: 'Preferences',
      subtitle: _saving ? 'Saving...' : 'Saved to your account',
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.xs, VSpace.page, 0),
          sliver: SliverList.list(children: [
            const GroupLabel('Theme'),
            VCard(
              padding: const EdgeInsets.all(VSpace.md),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                SegmentedButton<ThemePreference>(
                  segments: const [
                    ButtonSegment(value: ThemePreference.system, label: Text('System'), icon: Icon(LucideIcons.monitorSmartphone, size: 16)),
                    ButtonSegment(value: ThemePreference.light, label: Text('Light'), icon: Icon(LucideIcons.sun, size: 16)),
                    ButtonSegment(value: ThemePreference.dark, label: Text('Dark'), icon: Icon(LucideIcons.moon, size: 16)),
                  ],
                  selected: {if (theme == ThemePreference.scheduled) ThemePreference.system else theme},
                  showSelectedIcon: false,
                  onSelectionChanged: (v) => _save(theme: v.first),
                ),
                const SizedBox(height: VSpace.sm),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  value: theme == ThemePreference.scheduled,
                  onChanged: (v) => _save(theme: v ? ThemePreference.scheduled : ThemePreference.system),
                  title: const Text('Scheduled'),
                  subtitle: Text('Dark from ${s.darkFrom} to ${s.darkTo}, company time', style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
                ),
                if (theme == ThemePreference.scheduled)
                  Row(children: [
                    Expanded(child: OutlinedButton.icon(onPressed: () => _pickTime(true), icon: const Icon(LucideIcons.moon, size: 16), label: Text('Dark ${s.darkFrom}'))),
                    const SizedBox(width: VSpace.sm),
                    Expanded(child: OutlinedButton.icon(onPressed: () => _pickTime(false), icon: const Icon(LucideIcons.sun, size: 16), label: Text('Light ${s.darkTo}'))),
                  ]),
              ]),
            ),
            const GroupLabel('Motion'),
            card([
              for (final m in const [('system', 'Follow the phone', 'Animations unless the phone asks for less motion'), ('off', 'Full motion', 'Smooth transitions and number counters'), ('on', 'Reduce motion', 'No sliding, fading or counting')])
                RadioListTile<String>(
                  value: m.$1,
                  // ignore: deprecated_member_use
                  groupValue: s.reducedMotion,
                  // ignore: deprecated_member_use
                  onChanged: (v) => _save(reducedMotion: v),
                  title: Text(m.$2),
                  subtitle: Text(m.$3, style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
                ),
            ]),
            const GroupLabel('Notifications'),
            card([
              SwitchListTile(
                value: s.pushEnabled,
                onChanged: (v) => _save(push: v),
                secondary: const Icon(LucideIcons.bellRing, size: 20),
                title: const Text('Push notifications'),
                subtitle: Text(isAndroidApp ? 'New leads, due tasks and WhatsApp replies on this phone' : 'Android only: push works in the Vistar app', style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
              ),
              SwitchListTile(
                value: s.inAppEnabled,
                onChanged: (v) => _save(inApp: v),
                secondary: const Icon(LucideIcons.bell, size: 20),
                title: const Text('In-app banners'),
                subtitle: Text('A short banner while the app is open', style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
              ),
              ListTile(
                leading: const Icon(LucideIcons.mail, size: 20),
                title: const Text('Email summary'),
                trailing: DropdownButton<String>(
                  value: const ['off', 'daily', 'weekly'].contains(s.emailDigest) ? s.emailDigest : 'daily',
                  underline: const SizedBox.shrink(),
                  items: const [
                    DropdownMenuItem(value: 'off', child: Text('Off')),
                    DropdownMenuItem(value: 'daily', child: Text('Daily')),
                    DropdownMenuItem(value: 'weekly', child: Text('Weekly')),
                  ],
                  onChanged: (v) => _save(emailDigest: v),
                ),
              ),
            ]),
            const GroupLabel('This phone'),
            card([
              NavRow(
                icon: LucideIcons.phoneCall,
                label: 'SIM calling setup',
                hint: isAndroidApp ? 'Permissions for calls, call log and recordings' : 'Android only',
                onTap: () => context.push('/call-setup'),
              ),
              SwitchListTile(
                value: local.zoneDetection && isAndroidApp,
                onChanged: isAndroidApp
                    ? (v) async {
                        if (v) {
                          final ok = await ref.read(zoneScannerProvider).requestPermissions();
                          if (!ok) {
                            if (context.mounted) showToast(context, 'Allow Nearby devices and precise location to detect your room.', error: true);
                            return;
                          }
                        }
                        await ref.read(prefsProvider.notifier).setZoneDetection(v);
                        await ref.read(runtimeProvider)?.refreshCallTracking();
                      }
                    : null,
                secondary: const Icon(LucideIcons.radar, size: 20),
                title: const Text('Detect my room in the office'),
                subtitle: Text(
                  isAndroidApp
                      ? 'Room beacons and the office Wi-Fi, only in working hours. Your team sees the room on the Team Floor.'
                      : 'Android only: the app reads room beacons and the office Wi-Fi.',
                  style: context.text.bodySmall!.copyWith(color: c.mutedStrong),
                ),
              ),
              NavRow(icon: LucideIcons.scanLine, label: 'Scan a door or desk QR code', hint: 'Sets your room exactly', onTap: () => context.push('/office-zone')),
            ]),
          ]),
        ),
      ],
    );
  }
}
