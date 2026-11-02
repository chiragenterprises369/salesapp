import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';

import '../data/repositories.dart';
import 'telephony.dart' show isAndroidApp;

/// Office zone signals (SPEC 29.11): BLE beacons per room and the office Wi-Fi access points,
/// read by the Kotlin channel `vistar/zones`. QR markers use the camera scanner screen. The web
/// preview has none of these and shows "Android only".
class ZoneCapabilities {
  const ZoneCapabilities({this.supported = false, this.bluetoothOn = false, this.bleScan = false, this.location = false, this.locationOn = false, this.wifiOn = false});

  final bool supported;
  final bool bluetoothOn;

  /// BLUETOOTH_SCAN (Android 12+) or the legacy Bluetooth permissions.
  final bool bleScan;

  /// ACCESS_FINE_LOCATION (beacons and Wi-Fi scan results need it).
  final bool location;
  final bool locationOn;
  final bool wifiOn;

  bool get canScanBeacons => supported && bluetoothOn && bleScan && location;
  bool get canScanWifi => supported && wifiOn && location && locationOn;

  static ZoneCapabilities parse(Map<String, dynamic> j) => ZoneCapabilities(
        supported: true,
        bluetoothOn: j['bluetoothOn'] == true,
        bleScan: j['bleScan'] == true,
        location: j['location'] == true,
        locationOn: j['locationOn'] == true,
        wifiOn: j['wifiOn'] == true,
      );
}

abstract class ZoneScanner {
  bool get supported;
  Future<ZoneCapabilities> capabilities();

  /// Asks for Bluetooth scan and precise location. True when both are granted.
  Future<bool> requestPermissions();

  /// iBeacon advertisements heard during [window], strongest first.
  Future<List<BeaconReading>> scanBeacons({Duration window = const Duration(seconds: 4)});

  /// Wi-Fi access points from the last scan (Android throttles new scans to 4 per 2 minutes), the
  /// connected one first.
  Future<List<WifiReading>> wifi({bool requestScan = false});
}

class ChannelZoneScanner implements ZoneScanner {
  static const _m = MethodChannel('vistar/zones');

  @override
  bool get supported => true;

  @override
  Future<ZoneCapabilities> capabilities() async {
    try {
      final r = await _m.invokeMapMethod<String, dynamic>('getCapabilities');
      return ZoneCapabilities.parse(r ?? const {});
    } on PlatformException {
      return const ZoneCapabilities(supported: true);
    }
  }

  @override
  Future<bool> requestPermissions() async {
    final res = await [Permission.locationWhenInUse, Permission.bluetoothScan].request();
    return res.values.every((s) => s.isGranted || s.isLimited);
  }

  @override
  Future<List<BeaconReading>> scanBeacons({Duration window = const Duration(seconds: 4)}) async {
    try {
      final r = await _m.invokeListMethod<Map<dynamic, dynamic>>('scanBeacons', {'windowMs': window.inMilliseconds}) ?? const [];
      final list = r.map((e) => BeaconReading.parse(e.cast<String, dynamic>())).toList()..sort((a, b) => b.rssi.compareTo(a.rssi));
      return list;
    } on PlatformException {
      return const [];
    }
  }

  @override
  Future<List<WifiReading>> wifi({bool requestScan = false}) async {
    try {
      final r = await _m.invokeListMethod<Map<dynamic, dynamic>>('wifiScan', {'requestScan': requestScan}) ?? const [];
      return r.map((e) => WifiReading.parse(e.cast<String, dynamic>())).where((w) => _bssid.hasMatch(w.bssid) && w.bssid != '02:00:00:00:00:00').toList();
    } on PlatformException {
      return const [];
    }
  }

  static final _bssid = RegExp(r'^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$');
}

class UnsupportedZoneScanner implements ZoneScanner {
  @override
  bool get supported => false;

  @override
  Future<ZoneCapabilities> capabilities() async => const ZoneCapabilities();

  @override
  Future<bool> requestPermissions() async => false;

  @override
  Future<List<BeaconReading>> scanBeacons({Duration window = const Duration(seconds: 4)}) async => const [];

  @override
  Future<List<WifiReading>> wifi({bool requestScan = false}) async => const [];
}

ZoneScanner createZoneScanner() => isAndroidApp ? ChannelZoneScanner() : UnsupportedZoneScanner();
