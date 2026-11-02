import 'dart:async';

import '../../data/api/endpoints.dart';
import '../../data/repositories.dart';
import '../../platform/telephony.dart';
import '../offline/write_queue.dart';
import 'call_matching.dart';

/// Turns phone-state events into server reports (D-057, SPEC 29.2):
/// - OFFHOOK: POST /me/calls/active { state: started } ("On call" from dialing; Android does not
///   report when the other side answers an outgoing SIM call);
/// - IDLE: POST /me/calls/active { state: ended }, then read CallLog.Calls for that number and
///   time window and queue POST /me/calls/device-log with a stable deviceCallId;
/// - then look for the phone's own recording of the call and queue its upload.
class CallTracker {
  CallTracker({
    required this.telephony,
    required this.calls,
    required this.queue,
    required this.installId,
    required this.onQueued,
    DateTime Function()? clock,
    this.callLogDelay = const Duration(seconds: 2),
    this.recordingDelay = const Duration(seconds: 8),
    this.matcher = const CallLogMatcher(),
    this.recordingMatcher = const RecordingMatcher(),
  }) : _clock = clock ?? DateTime.now;

  final TelephonyService telephony;
  final CallsRepository calls;
  final WriteQueue queue;
  final String installId;
  final void Function() onQueued;
  final Duration callLogDelay;
  final Duration recordingDelay;
  final CallLogMatcher matcher;
  final RecordingMatcher recordingMatcher;
  final DateTime Function() _clock;

  StreamSubscription<PhoneStateEvent>? _sub;
  ({String number, String? leadId, DateTime at})? _expected;
  ObservedCall? _current;
  final _active = StreamController<ObservedCall?>.broadcast();

  /// The call in progress (for the in-app "On call" banner), null when idle.
  Stream<ObservedCall?> get activeCall => _active.stream;
  ObservedCall? get current => _current;

  Future<void> start() async {
    _sub ??= telephony.events.listen(handle);
    for (final e in await telephony.drainPending()) {
      await handle(e);
    }
  }

  Future<void> stop() async {
    await _sub?.cancel();
    _sub = null;
  }

  /// Called right before the app places a call, so the OFFHOOK event is tied to the lead.
  void expectOutgoing(String number, {String? leadId}) => _expected = (number: number, leadId: leadId, at: _clock().toUtc());

  Future<void> handle(PhoneStateEvent e) async {
    switch (e.state) {
      case 'ringing':
        _current ??= ObservedCall(startedAt: e.at, number: e.number, direction: 'inbound');
      case 'offhook':
        final cur = _current;
        if (cur == null) {
          final exp = _expected;
          final fresh = exp != null && e.at.difference(exp.at).inSeconds.abs() < 120;
          _current = ObservedCall(startedAt: e.at, number: fresh ? exp.number : e.number, direction: 'outbound', leadId: fresh ? exp.leadId : null);
          _expected = null;
        } else {
          cur.answeredAt = e.at;
        }
        _active.add(_current);
        await _report(ActiveCallReport(state: 'started', at: e.at, number: _current!.number, direction: _current!.direction, leadId: _current!.leadId));
      case 'idle':
        final cur = _current;
        if (cur == null) return;
        _current = null;
        cur.endedAt = e.at;
        _active.add(null);
        // A ringing call that was never picked up was never "on call".
        if (cur.direction == 'outbound' || cur.answeredAt != null) {
          await _report(ActiveCallReport(state: 'ended', at: e.at, number: cur.number, direction: cur.direction, leadId: cur.leadId));
        }
        unawaited(_finish(cur));
    }
  }

  Future<void> _report(ActiveCallReport r) async {
    try {
      await calls.reportActive(r);
    } catch (_) {
      // Live status only; the device log below is the record that must arrive.
    }
  }

  Future<DeviceCallRecord> _finish(ObservedCall call) async {
    if (callLogDelay > Duration.zero) await Future<void>.delayed(callLogDelay);
    final end = call.endedAt ?? _clock().toUtc();
    final entries = await telephony.callLog(call.startedAt.subtract(const Duration(minutes: 2)), end.add(const Duration(minutes: 1)));
    final record = matcher.toRecord(matcher.match(entries, call), call, installId: installId);
    await queue.enqueue(kind: WriteKind.deviceCallLog, method: 'POST', path: Endpoints.callsDeviceLog, body: record.toJson(), dedupeKey: 'calllog:${record.deviceCallId}');
    onQueued();
    if (record.durationSec > 0) unawaited(_findRecording(record));
    return record;
  }

  Future<void> _findRecording(DeviceCallRecord record) async {
    if (recordingDelay > Duration.zero) await Future<void>.delayed(recordingDelay);
    final candidates = await telephony.recordings(record.startedAt.subtract(const Duration(seconds: 30)), record.endedAt.add(const Duration(minutes: 10)));
    final pick = recordingMatcher.pick(candidates, record);
    if (pick == null) return;
    final file = await telephony.copyRecording(pick.uri);
    if (file == null) return;
    await queue.enqueue(
      kind: WriteKind.recordingUpload,
      method: 'POST',
      path: Endpoints.deviceCallRecording(record.deviceCallId),
      filePath: file.path,
      body: {'mime': file.mime, 'deviceCallId': record.deviceCallId, 'name': pick.name},
      dedupeKey: 'rec:${record.deviceCallId}',
    );
    onQueued();
  }

  Future<void> dispose() async {
    await stop();
    await _active.close();
  }
}
