import 'dart:async';

import 'package:geolocator/geolocator.dart';

import '../data/models.dart';
import 'telephony.dart' show isAndroidApp;

enum LocationAccess { granted, denied, deniedForever, serviceOff, unsupported }

/// GPS for field staff (D-063). On Android the stream runs inside geolocator's location
/// foreground service (notification shown) and only while checked in inside working hours.
abstract class LocationService {
  /// Background tracking (foreground service). False in the web preview.
  bool get canTrack;
  Future<LocationAccess> access({bool request = false});
  Future<LocationFix?> current();
  Stream<LocationFix> track({required String notificationTitle, required String notificationText});
}

class GeoLocationService implements LocationService {
  @override
  bool get canTrack => isAndroidApp;

  @override
  Future<LocationAccess> access({bool request = false}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return LocationAccess.serviceOff;
      var p = await Geolocator.checkPermission();
      if (p == LocationPermission.denied && request) p = await Geolocator.requestPermission();
      return switch (p) {
        LocationPermission.always || LocationPermission.whileInUse => LocationAccess.granted,
        LocationPermission.deniedForever => LocationAccess.deniedForever,
        LocationPermission.unableToDetermine => LocationAccess.unsupported,
        LocationPermission.denied => LocationAccess.denied,
      };
    } catch (_) {
      return LocationAccess.unsupported;
    }
  }

  @override
  Future<LocationFix?> current() async {
    if (await access(request: true) != LocationAccess.granted) return null;
    try {
      final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 20)));
      return _fix(p);
    } catch (_) {
      try {
        final last = await Geolocator.getLastKnownPosition();
        return last == null ? null : _fix(last);
      } catch (_) {
        return null;
      }
    }
  }

  @override
  Stream<LocationFix> track({required String notificationTitle, required String notificationText}) {
    if (!canTrack) return const Stream.empty();
    final settings = AndroidSettings(
      accuracy: LocationAccuracy.high,
      distanceFilter: 40,
      intervalDuration: const Duration(seconds: 60),
      foregroundNotificationConfig: ForegroundNotificationConfig(
        notificationTitle: notificationTitle,
        notificationText: notificationText,
        notificationChannelName: 'Field visit tracking',
        enableWakeLock: true,
        setOngoing: true,
        notificationIcon: const AndroidResource(name: 'ic_stat_vistar', defType: 'drawable'),
      ),
    );
    return Geolocator.getPositionStream(locationSettings: settings).map(_fix);
  }

  static LocationFix _fix(Position p) => LocationFix(lat: p.latitude, lng: p.longitude, accuracy: p.accuracy, at: p.timestamp.toUtc(), speed: p.speed >= 0 ? p.speed : null);
}
