import 'package:timezone/timezone.dart' as tz;

import '../../data/models.dart';
import 'zoned.dart';

/// Working-hours logic (D-063), the same rule as `isWithinWorkingHours` in the shared contract:
/// slots are local times in the workspace timezone; a slot whose end is at or before its start runs
/// past midnight and belongs to its start day; a holiday closes the slots that START that day.
/// Call tracking, office zone detection and GPS run only inside these hours. The server is
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

  static String _key(tz.TZDateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// Slots that start on the local calendar day [day], empty on holidays.
  List<TimeSlot> _slotsFor(tz.TZDateTime day) => holidays.contains(_key(day)) ? const [] : hours.forWeekday(day.weekday);

  static bool _overnight(TimeSlot s) => s.endMinutes <= s.startMinutes;

  /// Concrete [start, end) intervals (UTC) of the slots that start on the local days around [nowUtc].
  List<(DateTime, DateTime)> _intervals(DateTime nowUtc, {int fromDay = -1, int toDay = 14}) {
    final local = tz.TZDateTime.from(nowUtc, _loc);
    final out = <(DateTime, DateTime)>[];
    for (var add = fromDay; add <= toDay; add++) {
      final day = tz.TZDateTime(_loc, local.year, local.month, local.day + add);
      for (final s in _slotsFor(day)) {
        final start = tz.TZDateTime(_loc, day.year, day.month, day.day, s.startMinutes ~/ 60, s.startMinutes % 60);
        final endDay = _overnight(s) ? day.day + 1 : day.day;
        final end = tz.TZDateTime(_loc, day.year, day.month, endDay, s.endMinutes ~/ 60, s.endMinutes % 60);
        out.add((start.toUtc(), end.toUtc()));
      }
    }
    out.sort((a, b) => a.$1.compareTo(b.$1));
    return out;
  }

  (DateTime, DateTime)? _current(DateTime nowUtc) {
    for (final i in _intervals(nowUtc, toDay: 0)) {
      if (!nowUtc.isBefore(i.$1) && nowUtc.isBefore(i.$2)) return i;
    }
    return null;
  }

  bool isWithin(DateTime nowUtc) => _current(nowUtc) != null;

  /// End of the slot we are in (UTC), or null when outside working hours.
  DateTime? currentSlotEnd(DateTime nowUtc) => _current(nowUtc)?.$2;

  /// Start of the next slot after [nowUtc] (UTC), looking 14 days ahead.
  DateTime? nextStart(DateTime nowUtc) {
    for (final i in _intervals(nowUtc, fromDay: 0)) {
      if (i.$1.isAfter(nowUtc)) return i.$1;
    }
    return null;
  }

  /// The next moment the inside/outside state flips (to schedule a timer).
  DateTime? nextTransition(DateTime nowUtc) => currentSlotEnd(nowUtc) ?? nextStart(nowUtc);

  /// "9:30 am to 6:30 pm" for the slots that start today; null when closed today.
  String? todayLabel(DateTime nowUtc) {
    final local = tz.TZDateTime.from(nowUtc, _loc);
    final slots = _slotsFor(tz.TZDateTime(_loc, local.year, local.month, local.day));
    if (slots.isEmpty) return null;
    String fmt(int m) {
      final h = m ~/ 60 % 24;
      final mm = (m % 60).toString().padLeft(2, '0');
      final h12 = h % 12 == 0 ? 12 : h % 12;
      return '$h12:$mm ${h < 12 ? 'am' : 'pm'}';
    }

    return slots.map((s) => '${fmt(s.startMinutes)} to ${fmt(s.endMinutes)}').join(', ');
  }
}
