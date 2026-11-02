import '../json.dart';
import 'user.dart';

const whatsappWindowHours = 24;

class Conversation {
  const Conversation({
    required this.id,
    required this.contactName,
    required this.contactPhone,
    this.leadId,
    this.assignee,
    required this.status,
    required this.unreadCount,
    this.lastMessagePreview,
    this.lastMessageAt,
    this.lastInboundAt,
    this.windowExpiresAt,
    this.optIn,
  });

  final String id;
  final String contactName;
  final String contactPhone;
  final String? leadId;
  final UserSummary? assignee;
  final String status;
  final int unreadCount;
  final String? lastMessagePreview;
  final DateTime? lastMessageAt;
  final DateTime? lastInboundAt;
  final DateTime? windowExpiresAt;
  final String? optIn;

  /// Free-form messages are allowed only inside the 24 h customer-service window.
  bool windowOpen(DateTime now) => windowExpiresAt != null && windowExpiresAt!.isAfter(now);

  Duration? windowLeft(DateTime now) => windowOpen(now) ? windowExpiresAt!.difference(now) : null;

  bool get optedOut => optIn == 'opted_out';

  static Conversation parse(Json j) {
    final lastInbound = date(j['lastInboundAt']);
    return Conversation(
      id: str(j['id']),
      contactName: str(j['contactName'], 'Unknown'),
      contactPhone: str(j['contactPhone']),
      leadId: strOrNull(j['leadId']),
      assignee: UserSummary.parseOrNull(j['assignee']),
      status: str(j['status'], 'open'),
      unreadCount: toInt(j['unreadCount']),
      lastMessagePreview: strOrNull(j['lastMessagePreview']),
      lastMessageAt: date(j['lastMessageAt']),
      lastInboundAt: lastInbound,
      windowExpiresAt: date(j['windowExpiresAt']) ?? lastInbound?.add(const Duration(hours: whatsappWindowHours)),
      optIn: strOrNull(j['optIn']),
    );
  }

  Conversation copyWith({int? unreadCount, String? lastMessagePreview, DateTime? lastMessageAt}) => Conversation(
        id: id,
        contactName: contactName,
        contactPhone: contactPhone,
        leadId: leadId,
        assignee: assignee,
        status: status,
        unreadCount: unreadCount ?? this.unreadCount,
        lastMessagePreview: lastMessagePreview ?? this.lastMessagePreview,
        lastMessageAt: lastMessageAt ?? this.lastMessageAt,
        lastInboundAt: lastInboundAt,
        windowExpiresAt: windowExpiresAt,
        optIn: optIn,
      );
}

/// queued | sent | delivered | read | failed
class Message {
  const Message({
    required this.id,
    required this.conversationId,
    required this.direction,
    required this.type,
    this.body,
    this.templateName,
    required this.status,
    this.error,
    required this.isInternalNote,
    this.author,
    required this.createdAt,
  });

  final String id;
  final String conversationId;
  final String direction;
  final String type;
  final String? body;
  final String? templateName;
  final String status;
  final String? error;
  final bool isInternalNote;
  final UserSummary? author;
  final DateTime createdAt;

  bool get isOutbound => direction == 'outbound';

  static Message parse(Json j) => Message(
        id: str(j['id']),
        conversationId: str(j['conversationId']),
        direction: str(j['direction'], 'inbound'),
        type: str(j['type'], 'text'),
        body: strOrNull(j['body']),
        templateName: strOrNull(j['templateName']),
        status: str(j['status'], 'sent'),
        error: strOrNull(j['error']),
        isInternalNote: toBool(j['isInternalNote']),
        author: UserSummary.parseOrNull(j['author']),
        createdAt: date(j['createdAt']) ?? DateTime.now().toUtc(),
      );

  Message copyWith({String? status, String? id}) => Message(
        id: id ?? this.id,
        conversationId: conversationId,
        direction: direction,
        type: type,
        body: body,
        templateName: templateName,
        status: status ?? this.status,
        error: error,
        isInternalNote: isInternalNote,
        author: author,
        createdAt: createdAt,
      );
}

class MessageTemplate {
  const MessageTemplate({required this.id, required this.name, required this.category, required this.status, required this.body, required this.variables});

  final String id;
  final String name;
  final String category;
  final String status;
  final String body;
  final List<String> variables;

  bool get approved => status == 'approved';

  /// "welcome_indiamart_v1" -> "Welcome indiamart v1"
  String get displayName {
    final s = name.replaceAll('_', ' ').trim();
    return s.isEmpty ? name : s[0].toUpperCase() + s.substring(1);
  }

  static MessageTemplate parse(Json j) => MessageTemplate(
        id: str(j['id']),
        name: str(j['name']),
        category: str(j['category'], 'utility'),
        status: str(j['status'], 'approved'),
        body: str(j['body']),
        variables: strings(j['variables']),
      );
}

class QuickReply {
  const QuickReply({required this.id, required this.shortcut, required this.body});
  final String id;
  final String shortcut;
  final String body;

  static QuickReply parse(Json j) => QuickReply(id: str(j['id']), shortcut: str(j['shortcut']), body: str(j['body']));
}
