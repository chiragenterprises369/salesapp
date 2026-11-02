import '../data/models.dart';

/// In-memory demo company for tests, goldens and the explicit "Demo mode" on the login screen
/// (off by default; normal use reads the real API only). Everything is relative to [now] so the
/// screens always look current, and deterministic so goldens are stable.
class DemoWorld {
  DemoWorld({DateTime? now, this.brandColor}) : now = (now ?? DateTime.now()).toUtc() {
    _build();
  }

  final DateTime now;

  /// Company brand colour (goldens render two brands); null = Vistar indigo.
  final String? brandColor;

  static String _coarse(String presence) => switch (presence) {
        'on_call' => 'on_call',
        'available' => 'idle',
        'offline' => 'offline',
        'away' || 'on_break' || 'lunch' => 'away',
        _ => 'busy',
      };

  static const userId = '0190a000-0000-7000-8000-000000000001';
  static const workspaceId = '0190a000-0000-7000-8000-0000000000aa';
  static const pipelineId = '0190a000-0000-7000-8000-0000000000bb';

  late Json me;
  late List<Json> stages;
  late List<Json> leads;
  late List<Json> tasks;
  late List<Json> calls;
  late List<Json> conversations;
  late Map<String, List<Json>> messages;
  late List<Json> notifications;
  late List<Json> team;
  late List<Json> templates;
  late List<Json> quickReplies;
  late Map<String, List<Json>> timelines;
  late Json attendance;
  PresenceStatus myStatus = PresenceStatus.available;
  int _seq = 1000;

  String nextId() => '0190a000-0000-7000-8000-${(_seq++).toString().padLeft(12, '0')}';

  String _t(Duration offset) => now.add(offset).toIso8601String();
  String _ago({int days = 0, int hours = 0, int minutes = 0}) => _t(-Duration(days: days, hours: hours, minutes: minutes));
  String _in({int days = 0, int hours = 0, int minutes = 0}) => _t(Duration(days: days, hours: hours, minutes: minutes));

  Json get meUserSummary => {'id': userId, 'name': 'Anil Kumar', 'role': 'employee', 'status': myStatus.wire, 'avatar': null};

  static const _people = [
    ('Kavita Reddy', 'Reddy Pharma Distributors', 'Hyderabad', '+919845012345'),
    ('Rajesh Tiwari', 'Tiwari Steel Traders', 'Lucknow', '+919839045678'),
    ('Divya Khan', 'Supreme Traders', 'Bhopal', '+919826011223'),
    ('Gurpreet Mishra', 'Punjab Agro Industries', 'Ludhiana', '+919814098765'),
    ('Pooja Jain', 'Navkar Enterprises', 'Surat', '+919825033445'),
    ('Shalini Iyer', 'Trident Traders', 'Chennai', '+919840066778'),
    ('Mohit Agarwal', 'Shakti Pharma Distributors', 'Jaipur', '+919829011122'),
    ('Divya Kapoor', 'Vardhman Textiles', 'Ludhiana', '+919815022233'),
    ('Harpreet Mishra', 'Apex Textiles', 'Amritsar', '+919814555666'),
    ('Ramesh Shah', 'Balaji Industries', 'Ahmedabad', '+919824077889'),
    ('Harish Bansal', 'Bansal Polymers', 'Delhi', '+919811033221'),
    ('Shalini Mishra', 'Mishra Packaging', 'Kanpur', '+919839088776'),
    ('Arjun Nair', 'Kerala Spices Co', 'Kochi', '+919847012121'),
    ('Imran Banerjee', 'Bengal Hardware Mart', 'Kolkata', '+919830045454'),
    ('Lakshmi Nair', 'Lakshmi Fabrics', 'Coimbatore', '+919843012390'),
    ('Prakash Jain', 'Jain Pipes and Fittings', 'Indore', '+919826077665'),
    ('Kavita Menon', 'Menon Electricals', 'Bengaluru', '+919845099887'),
    ('Sanjay Gupta', 'Gupta Chemicals', 'Vadodara', '+919825012876'),
    ('Neha Verma', 'Verma Foods', 'Nagpur', '+919822034567'),
    ('Vikram Singh', 'Rajputana Marbles', 'Udaipur', '+919829076543'),
    ('Anjali Deshpande', 'Deshpande Auto Parts', 'Pune', '+919822011199'),
    ('Rohan Malhotra', 'Malhotra Exports', 'Noida', '+919810066554'),
    ('Sunita Patel', 'Patel Ceramics', 'Morbi', '+919824088990'),
    ('Farhan Qureshi', 'Qureshi Leather Works', 'Kanpur', '+919839011234'),
  ];

  static const _products = ['SS pipes 2 inch', 'GI sheets 0.5 mm', 'PVC conduits', 'Copper wire 4 sq mm', 'MS angles', 'HDPE tanks', 'Aluminium sections', 'Packaging film'];
  static const _sources = ['indiamart', 'website', 'whatsapp', 'indiamart', 'manual', 'indiamart', 'webhook', 'website'];
  static const _temps = ['hot', 'warm', 'cold', 'warm', 'hot', 'warm'];

  void _build() {
    stages = [
      {'id': 'st-new', 'pipelineId': pipelineId, 'key': 'new', 'name': 'New', 'type': 'open', 'order': 0, 'color': '#6366F1', 'probability': 5},
      {'id': 'st-contacted', 'pipelineId': pipelineId, 'key': 'contacted', 'name': 'Contacted', 'type': 'open', 'order': 1, 'color': '#0EA5E9', 'probability': 15},
      {'id': 'st-interested', 'pipelineId': pipelineId, 'key': 'interested', 'name': 'Interested', 'type': 'open', 'order': 2, 'color': '#10B981', 'probability': 35},
      {'id': 'st-quote', 'pipelineId': pipelineId, 'key': 'quote_sent', 'name': 'Quote sent', 'type': 'open', 'order': 3, 'color': '#F59E0B', 'probability': 60},
      {'id': 'st-won', 'pipelineId': pipelineId, 'key': 'won', 'name': 'Won', 'type': 'won', 'order': 4, 'color': '#22C55E', 'probability': 100},
      {'id': 'st-lost', 'pipelineId': pipelineId, 'key': 'lost', 'name': 'Lost', 'type': 'lost', 'order': 5, 'color': '#94A3B8', 'probability': 0},
    ];
    const stageCycle = ['st-new', 'st-contacted', 'st-interested', 'st-quote', 'st-new', 'st-contacted', 'st-interested', 'st-won', 'st-quote', 'st-lost'];

    leads = [
      for (var i = 0; i < _people.length; i++)
        {
          'id': 'lead-${i.toString().padLeft(2, '0')}',
          'name': _people[i].$1,
          'companyName': _people[i].$2,
          'phone': _people[i].$4,
          'email': '${_people[i].$1.split(' ').first.toLowerCase()}@${_people[i].$2.split(' ').first.toLowerCase()}.in',
          'city': _people[i].$3,
          'state': null,
          'source': _sources[i % _sources.length],
          'pipelineId': pipelineId,
          'stageId': stageCycle[i % stageCycle.length],
          'position': 'a$i',
          'owner': meUserSummary,
          'valueInr': [185000, 92000, 450000, 38000, 1250000, 64000, 275000, 820000, 145000, 56000][i % 10],
          'score': [86, 72, 64, 41, 93, 58, 77, 69, 35, 81][i % 10],
          'temperature': _temps[i % _temps.length],
          'tags': [if (i % 3 == 0) 'Repeat buyer', if (i % 4 == 1) 'GST invoice', if (i % 5 == 2) 'Bulk'],
          'nextFollowUpAt': i < 8 ? _ago(hours: 2 + i * 7) : (i < 14 ? _in(days: i - 7, hours: 2) : null),
          'lastActivityAt': _ago(hours: 3 + i * 5),
          'version': 3 + i,
          'createdAt': i < 5 ? _ago(hours: 2 + i * 4) : _ago(days: 2 + i),
          'updatedAt': _ago(hours: 1 + i),
          'productInterest': _products[i % _products.length],
          'requirement': i % 2 == 0
              ? 'Need ${_products[i % _products.length]} for a new site. Please share best price with GST and delivery time.'
              : 'Asked for a quote on ${_products[i % _products.length]}, ${(i + 2) * 50} units.',
          'sourceRef': null,
          'scoreBreakdown': [],
          'customFields': {'quantity': (i + 2) * 50, 'preferred_language': i % 2 == 0 ? 'Hindi' : 'English'},
          'stageType': stageCycle[i % stageCycle.length] == 'st-won' ? 'won' : (stageCycle[i % stageCycle.length] == 'st-lost' ? 'lost' : 'open'),
          'whatsappOptIn': i % 3 != 2,
          'dnd': false,
          'contactId': null,
          'companyId': null,
          'mergedIntoId': null,
        },
    ];

    Json task(int i, String type, String title, String? notes, String priority, Duration due, int lead) => {
          'id': 'task-${i.toString().padLeft(2, '0')}',
          'type': type,
          'title': title,
          'notes': notes,
          'status': 'open',
          'priority': priority,
          'leadId': leads[lead]['id'],
          'leadName': leads[lead]['name'],
          'leadPhone': leads[lead]['phone'],
          'assignee': meUserSummary,
          'dueAt': now.add(due).toIso8601String(),
          'remindAt': null,
          'snoozedUntil': null,
          'completedAt': null,
          'source': i % 3 == 0 ? 'workflow' : 'manual',
          'workflowRunId': null,
          'customFields': {},
          'createdAt': _ago(days: 1),
          'updatedAt': _ago(hours: 2),
        };

    tasks = [
      task(1, 'call', 'Call Kavita Reddy (no reply on WhatsApp)', 'Asked for price on SS pipes 2 inch', 'high', const Duration(hours: -26), 0),
      task(2, 'call', 'Call Rajesh Tiwari about the quote', 'Prefers a call after 4 pm', 'urgent', const Duration(hours: -5), 1),
      task(3, 'call', 'Call Divya Khan', 'Comparing with two other suppliers, price is the main factor', 'high', const Duration(minutes: -40), 2),
      task(4, 'follow_up', 'Discuss quote with Gurpreet Mishra', null, 'normal', const Duration(hours: 1, minutes: 30), 3),
      task(5, 'call', 'Call Pooja Jain about GST invoice', 'Wants the invoice before dispatch', 'normal', const Duration(hours: 3), 4),
      task(6, 'meeting', 'Site visit at Navkar Enterprises', 'Bring HDPE tank samples', 'high', const Duration(hours: 5), 4),
      task(7, 'todo', 'Send revised price list to Shalini Iyer', null, 'normal', const Duration(hours: 6), 5),
      task(8, 'email', 'Email catalogue to Mohit Agarwal', null, 'low', const Duration(days: 1, hours: 2), 6),
      task(9, 'call', 'Call back Ramesh Shah', 'Missed call this morning', 'normal', const Duration(days: 1, hours: 4), 9),
      task(10, 'follow_up', 'Follow up on PO from Arjun Nair', null, 'high', const Duration(days: 2), 12),
      task(11, 'todo', 'Update delivery date for Vardhman Textiles', null, 'low', const Duration(days: 4), 7),
    ];

    Json call(int i, String direction, String status, String? outcome, int lead, int durationSec, Duration ago, {bool rec = false}) {
      final started = now.subtract(ago);
      return {
        'id': 'call-${i.toString().padLeft(2, '0')}',
        'direction': direction,
        'status': status,
        'outcome': outcome,
        'leadId': leads[lead]['id'],
        'leadName': leads[lead]['name'],
        'user': meUserSummary,
        'from': direction == 'inbound' ? leads[lead]['phone'] : '+919811100001',
        'to': direction == 'inbound' ? '+919811100001' : leads[lead]['phone'],
        'startedAt': started.toIso8601String(),
        'answeredAt': durationSec > 0 ? started.add(const Duration(seconds: 6)).toIso8601String() : null,
        'endedAt': started.add(Duration(seconds: durationSec + 8)).toIso8601String(),
        'durationSec': durationSec,
        'hasRecording': rec,
        'notes': null,
        'disposition': null,
        'provider': 'sim',
        'customFields': {},
      };
    }

    calls = [
      call(1, 'outbound', 'completed', 'interested', 6, 312, const Duration(minutes: 25), rec: true),
      call(2, 'outbound', 'completed', 'callback', 7, 95, const Duration(hours: 1, minutes: 10)),
      call(3, 'inbound', 'missed', 'missed', 9, 0, const Duration(hours: 2)),
      call(4, 'outbound', 'completed', 'answered', 3, 188, const Duration(hours: 3), rec: true),
      call(5, 'outbound', 'completed', 'not_interested', 10, 64, const Duration(hours: 4, minutes: 20)),
      call(6, 'outbound', 'missed', 'missed', 0, 0, const Duration(hours: 5)),
      call(7, 'inbound', 'completed', 'interested', 4, 421, const Duration(hours: 6), rec: true),
      call(8, 'outbound', 'completed', 'callback', 11, 133, const Duration(days: 1, hours: 1)),
      call(9, 'outbound', 'completed', 'wrong_number', 13, 21, const Duration(days: 1, hours: 3)),
      call(10, 'outbound', 'completed', 'interested', 12, 276, const Duration(days: 1, hours: 5), rec: true),
      call(11, 'inbound', 'completed', 'answered', 14, 152, const Duration(days: 2, hours: 2)),
      call(12, 'outbound', 'missed', 'missed', 15, 0, const Duration(days: 2, hours: 4)),
    ];
    // Older history for the calls-per-day chart.
    for (var d = 2; d < 14; d++) {
      final n = 4 + (d * 7) % 9;
      for (var k = 0; k < n; k++) {
        final dur = (k * 37 + d * 11) % 5 == 0 ? 0 : 40 + (k * 53 + d * 29) % 360;
        calls.add(call(100 + d * 20 + k, 'outbound', dur == 0 ? 'missed' : 'completed', dur == 0 ? 'missed' : 'answered', (d + k) % leads.length, dur, Duration(days: d, hours: 1 + k)));
      }
    }

    conversations = [];
    messages = {};
    final chats = [
      (4, 'GST invoice milega na?', 1, const Duration(minutes: 18), true),
      (15, '50% advance, balance before dispatch.', 0, const Duration(hours: 1, minutes: 40), false),
      (14, 'Ji sir, 3% discount possible hai for advance payment.', 0, const Duration(hours: 2, minutes: 10), false),
      (12, 'Thik hai, PO bhejta hoon kal tak', 1, const Duration(hours: 2, minutes: 30), true),
      (13, 'Can you do delivery by next week?', 2, const Duration(hours: 6), true),
      (16, 'Please share the catalogue once more.', 0, const Duration(hours: 30), false),
      (0, 'Price list received, will confirm tomorrow.', 0, const Duration(hours: 52), false),
    ];
    for (var i = 0; i < chats.length; i++) {
      final (leadIdx, preview, unread, ago, inbound) = chats[i];
      final id = 'conv-$i';
      final lastAt = now.subtract(ago);
      final lastInbound = inbound ? lastAt : lastAt.subtract(const Duration(minutes: 20));
      conversations.add({
        'id': id,
        'channel': 'whatsapp',
        'contactId': 'contact-$i',
        'contactName': leads[leadIdx]['name'],
        'contactPhone': leads[leadIdx]['phone'],
        'leadId': leads[leadIdx]['id'],
        'assignee': meUserSummary,
        'status': i == 6 ? 'closed' : 'open',
        'unreadCount': unread,
        'lastMessagePreview': preview,
        'lastMessageAt': lastAt.toIso8601String(),
        'lastInboundAt': lastInbound.toIso8601String(),
        'windowExpiresAt': lastInbound.add(const Duration(hours: 24)).toIso8601String(),
        'optIn': 'opted_in',
      });
      Json msg(int k, String dir, String body, Duration before, String status, {String type = 'text', String? template}) => {
            'id': '$id-m$k',
            'conversationId': id,
            'direction': dir,
            'type': type,
            'body': body,
            'templateName': template,
            'media': null,
            'status': status,
            'error': null,
            'isInternalNote': false,
            'author': dir == 'outbound' ? meUserSummary : null,
            'createdAt': lastAt.subtract(before).toIso8601String(),
          };
      messages[id] = [
        msg(1, 'outbound', 'Namaste ${leads[leadIdx]['name'].toString().split(' ').first} ji, thank you for your enquiry on IndiaMART for ${leads[leadIdx]['productInterest']}. I am Anil from Shakti Industries.', const Duration(hours: 3), 'read', type: 'template', template: 'welcome_indiamart_v1'),
        msg(2, 'inbound', 'Hello, please share the rate for ${(leadIdx + 2) * 50} units.', const Duration(hours: 2, minutes: 40), 'read'),
        msg(3, 'outbound', 'Sure. Rate is ₹${420 + leadIdx * 15} per unit plus GST, delivery in 5 to 7 days.', const Duration(hours: 2, minutes: 30), 'read'),
        msg(4, 'outbound', 'Sharing the quotation PDF shortly.', const Duration(minutes: 22), inbound ? 'delivered' : 'read'),
        if (inbound) msg(5, 'inbound', preview, Duration.zero, 'read') else msg(5, 'outbound', preview, Duration.zero, 'delivered'),
      ];
    }

    Json teammate(int i, String name, String status, int calls, {String? lead, int callMin = 0, String? zone, String? zoneName, String zoneSource = 'ble', double conf = 0.92, String? screen, bool field = false}) => {
          'user': {'id': 'user-$i', 'name': name, 'role': i == 9 ? 'manager' : 'employee', 'status': _coarse(status), 'avatar': null},
          'status': _coarse(status),
          'deskIndex': i,
          'currentLeadId': null,
          'currentLeadName': lead,
          'activeCall': status == 'on_call' ? {'callId': 'live-$i', 'startedAt': _ago(minutes: callMin), 'leadName': lead} : null,
          'callsToday': calls,
          'avgTalkSec': 120 + i * 13,
          'targetPct': 40.0 + i * 6,
          'presence': {
            'status': status,
            'version': 10 + i,
            'employeeStatus': _coarse(status),
            'source': status == 'on_call' ? 'phone_state' : (status == 'offline' ? 'timeout' : (status == 'available' ? 'heartbeat' : 'manual')),
            'since': _ago(minutes: status == 'on_call' ? callMin : 20 + i * 3),
            'manualStatus': null,
            'lastHeartbeatAt': status == 'offline' ? _ago(hours: 2) : _ago(minutes: 0),
            'lastSeenAt': status == 'offline' ? _ago(hours: 2) : _ago(minutes: 0),
            'activity': {
              'callId': status == 'on_call' ? 'live-$i' : null,
              'callStartedAt': status == 'on_call' ? _ago(minutes: callMin) : null,
              'leadId': null,
              'leadName': lead,
              'client': status == 'offline' ? null : (i.isEven ? 'android' : 'web'),
              'clientActivity': status == 'offline' ? null : 'active',
              'note': status == 'field_visit' ? 'Client visit, Andheri' : null,
              'screen': screen,
            },
            'location': zone == null ? null : {'zoneId': zone, 'zoneName': zoneName, 'source': zoneSource, 'confidence': conf, 'since': _ago(minutes: 12), 'at': _ago(minutes: 1)},
            'seatId': null,
            'isFieldStaff': field,
            'checkedIn': field && status != 'offline',
          },
        };
    team = [
      {...teammate(0, 'Anil Kumar', myStatus.wire, 11, zone: 'work', zoneName: 'Work area', screen: 'home'), 'user': meUserSummary},
      teammate(1, 'Rohit Verma', 'on_call', 14, lead: 'Sanjay Gupta', callMin: 4, zone: 'work', zoneName: 'Work area', screen: 'call'),
      teammate(2, 'Priya Sharma', 'available', 9, zone: 'work', zoneName: 'Work area', zoneSource: 'wifi', conf: 0.6, screen: 'leads'),
      teammate(3, 'Neha Joshi', 'on_call', 12, lead: 'Vikram Singh', callMin: 1, zone: 'work', zoneName: 'Work area', screen: 'lead_detail'),
      teammate(4, 'Amit Patel', 'on_break', 7, zone: 'pantry', zoneName: 'Pantry'),
      teammate(5, 'Sneha Rao', 'in_meeting', 5, zone: 'meeting', zoneName: 'Meeting room', zoneSource: 'qr', conf: 1),
      teammate(6, 'Karan Mehta', 'field_visit', 3, field: true),
      teammate(7, 'Pooja Iyer', 'available', 10, zone: 'work', zoneName: 'Work area', screen: 'inbox'),
      teammate(8, 'Rahul Das', 'offline', 0),
      teammate(9, 'Meera Kulkarni', 'available', 2, zone: 'cabin', zoneName: 'Manager cabin', screen: 'team_floor'),
      teammate(10, 'Vivek Nair', 'lunch', 6, zone: 'pantry', zoneName: 'Pantry', zoneSource: 'wifi', conf: 0.55),
    ];

    templates = [
      {'id': 'tpl-1', 'channel': 'whatsapp', 'name': 'welcome_indiamart_v1', 'language': 'en', 'category': 'utility', 'status': 'approved', 'body': 'Namaste {{1}}, thank you for your enquiry on IndiaMART. I am {{2}} from Shakti Industries. How can I help?', 'variables': ['lead.name', 'owner.name'], 'header': null, 'footer': null, 'updatedAt': _ago(days: 20)},
      {'id': 'tpl-2', 'channel': 'whatsapp', 'name': 'quote_followup_v2', 'language': 'en', 'category': 'utility', 'status': 'approved', 'body': 'Hello {{1}}, following up on the quotation we shared. Shall I confirm the order?', 'variables': ['lead.name'], 'header': null, 'footer': null, 'updatedAt': _ago(days: 12)},
      {'id': 'tpl-3', 'channel': 'whatsapp', 'name': 'payment_reminder_v1', 'language': 'en', 'category': 'utility', 'status': 'approved', 'body': 'Dear {{1}}, a gentle reminder about the pending payment for your order. Thank you.', 'variables': ['lead.name'], 'header': null, 'footer': null, 'updatedAt': _ago(days: 5)},
    ];
    quickReplies = [
      {'id': 'qr-1', 'shortcut': '/price', 'body': 'Our best price is shared in the quotation. Prices are plus GST and valid for 7 days.'},
      {'id': 'qr-2', 'shortcut': '/delivery', 'body': 'Delivery takes 5 to 7 working days after the PO and advance.'},
      {'id': 'qr-3', 'shortcut': '/thanks', 'body': 'Thank you! I will call you shortly.'},
      {'id': 'qr-4', 'shortcut': '/gst', 'body': 'Yes, a GST invoice is shared with every dispatch.'},
    ];

    notifications = [
      _n(1, 'lead_assigned', 'New lead: Kavita Reddy', 'IndiaMART enquiry for SS pipes 2 inch', '/leads/lead-00', const Duration(minutes: 8)),
      _n(2, 'message_received', 'Pooja Jain replied on WhatsApp', 'GST invoice milega na?', '/inbox/conv-0', const Duration(minutes: 18)),
      _n(3, 'task_overdue', 'Task overdue: Call Kavita Reddy', 'Due yesterday', '/tasks', const Duration(hours: 1)),
      _n(4, 'task_due', 'Discuss quote with Gurpreet Mishra', 'Due in 1 hour 30 minutes', '/tasks', const Duration(hours: 2), read: true),
      _n(5, 'mention', 'Meera mentioned you on Vardhman Textiles', '"@Anil please confirm the delivery date"', '/leads/lead-07', const Duration(hours: 5), read: true),
      _n(6, 'system', 'Working hours tracking is on', 'Calls are tracked 9:30 am to 6:30 pm', null, const Duration(days: 1), read: true),
    ];

    timelines = {};
    attendance = {
      'date': _ago().substring(0, 10),
      'timezone': 'Asia/Kolkata',
      'isFieldStaff': true,
      'trackingEnabled': true,
      'consent': {'accepted': false, 'version': null, 'at': null, 'currentVersion': '2026-11-v1'},
      'workingHours': [
        {'start': '09:30', 'end': '18:30'},
      ],
      'insideWorkingHours': true,
      'session': null,
      'sessions': <Json>[],
      'trackingActive': false,
      'locationIntervalSec': 120,
    };

    me = {
      'user': {
        ...meUserSummary,
        'workspaceId': workspaceId,
        'email': 'anil@shakti.example',
        'phone': '+919811100001',
        'title': 'Sales executive',
        'roleId': 'role-employee',
        'roleName': 'Employee',
        'teamId': 'team-north',
        'isActive': true,
        'workingHours': null,
        'statusChangedAt': _ago(minutes: 30),
        'lastSeenAt': _ago(minutes: 0),
        'createdAt': _ago(days: 200),
        'isFieldStaff': true,
      },
      'role': {'id': 'role-employee', 'key': 'employee', 'name': 'Employee', 'kind': 'employee', 'dataScope': 'own', 'permissions': [], 'isSystem': true, 'memberCount': 8},
      'workspace': {
        'id': workspaceId,
        'name': 'Shakti Industries',
        'slug': 'shakti',
        'status': 'active',
        'timezone': 'Asia/Kolkata',
        'currency': 'INR',
        'businessHours': {
          'mon': [{'start': '09:30', 'end': '18:30'}],
          'tue': [{'start': '09:30', 'end': '18:30'}],
          'wed': [{'start': '09:30', 'end': '18:30'}],
          'thu': [{'start': '09:30', 'end': '18:30'}],
          'fri': [{'start': '09:30', 'end': '18:30'}],
          'sat': [{'start': '10:00', 'end': '14:00'}],
          'sun': [],
        },
        'holidays': [],
        'plan': 'growth',
        'logoUrl': null,
        'accentColor': null,
        'showEmployeeRank': true,
        'componentStyle': 'premium',
        'branding': {
          'displayName': 'Shakti Industries',
          'logoLight': null,
          'logoDark': null,
          'brandColor': brandColor,
          'chartPalette': null,
          'loginImage': null,
          'favicon': null,
          'colors': {'base': brandColor ?? '#4F46E5', 'light': brandColor ?? '#4F46E5', 'dark': brandColor ?? '#818CF8', 'lightForeground': '#FFFFFF', 'darkForeground': '#0F172A', 'adjusted': false},
          'chartColors': {'base': <String>[], 'light': <String>[], 'dark': <String>[], 'adjusted': <int>[]},
        },
        'features': {'whatsapp': true, 'team_floor_3d': true, 'telephony': true, 'employee_rank': true, 'custom_domain': false, 'field_tracking': true},
      },
      'permissions': ['leads.read', 'leads.update', 'tasks.read', 'tasks.update', 'calls.read', 'calls.make', 'messages.read', 'messages.send', 'templates.read', 'teamfloor.read', 'reports.read'],
      'teamMemberIds': [],
      'settings': {'theme': {'mode': 'system'}, 'notifications': {'inApp': true, 'push': true, 'emailDigest': 'daily'}},
      'impersonation': null,
    };
  }

  Json _n(int i, String type, String title, String body, String? href, Duration ago, {bool read = false}) => {
        'id': 'ntf-$i',
        'type': type,
        'title': title,
        'body': body,
        'href': href,
        'data': {},
        'readAt': read ? now.subtract(ago).add(const Duration(minutes: 5)).toIso8601String() : null,
        'createdAt': now.subtract(ago).toIso8601String(),
      };

  Json? lead(String id) => leads.where((l) => l['id'] == id).firstOrNull;

  /// MyToday computed from the world like the API does (own scope).
  Json today() {
    final endOfDay = now.add(const Duration(hours: 12));
    bool due(Json t) => t['status'] == 'open' && DateTime.parse(t['dueAt'] as String).isBefore(endOfDay);
    final callsToday = calls.where((c) => now.difference(DateTime.parse(c['startedAt'] as String)).inHours < 12).toList();
    return {
      'tasksDue': tasks.where((t) => due(t) && t['type'] != 'call').toList(),
      'callsToMake': tasks.where((t) => due(t) && t['type'] == 'call').toList(),
      'followUps': leads.where((l) => l['nextFollowUpAt'] != null && DateTime.parse(l['nextFollowUpAt'] as String).isBefore(now)).take(6).toList(),
      'newAssigned': leads.where((l) => now.difference(DateTime.parse(l['createdAt'] as String)).inHours < 24).toList(),
      'targets': [
        {'metric': 'revenue_inr', 'period': '2026-11', 'target': 1500000, 'achieved': 1035000},
        {'metric': 'calls', 'period': '2026-11', 'target': 400, 'achieved': 262},
        {'metric': 'deals_won', 'period': '2026-11', 'target': 12, 'achieved': 7},
      ],
      'stats': {
        'callsToday': callsToday.length,
        'talkSecToday': callsToday.fold<int>(0, (s, c) => s + (c['durationSec'] as int)),
        'leadsContactedToday': callsToday.map((c) => c['leadId']).toSet().length,
        'wonInrThisMonth': 1035000,
        'rank': 3,
      },
      'generatedAt': now.toIso8601String(),
    };
  }
}
