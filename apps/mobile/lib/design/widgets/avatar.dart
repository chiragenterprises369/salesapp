import 'package:flutter/material.dart';

import '../../core/format.dart';
import '../../data/models.dart';
import '../tokens.dart';
import 'chips.dart';

/// Initials avatar (SPEC 4.1) with an optional presence ring.
class VAvatar extends StatelessWidget {
  const VAvatar({super.key, required this.name, this.size = 40, this.status, this.tinted = true});

  final String name;
  final double size;
  final PresenceStatus? status;
  final bool tinted;

  /// Stable tint per name so a list of people is easy to scan.
  static Tone toneFor(String name) {
    const tones = [Tone.indigo, Tone.blue, Tone.green, Tone.amber, Tone.grey];
    var h = 0;
    for (final u in name.codeUnits) {
      h = (h * 31 + u) & 0x7fffffff;
    }
    return tones[h % tones.length];
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final t = c.tone(tinted ? toneFor(name) : Tone.indigo);
    final circle = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: t.bg, shape: BoxShape.circle, border: Border.all(color: t.border)),
      child: Text(
        initials(name),
        textScaler: TextScaler.noScaling,
        style: TextStyle(fontFamily: 'Inter', fontSize: size * 0.36, fontWeight: FontWeight.w600, color: t.fg, letterSpacing: 0.2),
      ),
    );
    if (status == null) return ExcludeSemantics(child: circle);
    final ring = c.tone(toneForStatus(status!)).fg;
    final ringW = size >= 44 ? 2.5 : 2.0;
    return ExcludeSemantics(
      child: SizedBox(
        width: size + ringW * 2 + 2,
        height: size + ringW * 2 + 2,
        child: Stack(
          alignment: Alignment.center,
          children: [
            AnimatedContainer(
              duration: VMotion.of(context),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: status == PresenceStatus.offline ? c.borderStrong : ring, width: ringW),
              ),
            ),
            circle,
            Positioned(
              right: 0,
              bottom: 0,
              child: AnimatedContainer(
                duration: VMotion.of(context),
                width: size * 0.3,
                height: size * 0.3,
                decoration: BoxDecoration(color: ring, shape: BoxShape.circle, border: Border.all(color: c.surface, width: 2)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
