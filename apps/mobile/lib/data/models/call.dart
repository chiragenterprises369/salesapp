import '../json.dart';
import 'user.dart';

const callOutcomeLabels = {
  'answered': 'Answered',
  'interested': 'Interested',
  'not_interested': 'Not interested',
  'callback': 'Call back',
  'missed': 'Missed',
  'wrong_number': 'Wrong number',
  'voicemail': 'Voicemail',
};

class Call {
  const Call({
    required this.id,
    required this.direction,
    required this.status,
    this.outcome,
    this.leadId,
    this.leadName,
    this.user,
    required this.from,
    required this.to,
    required this.startedAt,
    this.endedAt,
    required this.durationSec,
    required this.hasRecording,
    this.notes,
    this.provider = 'sim',
    this.source = 'sim',
    this.result,
    this.phone,
    this.deviceCallId,
  });

  final String id;
  final String direction;
  final String status;
  final String? outcome;
  final String? leadId;
  final String? leadName;
  final UserSummary? user;
  final String from;
  final String to;
  final DateTime startedAt;
  final DateTime? endedAt;
  final int durationSec;
  final bool hasRecording;
  final String? notes;
  final String provider;

  /// sim | voip | mock
  final String source;

  /// connected | missed | no_answer | busy | rejected | failed (device call log)
  final String? result;

  /// The other party, normalised (+91...); from/to may be empty for SIM calls.
  final String? phone;
  final String? deviceCallId;

  bool get isMissed => status == 'missed' || outcome == 'missed' || result == 'missed';
  bool get notConnected => result != null && result != 'connected';
  bool get isInbound => direction == 'inbound';
  String get otherNumber => phone ?? (isInbound ? from : to);
  String get displayName => leadName ?? otherNumber;
  String? get outcomeLabel => outcome == null ? null : callOutcomeLabels[outcome] ?? outcome;

  static Call parse(Json j) => Call(
        id: str(j['id']),
        direction: str(j['direction'], 'outbound'),
        status: str(j['status'], 'completed'),
        outcome: strOrNull(j['outcome']),
        leadId: strOrNull(j['leadId']),
        leadName: strOrNull(j['leadName']),
        user: UserSummary.parseOrNull(j['user']),
        from: str(j['from']),
        to: str(j['to']),
        startedAt: date(j['startedAt']) ?? DateTime.now().toUtc(),
        endedAt: date(j['endedAt']),
        durationSec: toInt(j['durationSec']),
        hasRecording: toBool(j['hasRecording']),
        notes: strOrNull(j['notes']),
        provider: str(j['provider'], 'sim'),
        source: str(j['source'], 'sim'),
        result: strOrNull(j['result']),
        phone: strOrNull(j['phone']),
        deviceCallId: strOrNull(j['deviceCallId']),
      );
}

const callResultLabels = {
  'connected': 'Connected',
  'missed': 'Missed',
  'no_answer': 'No answer',
  'busy': 'Busy',
  'rejected': 'Rejected',
  'failed': 'Failed',
};

/// A row read from the phone's CallLog.Calls (Android only).
class DeviceCallLogEntry {
  const DeviceCallLogEntry({required this.id, required this.number, required this.type, required this.date, required this.durationSec, this.accountId});

  final String id;
  final String number;

  /// incoming | outgoing | missed | rejected | blocked | voicemail | unknown
  final String type;
  final DateTime date;
  final int durationSec;
  final String? accountId;

  static DeviceCallLogEntry parse(Json j) => DeviceCallLogEntry(
        id: str(j['id']),
        number: str(j['number']),
        type: str(j['type'], 'unknown'),
        date: DateTime.fromMillisecondsSinceEpoch(toInt(j['dateMs']), isUtc: true),
        durationSec: toInt(j['durationSec']),
        accountId: strOrNull(j['accountId']),
      );
}

/// An audio file in the phone's own recorder folders (MediaStore).
class RecordingCandidate {
  const RecordingCandidate({
    required this.uri,
    required this.name,
    required this.path,
    required this.size,
    required this.added,
    required this.modified,
    required this.durationMs,
    required this.mime,
    required this.folderMatch,
  });

  final String uri;
  final String name;
  final String path;
  final int size;
  final DateTime added;
  final DateTime modified;
  final int durationMs;
  final String mime;
  final bool folderMatch;

  static RecordingCandidate parse(Json j) => RecordingCandidate(
        uri: str(j['uri']),
        name: str(j['name']),
        path: str(j['path']),
        size: toInt(j['size']),
        added: DateTime.fromMillisecondsSinceEpoch(toInt(j['addedMs']), isUtc: true),
        modified: DateTime.fromMillisecondsSinceEpoch(toInt(j['modifiedMs']), isUtc: true),
        durationMs: toInt(j['durationMs']),
        mime: str(j['mime'], 'audio/mpeg'),
        folderMatch: toBool(j['folderMatch']),
      );
}

class SimCard {
  const SimCard({required this.accountId, required this.slot, required this.label, this.number});
  final String accountId;
  final int slot;
  final String label;
  final String? number;

  static SimCard parse(Json j) => SimCard(accountId: str(j['accountId']), slot: toInt(j['slot']), label: str(j['label'], 'SIM'), number: strOrNull(j['number']));
}
