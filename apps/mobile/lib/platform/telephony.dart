import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

import '../data/models.dart';

/// Native phone features behind one interface (D-057). Android uses the `vistar/telephony`
/// platform channel; the web preview uses [UnsupportedTelephony] and the UI shows "Android only".
class TelephonyCapabilities {
  const TelephonyCapabilities({
    this.supported = false,
    this.sdkInt = 0,
    this.manufacturer = '',
    this.model = '',
    this.hasTelephony = false,
    this.batteryExempt = false,
    this.monitoring = false,
    this.installId = 'web',
    this.callPhone = false,
    this.readPhoneState = false,
    this.readCallLog = false,
    this.readAudio = false,
  });

  final bool supported;
  final int sdkInt;
  final String manufacturer;
  final String model;
  final bool hasTelephony;
  final bool batteryExempt;
  final bool monitoring;
  final String installId;
  final bool callPhone;
  final bool readPhoneState;
  final bool readCallLog;
  final bool readAudio;

  /// Everything SIM calling needs for live status and exact durations.
  bool get fullCallTracking => callPhone && readPhoneState && readCallLog;

  static TelephonyCapabilities parse(Map<String, dynamic> j) => TelephonyCapabilities(
        supported: true,
        sdkInt: (j['sdkInt'] ?? 0) as int,
        manufacturer: '${j['manufacturer'] ?? ''}',
        model: '${j['model'] ?? ''}',
        hasTelephony: j['hasTelephony'] == true,
        batteryExempt: j['batteryExempt'] == true,
        monitoring: j['monitoring'] == true,
        installId: '${j['installId'] ?? 'android'}',
        callPhone: j['callPhone'] == true,
        readPhoneState: j['readPhoneState'] == true,
        readCallLog: j['readCallLog'] == true,
        readAudio: j['readAudio'] == true,
      );
}

/// ringing | offhook | idle, as reported by TelephonyCallback / PhoneStateListener.
class PhoneStateEvent {
  const PhoneStateEvent({required this.state, required this.at, this.number});
  final String state;
  final DateTime at;
  final String? number;

  static PhoneStateEvent parse(Map<dynamic, dynamic> j) => PhoneStateEvent(
        state: '${j['state'] ?? 'idle'}',
        at: DateTime.fromMillisecondsSinceEpoch(((j['at'] ?? 0) as num).toInt(), isUtc: true),
        number: j['number'] is String && (j['number'] as String).isNotEmpty ? j['number'] as String : null,
      );
}

enum PlaceCallResult { placed, dialer, unsupported, failed }

class CopiedFile {
  const CopiedFile(this.path, this.mime, this.size);
  final String path;
  final String mime;
  final int size;
}

abstract class TelephonyService {
  bool get supported;
  Future<TelephonyCapabilities> capabilities();
  Future<List<SimCard>> sims();
  Future<PlaceCallResult> placeCall(String number, {String? simAccountId});
  Stream<PhoneStateEvent> get events;
  Future<List<PhoneStateEvent>> drainPending();
  Future<bool> startMonitoring({String? title, String? text});
  Future<void> stopMonitoring();
  Future<List<DeviceCallLogEntry>> callLog(DateTime from, DateTime to);
  Future<List<RecordingCandidate>> recordings(DateTime from, DateTime to);
  Future<CopiedFile?> copyRecording(String uri);
  Future<bool> requestBatteryExemption();
}

class ChannelTelephony implements TelephonyService {
  static const _m = MethodChannel('vistar/telephony');
  static const _e = EventChannel('vistar/telephony/events');
  Stream<PhoneStateEvent>? _events;

  @override
  bool get supported => true;

  @override
  Future<TelephonyCapabilities> capabilities() async {
    final r = await _m.invokeMapMethod<String, dynamic>('getCapabilities');
    return TelephonyCapabilities.parse(r ?? const {});
  }

  @override
  Future<List<SimCard>> sims() async {
    final r = await _m.invokeListMethod<Map<dynamic, dynamic>>('getSims') ?? const [];
    return r.map((e) => SimCard.parse(e.cast<String, dynamic>())).toList();
  }

  @override
  Future<PlaceCallResult> placeCall(String number, {String? simAccountId}) async {
    try {
      final r = await _m.invokeMethod<String>('placeCall', {'number': number, 'accountId': simAccountId});
      return r == 'placed' ? PlaceCallResult.placed : PlaceCallResult.dialer;
    } on PlatformException {
      return PlaceCallResult.failed;
    }
  }

  @override
  Stream<PhoneStateEvent> get events =>
      _events ??= _e.receiveBroadcastStream().where((e) => e is Map).map((e) => PhoneStateEvent.parse(e as Map)).asBroadcastStream();

  @override
  Future<List<PhoneStateEvent>> drainPending() async {
    final r = await _m.invokeListMethod<Map<dynamic, dynamic>>('drainPendingEvents') ?? const [];
    return r.map(PhoneStateEvent.parse).toList();
  }

  @override
  Future<bool> startMonitoring({String? title, String? text}) async => await _m.invokeMethod<bool>('startMonitoring', {'title': title, 'text': text}) ?? false;

  @override
  Future<void> stopMonitoring() => _m.invokeMethod<bool>('stopMonitoring');

  @override
  Future<List<DeviceCallLogEntry>> callLog(DateTime from, DateTime to) async {
    try {
      final r = await _m.invokeListMethod<Map<dynamic, dynamic>>('queryCallLog', {'fromMs': from.millisecondsSinceEpoch, 'toMs': to.millisecondsSinceEpoch}) ?? const [];
      return r.map((e) => DeviceCallLogEntry.parse(e.cast<String, dynamic>())).toList();
    } on PlatformException {
      return const [];
    }
  }

  @override
  Future<List<RecordingCandidate>> recordings(DateTime from, DateTime to) async {
    try {
      final r = await _m.invokeListMethod<Map<dynamic, dynamic>>('findRecordings', {'fromMs': from.millisecondsSinceEpoch, 'toMs': to.millisecondsSinceEpoch}) ?? const [];
      return r.map((e) => RecordingCandidate.parse(e.cast<String, dynamic>())).toList();
    } on PlatformException {
      return const [];
    }
  }

  @override
  Future<CopiedFile?> copyRecording(String uri) async {
    try {
      final r = await _m.invokeMapMethod<String, dynamic>('copyRecording', {'uri': uri});
      if (r == null) return null;
      return CopiedFile('${r['path']}', '${r['mime'] ?? 'audio/mpeg'}', ((r['size'] ?? 0) as num).toInt());
    } on PlatformException {
      return null;
    }
  }

  @override
  Future<bool> requestBatteryExemption() async => await _m.invokeMethod<bool>('requestBatteryExemption') ?? false;
}

/// Web preview and tests: no SIM, no call log, no recordings.
class UnsupportedTelephony implements TelephonyService {
  @override
  bool get supported => false;

  @override
  Future<TelephonyCapabilities> capabilities() async => const TelephonyCapabilities();

  @override
  Future<List<SimCard>> sims() async => const [];

  @override
  Future<PlaceCallResult> placeCall(String number, {String? simAccountId}) async => PlaceCallResult.unsupported;

  @override
  Stream<PhoneStateEvent> get events => const Stream.empty();

  @override
  Future<List<PhoneStateEvent>> drainPending() async => const [];

  @override
  Future<bool> startMonitoring({String? title, String? text}) async => false;

  @override
  Future<void> stopMonitoring() async {}

  @override
  Future<List<DeviceCallLogEntry>> callLog(DateTime from, DateTime to) async => const [];

  @override
  Future<List<RecordingCandidate>> recordings(DateTime from, DateTime to) async => const [];

  @override
  Future<CopiedFile?> copyRecording(String uri) async => null;

  @override
  Future<bool> requestBatteryExemption() async => false;
}

bool get isAndroidApp => !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

TelephonyService createTelephony() => isAndroidApp ? ChannelTelephony() : UnsupportedTelephony();
