import '../json.dart';
import 'user.dart';

const taskTypeLabels = {'todo': 'To-do', 'call': 'Call', 'follow_up': 'Follow-up', 'meeting': 'Meeting', 'email': 'Email'};

class Task {
  const Task({
    required this.id,
    required this.type,
    required this.title,
    this.notes,
    required this.status,
    required this.priority,
    this.leadId,
    this.leadName,
    this.assignee,
    this.dueAt,
    this.snoozedUntil,
    this.completedAt,
    this.source = 'manual',
    this.leadPhone,
  });

  final String id;
  final String type;
  final String title;
  final String? notes;
  final String status;
  final String priority;
  final String? leadId;
  final String? leadName;
  final UserSummary? assignee;
  final DateTime? dueAt;
  final DateTime? snoozedUntil;
  final DateTime? completedAt;
  final String source;

  /// Not in TaskSchema; filled from the lead when the app knows it (Today, lead detail).
  final String? leadPhone;

  bool get isDone => status == 'done';
  bool get isHighPriority => priority == 'high' || priority == 'urgent';
  String get typeLabel => taskTypeLabels[type] ?? type;

  /// The time that decides the bucket: a snoozed task is due when the snooze ends.
  DateTime? get effectiveDue => snoozedUntil != null && (dueAt == null || snoozedUntil!.isAfter(dueAt!)) ? snoozedUntil : dueAt;

  static Task parse(Json j) => Task(
        id: str(j['id']),
        type: str(j['type'], 'todo'),
        title: str(j['title']),
        notes: strOrNull(j['notes']),
        status: str(j['status'], 'open'),
        priority: str(j['priority'], 'normal'),
        leadId: strOrNull(j['leadId']),
        leadName: strOrNull(j['leadName']),
        assignee: UserSummary.parseOrNull(j['assignee']),
        dueAt: date(j['dueAt']),
        snoozedUntil: date(j['snoozedUntil']),
        completedAt: date(j['completedAt']),
        source: str(j['source'], 'manual'),
        leadPhone: strOrNull(j['leadPhone']),
      );

  Task copyWith({String? status, DateTime? snoozedUntil, DateTime? completedAt, bool clearCompleted = false, String? leadPhone}) => Task(
        id: id,
        type: type,
        title: title,
        notes: notes,
        status: status ?? this.status,
        priority: priority,
        leadId: leadId,
        leadName: leadName,
        assignee: assignee,
        dueAt: dueAt,
        snoozedUntil: snoozedUntil ?? this.snoozedUntil,
        completedAt: clearCompleted ? null : (completedAt ?? this.completedAt),
        source: source,
        leadPhone: leadPhone ?? this.leadPhone,
      );
}

enum TaskBucket { overdue, today, tomorrow, later, noDate, done }

extension TaskBucketLabel on TaskBucket {
  String get label => switch (this) {
        TaskBucket.overdue => 'Overdue',
        TaskBucket.today => 'Today',
        TaskBucket.tomorrow => 'Tomorrow',
        TaskBucket.later => 'Later',
        TaskBucket.noDate => 'No due date',
        TaskBucket.done => 'Done',
      };
}
