import 'package:intl/intl.dart';

/// Formatting shared by every screen. Mirrors packages/shared/src/format.ts (locale en-IN).
final _inrFull = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);
final _oneDecimal = NumberFormat('#,##0.#', 'en_IN');
final _grouped = NumberFormat.decimalPattern('en_IN');

/// ₹1,23,456 or compact ₹950, ₹12.5K, ₹4.2L, ₹1.3Cr.
String formatInr(num value, {bool compact = false}) {
  if (!compact) return _inrFull.format(value);
  final abs = value.abs();
  final sign = value < 0 ? '-' : '';
  if (abs >= 1e7) return '$sign₹${_oneDecimal.format(abs / 1e7)}Cr';
  if (abs >= 1e5) return '$sign₹${_oneDecimal.format(abs / 1e5)}L';
  if (abs >= 1e3) return '$sign₹${_oneDecimal.format(abs / 1e3)}K';
  return _inrFull.format(value);
}

String formatNumber(num value) => _grouped.format(value);

/// Seconds to m:ss or h:mm:ss.
String formatDuration(int totalSec) {
  final s = totalSec < 0 ? 0 : totalSec;
  final h = s ~/ 3600;
  final m = (s % 3600) ~/ 60;
  final sec = s % 60;
  String pad(int n) => n.toString().padLeft(2, '0');
  return h > 0 ? '$h:${pad(m)}:${pad(sec)}' : '$m:${pad(sec)}';
}

/// "1h 20m", "45m", "30s" for talk time and attendance totals.
String formatSpan(Duration d) {
  final h = d.inHours;
  final m = d.inMinutes % 60;
  if (h > 0) return m > 0 ? '${h}h ${m}m' : '${h}h';
  if (d.inMinutes > 0) return '${d.inMinutes}m';
  return '${d.inSeconds}s';
}

/// "Priya Sharma" -> "PS", "anil" -> "AN".
String initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first.substring(0, parts.first.length >= 2 ? 2 : 1).toUpperCase();
  return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
}

/// +919876543210 -> +91 98765 43210 (other numbers unchanged).
String formatPhone(String? e164) {
  if (e164 == null || e164.isEmpty) return 'No number';
  final m = RegExp(r'^\+91(\d{5})(\d{5})$').firstMatch(e164);
  return m == null ? e164 : '+91 ${m[1]} ${m[2]}';
}

/// "just now", "5 min ago", "3 h ago", "2 days ago".
String timeAgo(DateTime at, DateTime now) {
  final d = now.difference(at);
  if (d.inSeconds < 45) return 'just now';
  if (d.inMinutes < 60) return '${d.inMinutes} min ago';
  if (d.inHours < 24) return '${d.inHours} h ago';
  final days = d.inDays;
  return days == 1 ? 'yesterday' : '$days days ago';
}

/// "Overdue 2 days", "Overdue 3 h", "Overdue 20 min".
String overdueLabel(DateTime due, DateTime now) {
  final d = now.difference(due);
  if (d.inDays >= 1) return 'Overdue ${d.inDays} ${d.inDays == 1 ? 'day' : 'days'}';
  if (d.inHours >= 1) return 'Overdue ${d.inHours} h';
  return 'Overdue ${d.inMinutes < 1 ? 1 : d.inMinutes} min';
}
