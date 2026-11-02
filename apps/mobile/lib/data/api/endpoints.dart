/// REST paths, relative to /api/v1 (API_BASE_PATH). Checked against
/// `agent/backend-core:packages/shared/openapi/openapi.json` (contracts 84d590c, 8516977, b302671);
/// keep every path here so a contract fix is one edit.
abstract final class Endpoints {
  // auth and profile
  static const login = '/auth/login';
  static const refresh = '/auth/refresh';
  static const logout = '/auth/logout';
  static const me = '/auth/me';
  static const myToday = '/me/today';
  static const myProfile = '/me/profile';
  static const mySettings = '/me/settings';

  // leads, pipelines, tasks
  static const leads = '/leads';
  static String lead(String id) => '/leads/$id';
  static String leadTimeline(String id) => '/leads/$id/timeline';
  static String leadNotes(String id) => '/leads/$id/notes';
  static String leadMove(String id) => '/leads/$id/move';
  static const pipelines = '/pipelines';
  static const tasks = '/tasks';
  static String task(String id) => '/tasks/$id';
  static String taskSnooze(String id) => '/tasks/$id/snooze';

  // calls (SIM calling, D-057)
  static const calls = '/calls';
  static String call(String id) => '/calls/$id';
  static String callRecording(String callId) => '/calls/$callId/recording';
  static const callsActive = '/me/calls/active';
  static const callsDeviceLog = '/me/calls/device-log';

  // inbox
  static const conversations = '/conversations';
  static String conversation(String id) => '/conversations/$id';
  static String messages(String id) => '/conversations/$id/messages';
  static String conversationRead(String id) => '/conversations/$id/read';
  static const templates = '/templates';
  static const quickReplies = '/quick-replies';

  // notifications
  static const notifications = '/notifications';
  static const notificationsRead = '/notifications/read';

  // live status and office zones (D-062, SPEC 29.2 and 29.11)
  static const myStatus = '/me/status';
  static const myPresence = '/me/presence';
  static const heartbeat = '/me/presence/heartbeat';
  static const zoneSignal = '/me/presence/zone';

  // Team Floor
  static const teamFloorSnapshot = '/team-floor/snapshot';
  static const teamFloorLayout = '/team-floor/layout';

  // attendance and field GPS (D-063)
  static const attendanceToday = '/me/attendance/today';
  static const checkIn = '/me/attendance/check-in';
  static const checkOut = '/me/attendance/check-out';
  static const locations = '/me/location';
  static const trackingConsent = '/me/tracking-consent';

  // app platform (D-058)
  static const appConfig = '/app/config';
  static const androidLatest = '/app/android/latest';
  static const devices = '/me/devices';
}

/// Consent text version the app shows (TRACKING_CONSENT_VERSION). The server sends the current one
/// in `consent.currentVersion`; the app always accepts the version the server asks for.
const trackingConsentVersion = '2026-11-v1';

/// Server error codes the app reacts to.
abstract final class Codes {
  /// Check-in or tracking outside working hours (D-063): stop the location service.
  static const outsideHours = 'OUTSIDE_WORKING_HOURS';
  static const consentRequired = 'TRACKING_CONSENT_REQUIRED';
  static const notFieldStaff = 'NOT_FIELD_STAFF';
  static const featureDisabled = 'FEATURE_DISABLED';
  static const attendanceState = 'ATTENDANCE_STATE_INVALID';
  static const windowClosed = 'WHATSAPP_WINDOW_CLOSED';
  static const optedOut = 'CONSENT_OPTED_OUT';

  /// LocationBatchResult.rejected reasons that mean "stop tracking now".
  static const stopTrackingReasons = {'outside_working_hours', 'not_checked_in', 'tracking_disabled'};
}
