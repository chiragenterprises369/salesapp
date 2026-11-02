import '../core/calls/call_matching.dart';
import 'models.dart';

/// Repository interfaces, one per feature. `Api*Repository` talks to the REST API (with the
/// offline cache for Today, leads and tasks); `Fake*Repository` (lib/demo) backs tests, goldens and
/// the explicit "Demo mode" on the login screen.

/// Data plus where it came from (network or the offline cache).
class Fetched<T> {
  const Fetched(this.data, {this.fromCache = false, this.savedAt});
  final T data;
  final bool fromCache;
  final DateTime? savedAt;
}

abstract class AuthRepository {
  Future<Me> signIn(String email, String password);
  Future<Me?> restore();
  Future<Me> me();
  Future<void> signOut();
}

abstract class TodayRepository {
  Future<Fetched<MyToday>> today();
}

abstract class LeadsRepository {
  Future<Fetched<Page<Lead>>> list(LeadFilters filters, {String? cursor});
  Future<Lead> get(String id);
  Future<List<Activity>> timeline(String id);
  Future<Activity> addNote(String id, String body);
  Future<Lead> moveStage(Lead lead, String stageId);
  Future<List<Pipeline>> pipelines();
  Future<List<Task>> tasksFor(String leadId);
}

abstract class TasksRepository {
  Future<Fetched<List<Task>>> myTasks();

  /// Marks a task done or open again (undo). Queued when offline.
  Future<Task> setDone(Task task, bool done);
  Future<Task> snooze(Task task, DateTime until);
}

class ActiveCallReport {
  const ActiveCallReport({required this.state, required this.at, this.number, this.direction, this.leadId, this.deviceCallId});

  /// started | ended
  final String state;
  final DateTime at;
  final String? number;
  final String? direction;
  final String? leadId;
  final String? deviceCallId;

  Map<String, dynamic> toJson() => {
        'state': state,
        'at': at.toUtc().toIso8601String(),
        'phone': ?toE164(number),
        'direction': ?direction,
        'leadId': ?leadId,
        'deviceCallId': ?deviceCallId,
      };
}

abstract class CallsRepository {
  Future<Page<Call>> recent({String? cursor});
  Future<Call> setOutcome(String callId, {String? outcome, String? notes});

  /// POST /me/calls/active (live "On call" on the Team Floor).
  Future<void> reportActive(ActiveCallReport report);

  /// POST /me/calls/device-log (queued until accepted). Returns the server call id when known.
  Future<String?> uploadDeviceLog(DeviceCallRecord record);

  /// Upload of the phone's own recording file for a device call (queued).
  Future<void> uploadRecording({required String deviceCallId, required String filePath, required String mime});
}

enum InboxFilter { all, unread, needsReply, closed }

abstract class InboxRepository {
  Future<List<Conversation>> conversations({InboxFilter filter = InboxFilter.all, String q = ''});
  Future<Conversation> conversation(String id);
  Future<List<Message>> messages(String conversationId);
  Future<Message> sendText(String conversationId, String body);
  Future<Message> sendTemplate(String conversationId, MessageTemplate template, Map<String, String> variables);
  Future<void> markRead(String conversationId);
  Future<List<MessageTemplate>> templates();
  Future<List<QuickReply>> quickReplies();
}

abstract class TeamFloorRepository {
  Future<TeamFloorSnapshot> snapshot();
  Future<FloorPlan> plan();
}

abstract class AttendanceRepository {
  Future<AttendanceDay> today();
  Future<void> giveConsent();
  Future<AttendanceDay> checkIn(LocationFix? at);
  Future<AttendanceDay> checkOut(LocationFix? at);

  /// Batched location upload. Throws [OutsideWorkingHours] when the server refuses the batch.
  Future<void> uploadLocations(List<LocationFix> points, {required String batchId});
}

class OutsideWorkingHours implements Exception {
  const OutsideWorkingHours();
}

abstract class AccountRepository {
  Future<PresenceStatus> setStatus(PresenceStatus status);
  Future<Me> updateProfile({String? name, String? phone, String? title});
  Future<UserSettings> updateSettings({ThemePreference? theme, bool? push, bool? inApp, String? emailDigest});
  Future<NotificationPage> notifications();
  Future<void> markNotificationsRead({List<String>? ids});
  Future<AppConfig> appConfig();
  Future<void> registerDevice({required String token, required String platform, String? appVersion, String? model, String? installId});
  Future<Performance> performance();
}
