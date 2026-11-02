import '../../data/models.dart';
import '../time/zoned.dart';

/// Groups tasks by due time in the workspace timezone: Overdue, Today, Tomorrow, Later, No due
/// date, then Done (completed this session). Each bucket is sorted by due time.
Map<TaskBucket, List<Task>> bucketTasks(Iterable<Task> tasks, {required DateTime now, required String timezone}) {
  final startTomorrow = startOfDay(now, timezone, addDays: 1);
  final startDayAfter = startOfDay(now, timezone, addDays: 2);
  final out = {for (final b in TaskBucket.values) b: <Task>[]};
  for (final t in tasks) {
    if (t.status == 'cancelled') continue;
    if (t.isDone) {
      out[TaskBucket.done]!.add(t);
      continue;
    }
    final due = t.effectiveDue;
    final bucket = switch (due) {
      null => TaskBucket.noDate,
      _ when due.isBefore(now) => TaskBucket.overdue,
      _ when due.isBefore(startTomorrow) => TaskBucket.today,
      _ when due.isBefore(startDayAfter) => TaskBucket.tomorrow,
      _ => TaskBucket.later,
    };
    out[bucket]!.add(t);
  }
  for (final e in out.entries) {
    if (e.key == TaskBucket.done) {
      e.value.sort((a, b) => (b.completedAt ?? now).compareTo(a.completedAt ?? now));
    } else {
      e.value.sort((a, b) => (a.effectiveDue ?? DateTime(2100)).compareTo(b.effectiveDue ?? DateTime(2100)));
    }
  }
  out.removeWhere((_, v) => v.isEmpty);
  return out;
}

/// Snooze presets: in 1 hour, this evening (6 pm), tomorrow 10 am, next Monday 10 am.
List<(String label, DateTime at)> snoozeOptions(DateTime now, String timezone) {
  final local = inZone(now, timezone);
  final startToday = startOfDay(now, timezone);
  DateTime at(int addDays, int hour) => startOfDay(now, timezone, addDays: addDays).add(Duration(hours: hour));
  final evening = startToday.add(const Duration(hours: 18));
  final daysToMonday = (8 - local.weekday) % 7 == 0 ? 7 : (8 - local.weekday) % 7;
  return [
    ('In 1 hour', now.add(const Duration(hours: 1))),
    if (evening.isAfter(now.add(const Duration(minutes: 30)))) ('This evening, 6 pm', evening),
    ('Tomorrow, 10 am', at(1, 10)),
    ('Next Monday, 10 am', at(daysToMonday, 10)),
  ];
}
