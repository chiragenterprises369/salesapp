import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../tokens.dart';

/// Search field with a clear button; 48 dp tall.
class VSearchField extends StatefulWidget {
  const VSearchField({super.key, required this.hint, required this.onChanged, this.initial = '', this.trailing});
  final String hint;
  final ValueChanged<String> onChanged;
  final String initial;
  final Widget? trailing;

  @override
  State<VSearchField> createState() => _VSearchFieldState();
}

class _VSearchFieldState extends State<VSearchField> {
  late final TextEditingController _c = TextEditingController(text: widget.initial);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Row(
      children: [
        Expanded(
          child: TextField(
            controller: _c,
            onChanged: (v) {
              setState(() {});
              widget.onChanged(v);
            },
            textInputAction: TextInputAction.search,
            style: context.text.bodyLarge,
            decoration: InputDecoration(
              hintText: widget.hint,
              prefixIcon: const Icon(LucideIcons.search, size: 18),
              fillColor: c.surface,
              contentPadding: const EdgeInsets.symmetric(vertical: 12),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(VRadius.md), borderSide: BorderSide(color: c.border)),
              suffixIcon: _c.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      icon: const Icon(LucideIcons.x, size: 18),
                      onPressed: () {
                        _c.clear();
                        setState(() {});
                        widget.onChanged('');
                      },
                    ),
            ),
          ),
        ),
        if (widget.trailing != null) ...[const SizedBox(width: VSpace.sm), widget.trailing!],
      ],
    );
  }
}

/// Bottom sheet with a title row, used for filters, status, SIM choice, stage change.
Future<T?> showVSheet<T>(BuildContext context, {required String title, String? subtitle, required WidgetBuilder builder, bool scrollable = false}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: context.colors.surface,
    builder: (ctx) {
      final body = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(VSpace.xl, 0, VSpace.xl, VSpace.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(header: true, child: Text(title, style: ctx.text.titleLarge)),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(subtitle, style: ctx.text.bodyMedium!.copyWith(color: ctx.colors.mutedStrong)),
                ],
              ],
            ),
          ),
          Flexible(child: builder(ctx)),
          SizedBox(height: MediaQuery.viewInsetsOf(ctx).bottom + VSpace.md),
        ],
      );
      return ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.88),
        child: scrollable ? body : SingleChildScrollView(child: body),
      );
    },
  );
}

/// Toast-style feedback with an optional action (e.g. Undo).
void showToast(BuildContext context, String message, {String? actionLabel, VoidCallback? onAction, bool error = false}) {
  final m = ScaffoldMessenger.maybeOf(context);
  if (m == null) return;
  m.hideCurrentSnackBar();
  m.showSnackBar(
    SnackBar(
      content: Text(message),
      duration: Duration(seconds: actionLabel != null ? 5 : 3),
      action: actionLabel != null && onAction != null ? SnackBarAction(label: actionLabel, onPressed: onAction) : null,
      backgroundColor: error ? context.colors.danger : null,
    ),
  );
}
