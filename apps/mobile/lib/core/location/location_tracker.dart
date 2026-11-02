import 'dart:async';

import '../../data/api/endpoints.dart';
import '../../data/models.dart';
import '../../platform/location.dart';
import '../offline/write_queue.dart';

/// Fired when the server refuses tracking (outside working hours, not checked in, feature off).
final outsideHoursSignal = StreamController<void>.broadcast();

/// Field-staff GPS while checked in and inside working hours (D-063). Points are batched (10 points
/// or every [batchEvery]) into the offline write queue as POST /me/location (max 500 points per
/// batch). The server rejects points outside working hours; the runtime then stops this tracker.
class LocationTracker {
  LocationTracker({
    required this.location,
    required this.queue,
    required this.onQueued,
    this.onPoint,
    this.batchSize = 10,
    this.batchEvery = const Duration(minutes: 2),
    this.interval = const Duration(seconds: 120),
    this.minAccuracyM = 150,
  });

  final LocationService location;
  final WriteQueue queue;
  final void Function() onQueued;

  /// Every accepted fix (the Attendance screen draws today's trail from these).
  final void Function(LocationFix fix)? onPoint;
  final int batchSize;
  final Duration batchEvery;

  /// Sampling interval (MyAttendanceToday.locationIntervalSec).
  final Duration interval;

  /// Fixes worse than this are dropped (indoor cell-tower guesses).
  final double minAccuracyM;

  static const maxBatch = 500;

  StreamSubscription<LocationFix>? _sub;
  Timer? _timer;
  final _buffer = <LocationFix>[];
  int _batch = 0;

  bool get running => _sub != null;

  void start({String title = 'Vistar field visit tracking', String text = 'Location is shared with your company only while you are checked in.'}) {
    if (running || !location.canTrack) return;
    _sub = location.track(notificationTitle: title, notificationText: text, interval: interval).listen(add, onError: (_) {});
    _timer = Timer.periodic(batchEvery, (_) => flushBuffer());
  }

  void add(LocationFix fix) {
    if (fix.accuracy > minAccuracyM) return;
    _buffer.add(fix);
    onPoint?.call(fix);
    if (_buffer.length >= batchSize) unawaited(flushBuffer());
  }

  Future<void> flushBuffer() async {
    while (_buffer.isNotEmpty) {
      final points = _buffer.take(maxBatch).toList();
      _buffer.removeRange(0, points.length);
      final id = 'loc-${points.first.at.millisecondsSinceEpoch}-${_batch++}';
      await queue.enqueue(
        kind: WriteKind.locationBatch,
        method: 'POST',
        path: Endpoints.locations,
        body: {'points': points.map((p) => p.toJson()).toList()},
        dedupeKey: id,
      );
    }
    onQueued();
  }

  Future<void> stop({bool flush = true}) async {
    _timer?.cancel();
    _timer = null;
    await _sub?.cancel();
    _sub = null;
    if (flush) {
      await flushBuffer();
    } else {
      _buffer.clear();
    }
  }
}
