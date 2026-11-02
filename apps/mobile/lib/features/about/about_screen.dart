import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/providers.dart';
import '../../core/time/zoned.dart';
import '../../data/models.dart';
import '../../design/design.dart';
import '../../platform/telephony.dart' show isAndroidApp;
import '../auth/login_screen.dart' show BrandMark;
import '../common/common.dart';
import '../data.dart';

final packageInfoProvider = FutureProvider<PackageInfo>((ref) => PackageInfo.fromPlatform());

/// About: this version, the latest APK from the Super Admin config section (GET /app/config ->
/// android.latest) with a download button, a forced-update notice below minSupportedVersionCode,
/// and what the app tracks.
class AboutScreen extends ConsumerWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final info = ref.watch(packageInfoProvider).value;
    final config = ref.watch(appConfigProvider);
    final tz = timezoneOf(ref);
    final c = context.colors;
    final code = int.tryParse(info?.buildNumber ?? '') ?? 1;
    final server = ref.watch(prefsProvider.select((p) => p.serverUrl));
    return VPage(
      title: 'About',
      onRefresh: () async => ref.invalidate(appConfigProvider),
      slivers: [
        SliverPadding(
          padding: const EdgeInsets.fromLTRB(VSpace.page, VSpace.sm, VSpace.page, 0),
          sliver: SliverList.list(children: [
            VCard(
              child: Row(children: [
                const BrandMark(size: 52),
                const SizedBox(width: VSpace.md),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text('Vistar employee app', style: context.text.titleMedium),
                    Text('Version ${info?.version ?? '1.0.0'} (build $code)', style: context.text.bodyMedium!.copyWith(color: c.mutedStrong)),
                    Text(isAndroidApp ? 'app.vistar.employee' : 'Web preview', style: context.text.bodySmall!.copyWith(color: c.muted)),
                  ]),
                ),
              ]),
            ),
            const SizedBox(height: VSpace.md),
            SectionCard(
              title: 'Updates',
              icon: LucideIcons.download,
              trailing: TextButton(onPressed: () => ref.invalidate(appConfigProvider), child: const Text('Check now')),
              padding: const EdgeInsets.fromLTRB(VSpace.lg, 0, VSpace.lg, VSpace.lg),
              child: config.when(
                loading: () => const Shimmer(child: SkeletonBox(height: 64, radius: 10)),
                error: (e, _) => ErrorState(compact: true, title: 'Could not check for updates', message: friendlyError(e), onRetry: () => ref.invalidate(appConfigProvider)),
                data: (cfg) => _UpdateCard(config: cfg, currentCode: code, tz: tz),
              ),
            ),
            const SizedBox(height: VSpace.md),
            SectionCard(
              title: 'What the app tracks',
              icon: LucideIcons.shieldCheck,
              padding: const EdgeInsets.fromLTRB(VSpace.lg, 0, VSpace.lg, VSpace.lg),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (final t in const [
                  'Your status comes from what the app sees: the app being open, work calls on your SIM, your attendance and the status you pick. No heartbeat for 45 seconds shows you as Offline.',
                  'For outgoing SIM calls Android does not say when the other side answers, so you show as On call from dialing. The talk time comes from the call log afterwards.',
                  'Calls, office room detection and location run only inside your working hours. Location is shared only while you are checked in.',
                  'The app never records calls. It uploads the recording your own phone made, if it made one.',
                  'Vistar cannot know whether you are physically at your desk.',
                ])
                  Padding(
                    padding: const EdgeInsets.only(bottom: VSpace.sm),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Padding(padding: const EdgeInsets.only(top: 6), child: Container(width: 6, height: 6, decoration: BoxDecoration(color: c.accentText, shape: BoxShape.circle))),
                      const SizedBox(width: VSpace.sm + 2),
                      Expanded(child: Text(t, style: context.text.bodyMedium)),
                    ]),
                  ),
              ]),
            ),
            const SizedBox(height: VSpace.md),
            VCard(
              padding: EdgeInsets.zero,
              child: NavRow(icon: LucideIcons.server, label: 'Server', hint: server),
            ),
          ]),
        ),
      ],
    );
  }
}

class _UpdateCard extends StatelessWidget {
  const _UpdateCard({required this.config, required this.currentCode, required this.tz});
  final AppConfig config;
  final int currentCode;
  final String tz;

  String _size(int? bytes) => bytes == null ? '' : '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final latest = config.latestVersionName;
    if (latest == null) {
      return Text('No release has been published yet. Your company admin shares the download link when it is ready.', style: context.text.bodyMedium!.copyWith(color: c.mutedStrong));
    }
    final must = config.mustUpdate(currentCode);
    final available = config.updateAvailable(currentCode);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (must) ...[
        const InfoBanner(icon: LucideIcons.triangleAlert, tone: Tone.red, text: 'This version is no longer supported. Install the latest version to keep working.'),
        const SizedBox(height: VSpace.md),
      ],
      Row(children: [
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(available ? 'Version $latest is available' : 'You have the latest version', style: context.text.titleSmall),
            Text(
              [if (config.releasedAt != null) 'Released ${formatDayTime(config.releasedAt!, tz)}', _size(config.apkSize)].where((s) => s.isNotEmpty).join(' · '),
              style: context.text.bodySmall!.copyWith(color: c.mutedStrong),
            ),
          ]),
        ),
        VChip(available ? 'Update' : 'Up to date', tone: available ? Tone.indigo : Tone.green, dot: true),
      ]),
      if (config.releaseNotes != null) ...[
        const SizedBox(height: VSpace.sm),
        Text(config.releaseNotes!, style: context.text.bodyMedium),
      ],
      const SizedBox(height: VSpace.md),
      FilledButton.icon(
        onPressed: config.apkUrl == null ? null : () => launchUrl(Uri.parse(config.apkUrl!), mode: LaunchMode.externalApplication),
        icon: const Icon(LucideIcons.download, size: 18),
        label: Text(isAndroidApp ? (available ? 'Download and install' : 'Download again') : 'Download the APK'),
        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
      ),
      if (isAndroidApp) ...[
        const SizedBox(height: VSpace.sm),
        Text('Android asks once to allow installs from your browser. The app keeps your sign-in.', style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
      ],
    ]);
  }
}
