import '../json.dart';
import 'user.dart';

enum LeadTemperature { hot, warm, cold }

const leadSourceLabels = {
  'indiamart': 'IndiaMART',
  'website': 'Website',
  'whatsapp': 'WhatsApp',
  'manual': 'Added by hand',
  'webhook': 'Webhook',
  'import': 'Import',
  'api': 'API',
};

class Lead {
  const Lead({
    required this.id,
    required this.name,
    this.companyName,
    this.phone,
    this.email,
    this.city,
    required this.source,
    required this.pipelineId,
    required this.stageId,
    this.owner,
    required this.valueInr,
    required this.score,
    required this.temperature,
    required this.tags,
    this.nextFollowUpAt,
    this.lastActivityAt,
    required this.version,
    required this.createdAt,
    this.requirement,
    this.productInterest,
    this.state,
    this.stageType = 'open',
    this.customFields = const {},
    this.whatsappOptIn,
    this.dnd = false,
  });

  final String id;
  final String name;
  final String? companyName;
  final String? phone;
  final String? email;
  final String? city;
  final String source;
  final String pipelineId;
  final String stageId;
  final UserSummary? owner;
  final int valueInr;
  final int score;
  final LeadTemperature temperature;
  final List<String> tags;
  final DateTime? nextFollowUpAt;
  final DateTime? lastActivityAt;
  final int version;
  final DateTime createdAt;
  final String? requirement;
  final String? productInterest;
  final String? state;
  final String stageType;
  final Map<String, dynamic> customFields;
  final bool? whatsappOptIn;
  final bool dnd;

  String get sourceLabel => leadSourceLabels[source] ?? source;
  String get subtitle => [companyName, city].whereType<String>().where((s) => s.isNotEmpty).join(' · ');

  static Lead parse(Json j) => Lead(
        id: str(j['id']),
        name: str(j['name'], 'Unnamed lead'),
        companyName: strOrNull(j['companyName']),
        phone: strOrNull(j['phone']),
        email: strOrNull(j['email']),
        city: strOrNull(j['city']),
        source: str(j['source'], 'manual'),
        pipelineId: str(j['pipelineId']),
        stageId: str(j['stageId']),
        owner: UserSummary.parseOrNull(j['owner']),
        valueInr: toInt(j['valueInr']),
        score: toInt(j['score']),
        temperature: LeadTemperature.values.firstWhere((t) => t.name == j['temperature'], orElse: () => LeadTemperature.warm),
        tags: strings(j['tags']),
        nextFollowUpAt: date(j['nextFollowUpAt']),
        lastActivityAt: date(j['lastActivityAt']),
        version: toInt(j['version']),
        createdAt: date(j['createdAt']) ?? DateTime.now().toUtc(),
        requirement: strOrNull(j['requirement']),
        productInterest: strOrNull(j['productInterest']),
        state: strOrNull(j['state']),
        stageType: str(j['stageType'], 'open'),
        customFields: obj(j['customFields']),
        whatsappOptIn: j['whatsappOptIn'] is bool ? j['whatsappOptIn'] as bool : null,
        dnd: toBool(j['dnd']),
      );

  Lead copyWith({String? stageId, int? version, DateTime? nextFollowUpAt}) => Lead(
        id: id,
        name: name,
        companyName: companyName,
        phone: phone,
        email: email,
        city: city,
        source: source,
        pipelineId: pipelineId,
        stageId: stageId ?? this.stageId,
        owner: owner,
        valueInr: valueInr,
        score: score,
        temperature: temperature,
        tags: tags,
        nextFollowUpAt: nextFollowUpAt ?? this.nextFollowUpAt,
        lastActivityAt: lastActivityAt,
        version: version ?? this.version,
        createdAt: createdAt,
        requirement: requirement,
        productInterest: productInterest,
        state: state,
        stageType: stageType,
        customFields: customFields,
        whatsappOptIn: whatsappOptIn,
        dnd: dnd,
      );
}

class Stage {
  const Stage({required this.id, required this.name, required this.type, required this.order, this.color, this.probability = 0});

  final String id;
  final String name;
  final String type;
  final int order;
  final String? color;
  final int probability;

  static Stage parse(Json j) => Stage(
        id: str(j['id']),
        name: str(j['name']),
        type: str(j['type'], 'open'),
        order: toInt(j['order']),
        color: strOrNull(j['color']),
        probability: toInt(j['probability']),
      );
}

class Pipeline {
  const Pipeline({required this.id, required this.name, required this.isDefault, required this.stages});

  final String id;
  final String name;
  final bool isDefault;
  final List<Stage> stages;

  static Pipeline parse(Json j) => Pipeline(
        id: str(j['id']),
        name: str(j['name']),
        isDefault: toBool(j['isDefault']),
        stages: listOf(j['stages'], Stage.parse)..sort((a, b) => a.order.compareTo(b.order)),
      );

  Stage? stage(String id) => stages.where((s) => s.id == id).firstOrNull;
}

/// Lead timeline entry (ActivitySchema). The payload stays a map; the UI renders by type.
class Activity {
  const Activity({required this.id, required this.type, this.actor, required this.createdAt, required this.payload});

  final String id;
  final String type;
  final UserSummary? actor;
  final DateTime createdAt;
  final Json payload;

  static Activity parse(Json j) => Activity(
        id: str(j['id']),
        type: str(j['type'], 'note'),
        actor: UserSummary.parseOrNull(j['actor']),
        createdAt: date(j['createdAt']) ?? DateTime.now().toUtc(),
        payload: obj(j['payload']),
      );
}

/// Filters on the Leads list (LeadFiltersSchema subset used by the app).
class LeadFilters {
  const LeadFilters({this.q = '', this.stageIds = const {}, this.temperatures = const {}, this.sources = const {}, this.sort = 'createdAt'});

  final String q;
  final Set<String> stageIds;
  final Set<LeadTemperature> temperatures;
  final Set<String> sources;
  final String sort;

  int get activeCount => stageIds.length + temperatures.length + sources.length;

  LeadFilters copyWith({String? q, Set<String>? stageIds, Set<LeadTemperature>? temperatures, Set<String>? sources, String? sort}) => LeadFilters(
        q: q ?? this.q,
        stageIds: stageIds ?? this.stageIds,
        temperatures: temperatures ?? this.temperatures,
        sources: sources ?? this.sources,
        sort: sort ?? this.sort,
      );

  Map<String, dynamic> toQuery() => {
        'ownerId': 'me',
        if (q.trim().isNotEmpty) 'q': q.trim(),
        if (stageIds.isNotEmpty) 'stageId': stageIds.join(','),
        if (temperatures.isNotEmpty) 'temperature': temperatures.map((t) => t.name).join(','),
        if (sources.isNotEmpty) 'source': sources.join(','),
        'sort': sort,
        'dir': sort == 'name' ? 'asc' : 'desc',
        'limit': 50,
      };

  @override
  bool operator ==(Object other) =>
      other is LeadFilters &&
      other.q == q &&
      other.sort == sort &&
      _setEq(other.stageIds, stageIds) &&
      _setEq(other.temperatures, temperatures) &&
      _setEq(other.sources, sources);

  @override
  int get hashCode => Object.hash(q, sort, Object.hashAllUnordered(stageIds), Object.hashAllUnordered(temperatures), Object.hashAllUnordered(sources));

  static bool _setEq<T>(Set<T> a, Set<T> b) => a.length == b.length && a.containsAll(b);
}
