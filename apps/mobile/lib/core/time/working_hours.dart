import 'package:timezone/timezone.dart' as tz;

import '../../data/models.dart';
import 'zoned.dart';

/// Working-hours logic (D-063): call tracking and GPS run only inside these hours. The server is
/// authoritative (it rejects locations outside them); the app uses this to start and stop its
/// foreground services at the right time.
class WorkingHours {
  WorkingHours({required this.hours, required Iterable<String> holidays, required this.timezone}) : holidays = holidays.toSet();

  factory WorkingHours.forMe(Me me) => WorkingHours(
        hours: me.workingHours,
        holidays: me.workspace.holidays.map((h) => h.date),
        timezone: me.workspace.timezone,
      );

  final BusinessHours hours;
  final Set<String> holidays;
  final String timezone;

  tz.Location get _loc => zone(timezone);

  /// Slots of the local calendar day of [local], empty on holidays.
  List<TimeSlot> _slotsFor(tz.TZDateTime local) {
    if (holidays.contains(_key(local))) return const [];
    return hours.forWeekday(local.weekday);
  }

  static String _key(tz.TZDateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  static int _end(TimeSlot s) => s.endMinutes <= s.startMinutes ? 24 * 60 : s.endMinutes;

  TimeSlot? _currentSlot(DateTime nowUtc) {
    final local = tz.TZDateTime.from(nowUtc, _loc);
    final minutes = local.hour * 60 + local.minute;
    for (final s in _slotsFor(local)) {
      if (minutes >= s.startMinutes && minutes < _end(s)) return s;
    }
    return null;
  }

  bool isWithin(DateTime nowUtc) => _currentSlot(nowUtc) != null;

  /// End of the slot we are in (UTC), or null when outside working hours.
  DateTime? currentSlotEnd(DateTime nowUtc) {
    final s = _currentSlot(nowUtc);
    if (s == null) return null;
    final local = tz.TZDateTime.from(nowUtc, _loc);
    final end = _end(s);
    return tz.TZDateTime(_loc, local.year, local.month, local.day, end ~/ 60, end % 60).toUtc();
  }

  /// Start of the next slot after [nowUtc] (UTC), looking 14 days ahead.
  DateTime? nextStart(DateTime nowUtc) {
    final local = tz.TZDateTime.from(nowUtc, _loc);
    final minutes = local.hour * 60 + local.minute;
    for (var add = 0; add < 15; add++) {
      final day = tz.TZDateTime(_loc, local.year, local.month, local.day + add);
      final slots = [..._slotsFor(day)]..sort((a, b) => a.startMinutes.compareTo(b.startMinutes));
      for (final s in slots) {
        if (add == 0 && s.startMinutes <= minutes) continue;
        return tz.TZDateTime(_loc, day.year, day.month, day.day, s.startMinutes ~/ 60, s.startMinutes % 60).toUtc();
      }
    }
    return null;
  }

  /// The next moment the inside/outside state flips (to schedule a timer).
  DateTime? nextTransition(DateTime nowUtc) => currentSlotEnd(nowUtc) ?? nextStart(nowUtc);

  /// "Working hours today: 9:30 am to 6:30 pm" style text; null when closed today.
  String? todayLabel(DateTime nowUtc) {
    final local = tz.TZDateTime.from(nowUtc, _loc);
    final slots = _slotsFor(local);
    if (slots.isEmpty) return null;
    String fmt(int m) {
      final h = m ~/ 60 % 24;
      final mm = (m % 60).toString().padLeft(2, '0');
      final h12 = h % 12 == 0 ? 12 : h % 12;
      return '$h12:$mm ${h < 12 ? 'am' : 'pm'}';
    }

    return slots.map((s) => '${fmt(s.startMinutes)} to ${fmt(_end(s))}').join(', ');
  }
}
