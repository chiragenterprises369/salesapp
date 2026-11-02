import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../tokens.dart';

/// Empty state that says what happens next (SPEC: every list has one).
class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, required this.message, this.action, this.compact = false});

  final IconData icon;
  final String title;
  final String message;
  final Widget? action;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Semantics(
      container: true,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: VSpace.xxl, vertical: compact ? VSpace.xl : 48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: compact ? 44 : 56,
              height: compact ? 44 : 56,
              decoration: BoxDecoration(
                color: c.accentSoft,
                borderRadius: BorderRadius.circular(compact ? 12 : 16),
              ),
              child: Icon(icon, size: compact ? 20 : 24, color: c.accentSoftFg),
            ),
            SizedBox(height: compact ? VSpace.md : VSpace.lg),
            Text(title, textAlign: TextAlign.center, style: context.text.titleMedium),
            const SizedBox(height: VSpace.xs + 2),
            Text(message, textAlign: TextAlign.center, style: context.text.bodyMedium!.copyWith(color: c.mutedStrong)),
            if (action != null) ...[const SizedBox(height: VSpace.lg), action!],
          ],
        ),
      ),
    );
  }
}

/// Error with a retry (SPEC: every list has an error state with retry).
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.title, this.message = 'Check your connection, then try again.', required this.onRetry, this.compact = false});

  final String title;
  final String message;
  final VoidCallback onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Semantics(
      liveRegion: true,
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: VSpace.xxl, vertical: compact ? VSpace.lg : 48),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(color: c.tone(Tone.red).bg, borderRadius: BorderRadius.circular(16)),
              child: Icon(LucideIcons.circleAlert, size: 24, color: c.tone(Tone.red).fg),
            ),
            const SizedBox(height: VSpace.lg),
            Text(title, textAlign: TextAlign.center, style: context.text.titleMedium),
            const SizedBox(height: VSpace.xs + 2),
            Text(message, textAlign: TextAlign.center, style: context.text.bodyMedium!.copyWith(color: c.mutedStrong)),
            const SizedBox(height: VSpace.lg),
            FilledButton.icon(onPressed: onRetry, icon: const Icon(LucideIcons.rotateCw, size: 18), label: const Text('Try again')),
          ],
        ),
      ),
    );
  }
}

/// Thin banner: offline / showing saved data / pending uploads.
class InfoBanner extends StatelessWidget {
  const InfoBanner({super.key, required this.icon, required this.text, this.tone = Tone.amber, this.action});
  final IconData icon;
  final String text;
  final Tone tone;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final t = context.colors.tone(tone);
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: VSpace.md, vertical: VSpace.sm + 2),
        decoration: BoxDecoration(color: t.bg, borderRadius: BorderRadius.circular(VRadius.md), border: Border.all(color: t.border)),
        child: Row(
          children: [
            Icon(icon, size: 18, color: t.fg),
            const SizedBox(width: VSpace.sm + 2),
            Expanded(child: Text(text, style: context.text.bodyMedium!.copyWith(color: t.fg))),
            ?action,
          ],
        ),
      ),
    );
  }
}

/// Shown in the web preview where a feature needs the phone (calls, call log, recordings, GPS).
class AndroidOnlyNote extends StatelessWidget {
  const AndroidOnlyNote({super.key, required this.feature});
  final String feature;

  @override
  Widget build(BuildContext context) {
    return InfoBanner(
      icon: LucideIcons.smartphone,
      tone: Tone.indigo,
      text: 'Android only: $feature works in the Vistar app on an Android phone. The web preview shows the screens.',
    );
  }
}
