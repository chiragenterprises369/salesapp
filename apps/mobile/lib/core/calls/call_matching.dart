import '../../data/models.dart';

/// Pure logic for SIM calls (D-057): number matching, call-log matching and recording matching.
/// Kept free of platform code so it is unit tested.

/// Digits only, last 10 digits for Indian numbers (drops +91, 0 and spaces).
String phoneKey(String? number) {
  if (number == null) return '';
  final digits = number.replaceAll(RegExp(r'\D'), '');
  return digits.length > 10 ? digits.substring(digits.length - 10) : digits;
}

bool samePhone(String? a, String? b) {
  final ka = phoneKey(a);
  final kb = phoneKey(b);
  return ka.isNotEmpty && ka.length >= 6 && ka == kb;
}

/// Normalise to E.164 for the API (+91XXXXXXXXXX for 10-digit Indian mobiles).
String? toE164(String? input) {
  if (input == null) return null;
  final digits = input.replaceAll(RegExp(r'\D'), '');
  var local = digits;
  if (local.length == 12 && local.startsWith('91')) {
    local = local.substring(2);
  } else if (local.length == 11 && local.startsWith('0')) {
    local = local.substring(1);
  }
  if (RegExp(r'^[6-9]\d{9}$').hasMatch(local)) return '+91$local';
  if (input.trim().startsWith('+') && digits.length >= 7 && digits.length <= 15) return '+$digits';
  return null;
}

/// Result of a finished SIM call, ready for POST /me/calls/device-log.
class DeviceCallRecord {
  const DeviceCallRecord({
    required this.deviceCallId,
    required this.number,
    required this.direction,
    required this.result,
    required this.startedAt,
    required this.durationSec,
    this.leadId,
    this.simAccountId,
    this.callLogId,
    this.durationSource = 'call_log',
  });

  /// call_log (exact, from CallLog.Calls) or phone_state (observed span, call log not readable).
  final String durationSource;

  /// Stable id (install id + call-log row id, or a time-based fallback) so uploads are idempotent.
  final String deviceCallId;
  final String number;

  /// inbound | outbound
  final String direction;

  /// connected | missed | rejected | no_answer | unknown
  final String result;
  final DateTime startedAt;
  final int durationSec;
  final String? leadId;
  final String? simAccountId;
  final String? callLogId;

  DateTime get endedAt => startedAt.add(Duration(seconds: durationSec));

  Map<String, dynamic> toJson() => {
        'deviceCallId': deviceCallId,
        'phone': toE164(number) ?? number,
        'direction': direction,
        'result': result,
        'startedAt': startedAt.toUtc().toIso8601String(),
        'endedAt': endedAt.toUtc().toIso8601String(),
        'durationSec': durationSec,
        'durationSource': durationSource,
        'leadId': ?leadId,
        'simAccountId': ?simAccountId,
      };

  static DeviceCallRecord fromJson(Map<String, dynamic> j) => DeviceCallRecord(
        deviceCallId: j['deviceCallId'] as String,
        number: (j['phone'] ?? '') as String,
        direction: (j['direction'] ?? 'outbound') as String,
        result: (j['result'] ?? 'connected') as String,
        startedAt: DateTime.parse(j['startedAt'] as String).toUtc(),
        durationSec: (j['durationSec'] ?? 0) as int,
        leadId: j['leadId'] as String?,
        simAccountId: j['simAccountId'] as String?,
      );
}

/// One phone-state session as observed by the foreground service.
class ObservedCall {
  ObservedCall({required this.startedAt, this.number, this.direction = 'outbound', this.leadId});

  final DateTime startedAt;
  String? number;
  String direction;
  String? leadId;
  DateTime? answeredAt;
  DateTime? endedAt;
}

class CallLogMatcher {
  const CallLogMatcher({this.slack = const Duration(seconds: 90)});

  /// How far the call-log DATE may be from the observed start.
  final Duration slack;

  /// Picks the call-log row for [call]: same number when we know it, start time within [slack],
  /// the closest one wins. Without a number (incoming on Android 12+) the closest row in the
  /// window is used.
  DeviceCallLogEntry? match(List<DeviceCallLogEntry> entries, ObservedCall call) {
    final windowStart = call.startedAt.subtract(slack);
    final windowEnd = (call.endedAt ?? call.startedAt).add(slack);
    final inWindow = entries.where((e) => !e.date.isBefore(windowStart) && !e.date.isAfter(windowEnd)).toList();
    if (inWindow.isEmpty) return null;
    var pool = call.number == null ? inWindow : inWindow.where((e) => samePhone(e.number, call.number)).toList();
    if (pool.isEmpty) return null;
    if (call.number == null) {
      final dir = call.direction == 'inbound' ? const {'incoming', 'missed', 'rejected'} : const {'outgoing'};
      final typed = pool.where((e) => dir.contains(e.type)).toList();
      if (typed.isNotEmpty) pool = typed;
    }
    pool.sort((a, b) => a.date.difference(call.startedAt).abs().compareTo(b.date.difference(call.startedAt).abs()));
    return pool.first;
  }

  /// Builds the upload record. Outgoing with 0 s = not answered (Android does not report the
  /// answer moment for outgoing SIM calls; the call log duration is the talk time). Without a
  /// call-log row (permission refused) the result is "unknown" and the duration is the observed
  /// off-hook span, marked as such.
  DeviceCallRecord toRecord(DeviceCallLogEntry? entry, ObservedCall call, {required String installId}) {
    if (entry == null) {
      final end = call.endedAt ?? call.startedAt;
      final span = end.difference(call.answeredAt ?? call.startedAt).inSeconds;
      return DeviceCallRecord(
        deviceCallId: '$installId:obs:${call.startedAt.millisecondsSinceEpoch}',
        number: call.number ?? '',
        direction: call.direction,
        result: 'unknown',
        startedAt: call.startedAt,
        durationSec: span < 0 ? 0 : span,
        leadId: call.leadId,
        durationSource: 'phone_state',
      );
    }
    final direction = entry.type == 'outgoing' ? 'outbound' : 'inbound';
    final duration = entry.durationSec;
    final result = switch (entry.type) {
      'missed' => 'missed',
      'rejected' || 'blocked' => 'rejected',
      'outgoing' => duration > 0 ? 'connected' : 'no_answer',
      'incoming' => duration > 0 ? 'connected' : 'missed',
      _ => duration > 0 ? 'connected' : 'missed',
    };
    return DeviceCallRecord(
      deviceCallId: '$installId:log:${entry.id}',
      number: entry.number.isNotEmpty ? entry.number : (call.number ?? ''),
      direction: direction,
      result: result,
      startedAt: entry.date,
      durationSec: duration,
      leadId: call.leadId,
      simAccountId: entry.accountId,
      callLogId: entry.id,
    );
  }
}

/// Picks the phone's own recording of a call from MediaStore candidates (never records itself).
class RecordingMatcher {
  const RecordingMatcher();

  /// Score: OEM recorder folder, file written after the call started and soon after it ended,
  /// number digits or a "call" hint in the name, and a duration close to the call duration.
  RecordingCandidate? pick(List<RecordingCandidate> candidates, DeviceCallRecord call) {
    if (call.durationSec <= 0) return null;
    RecordingCandidate? best;
    var bestScore = 0.0;
    final key = phoneKey(call.number);
    for (final c in candidates) {
      final written = c.modified.isAfter(c.added) ? c.modified : c.added;
      if (written.isBefore(call.startedAt.subtract(const Duration(seconds: 30)))) continue;
      if (written.isAfter(call.endedAt.add(const Duration(minutes: 10)))) continue;
      if (c.size < 1024) continue;
      var score = 0.0;
      if (c.folderMatch) score += 3;
      final name = c.name.toLowerCase();
      if (key.length >= 6 && name.replaceAll(RegExp(r'\D'), '').contains(key.substring(key.length - 6))) score += 3;
      if (name.contains('call') || name.contains('rec')) score += 1;
      if (c.durationMs > 0) {
        final diff = (c.durationMs / 1000 - call.durationSec).abs();
        if (diff <= 5) {
          score += 3;
        } else if (diff <= 20) {
          score += 1.5;
        } else if (diff > 60) {
          score -= 2;
        }
      }
      final gap = written.difference(call.endedAt).inSeconds.abs();
      score += gap <= 30 ? 2 : (gap <= 120 ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    // Require a folder match or a number match plus timing; a random voice note never wins.
    return bestScore >= 5 ? best : null;
  }
}
