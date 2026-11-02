import 'package:intl/intl.dart';
import 'package:timezone/data/latest_10y.dart' as tzdata;
import 'package:timezone/timezone.dart' as tz;

bool _tzReady = false;

/// Loads the IANA zone database once (bundled in the app; no network).
void ensureTimeZones() {
  if (_tzReady) return;
  tzdata.initializeTimeZones();
  _tzReady = true;
}

/// The workspace timezone (SPEC 4.2: schedules and working hours use the WORKSPACE timezone).
tz.Location zone(String name) {
  ensureTimeZones();
  try {
    return tz.getLocation(name);
  } catch (_) {
    try {
      return tz.getLocation('Asia/Kolkata');
    } catch (_) {
      return tz.UTC;
    }
  }
}

tz.TZDateTime inZone(DateTime utc, String timezone) => tz.TZDateTime.from(utc, zone(timezone));

/// Calendar day key YYYY-MM-DD in the workspace timezone.
String dayKey(DateTime utc, String timezone) {
  final d = inZone(utc, timezone);
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// Start of the calendar day (workspace timezone) as UTC.
DateTime startOfDay(DateTime utc, String timezone, {int addDays = 0}) {
  final d = inZone(utc, timezone);
  return tz.TZDateTime(zone(timezone), d.year, d.month, d.day + addDays).toUtc();
}

String formatTime(DateTime utc, String timezone) => DateFormat('h:mm a').format(inZone(utc, timezone)).toLowerCase();

String formatDayTime(DateTime utc, String timezone) => DateFormat('d MMM, h:mm a').format(inZone(utc, timezone));

String formatDay(DateTime utc, String timezone) => DateFormat('EEEE, d MMMM').format(inZone(utc, timezone));

String formatShortDay(DateTime utc, String timezone) => DateFormat('EEE d').format(inZone(utc, timezone));

/// "Good morning" / "Good afternoon" / "Good evening" for the local hour of the workspace.
String greeting(DateTime utc, String timezone) {
  final h = inZone(utc, timezone).hour;
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
