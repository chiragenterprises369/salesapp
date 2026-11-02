import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../tokens.dart';

/// List row: leading (avatar or icon), title, subtitle, a wrap of meta chips and a trailing
/// action. At least 56 dp tall; the whole row is one tap target with one TalkBack label.
class VListTile extends StatelessWidget {
  const VListTile({
    super.key,
    this.leading,
    required this.title,
    this.subtitle,
    this.meta = const [],
    this.trailing,
    this.onTap,
    this.semanticLabel,
    this.titleStyle,
    this.dense = false,
  });

  final Widget? leading;
  final String title;
  final String? subtitle;
  final List<Widget> meta;
  final Widget? trailing;
  final VoidCallback? onTap;
  final String? semanticLabel;
  final TextStyle? titleStyle;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final content = Padding(
      padding: EdgeInsets.symmetric(horizontal: VSpace.md, vertical: dense ? VSpace.sm : VSpace.md - 2),
      child: Row(
        children: [
          if (leading != null) ...[leading!, const SizedBox(width: VSpace.md)],
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(title, maxLines: 2, overflow: TextOverflow.ellipsis, style: titleStyle ?? context.text.titleSmall),
                if (subtitle != null && subtitle!.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(subtitle!, maxLines: 1, overflow: TextOverflow.ellipsis, style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
                ],
                if (meta.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Wrap(spacing: 6, runSpacing: 4, children: meta),
                ],
              ],
            ),
          ),
          if (trailing != null) ...[const SizedBox(width: VSpace.xs), trailing!],
        ],
      ),
    );
    return Semantics(
      button: onTap != null,
      label: semanticLabel,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 56),
        child: onTap == null ? content : InkWell(onTap: onTap, borderRadius: BorderRadius.circular(VRadius.md), child: content),
      ),
    );
  }
}

/// 48 dp icon action with a tooltip and a TalkBack label.
class IconAction extends StatelessWidget {
  const IconAction({super.key, required this.icon, required this.label, required this.onPressed, this.color, this.filled = false, this.badge});
  final IconData icon;
  final String label;
  final VoidCallback? onPressed;
  final Color? color;
  final bool filled;
  final int? badge;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final icn = Icon(icon, size: 20, color: onPressed == null ? c.muted.withValues(alpha: 0.5) : (color ?? (filled ? c.accentSoftFg : c.fgSecondary)));
    final button = IconButton(
      tooltip: label,
      onPressed: onPressed,
      style: filled ? IconButton.styleFrom(backgroundColor: c.accentSoft, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))) : null,
      icon: badge != null && badge! > 0
          ? Badge(
              label: Text(badge! > 99 ? '99+' : '${badge!}', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.w700)),
              backgroundColor: c.danger,
              child: icn,
            )
          : icn,
    );
    return Semantics(label: badge != null && badge! > 0 ? '$label, $badge new' : null, child: button);
  }
}

/// A row in a settings-like list (More, Preferences).
class NavRow extends StatelessWidget {
  const NavRow({super.key, required this.icon, required this.label, this.hint, this.onTap, this.trailing, this.destructive = false});
  final IconData icon;
  final String label;
  final String? hint;
  final VoidCallback? onTap;
  final Widget? trailing;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final fg = destructive ? c.dangerText : c.fg;
    return Semantics(
      button: onTap != null,
      label: hint == null ? label : '$label. $hint',
      child: ExcludeSemantics(
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 60),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: VSpace.lg, vertical: VSpace.sm + 2),
              child: Row(
                children: [
                  Container(
                    width: 38,
                    height: 38,
                    decoration: BoxDecoration(color: destructive ? c.tone(Tone.red).bg : c.surface3, borderRadius: BorderRadius.circular(11)),
                    child: Icon(icon, size: 19, color: destructive ? c.dangerText : c.fgSecondary),
                  ),
                  const SizedBox(width: VSpace.md + 2),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(label, style: context.text.titleSmall!.copyWith(color: fg)),
                        if (hint != null) ...[
                          const SizedBox(height: 1),
                          Text(hint!, style: context.text.bodySmall!.copyWith(color: c.mutedStrong), maxLines: 2, overflow: TextOverflow.ellipsis),
                        ],
                      ],
                    ),
                  ),
                  trailing ?? (onTap != null ? Icon(LucideIcons.chevronRight, size: 18, color: c.muted) : const SizedBox.shrink()),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
