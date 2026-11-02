/// REST paths (relative to /api/v1). The change #19 routes follow the platform and realtime
/// streams' contracts (contracts-19.md); keep every path here so a contract fix is one edit.
abstract final class Endpoints {
  // existing contracts (packages/shared/openapi/openapi.json)
  static const login = '/auth/login';
  static const me = '/auth/me';
  static const myToday = '/me/today';
  static const myStatus = '/me/status';
  static const myProfile = '/me/profile';
  static const mySettings = '/me/settings';
  static const leads = '/leads';
  static String lead(String id) => '/leads/$id';
  static String leadTimeline(String id) => '/leads/$id/timeline';
  static String leadNotes(String id) => '/leads/$id/notes';
  static String leadMove(String id) => '/leads/$id/move';
  static const pipelines = '/pipelines';
  static const tasks = '/tasks';
  static String task(String id) => '/tasks/$id';
  static String taskSnooze(String id) => '/tasks/$id/snooze';
  static const calls = '/calls';
  static String call(String id) => '/calls/$id';
  static const conversations = '/conversations';
  static String conversation(String id) => '/conversations/$id';
  static String messages(String id) => '/conversations/$id/messages';
  static String conversationRead(String id) => '/conversations/$id/read';
  static const templates = '/templates';
  static const quickReplies = '/quick-replies';
  static const notifications = '/notifications';
  static const notificationsRead = '/notifications/read';
  static const teamFloorSnapshot = '/team-floor/snapshot';

  // change #19 (SPEC 29, D-057, D-058, D-061, D-063)
  static const appConfig = '/app/config';
  static const devices = '/me/devices';
  static const callsActive = '/me/calls/active';
  static const callsDeviceLog = '/me/calls/device-log';
  static String deviceCallRecording(String deviceCallId) => '/me/calls/device-log/${Uri.encodeComponent(deviceCallId)}/recording';
  static const attendanceToday = '/me/attendance';
  static const attendanceConsent = '/me/attendance/consent';
  static const checkIn = '/me/attendance/check-in';
  static const checkOut = '/me/attendance/check-out';
  static const locations = '/me/locations';
  static const teamFloorPlan = '/team-floor/floor';
}

/// Server error codes the app reacts to.
abstract final class Codes {
  /// Location or tracking outside working hours (D-063): stop the location service.
  static const outsideHours = {'OUTSIDE_WORKING_HOURS', 'ATTENDANCE_OUTSIDE_HOURS', 'LOCATION_OUTSIDE_HOURS', 'TRACKING_OUTSIDE_HOURS'};
  static const windowClosed = 'WHATSAPP_WINDOW_CLOSED';
  static const optedOut = 'CONSENT_OPTED_OUT';
}
