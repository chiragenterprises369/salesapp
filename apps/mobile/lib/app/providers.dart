import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_client.dart';
import '../core/api/token_store.dart';
import '../core/offline/local_store.dart';
import '../core/offline/write_queue.dart';
import '../data/api/api_repositories.dart';
import '../data/models.dart';
import '../data/repositories.dart';
import '../demo/demo_world.dart';
import '../demo/fake_repositories.dart';
import '../platform/location.dart';
import '../platform/push.dart';
import '../platform/telephony.dart';
import '../platform/zones.dart';
import 'prefs.dart';
import 'session.dart';

export 'prefs.dart';
export 'session.dart';

// ---------------------------------------------------------------- platform and storage

final localStoreProvider = Provider<LocalStore>((ref) => MemoryStore());
final clockProvider = Provider<DateTime Function()>((ref) => DateTime.now);
final telephonyProvider = Provider<TelephonyService>((ref) => createTelephony());
final locationProvider = Provider<LocationService>((ref) => isAndroidApp ? GeoLocationService() : NoLocationService());
final zoneScannerProvider = Provider<ZoneScanner>((ref) => createZoneScanner());
final pushProvider = Provider<PushService>((ref) => isAndroidApp ? FirebasePushService() : NoPushService());
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());
final writeQueueProvider = Provider<WriteQueue>((ref) => WriteQueue(ref.watch(localStoreProvider)));
final offlineCacheProvider = Provider<OfflineCache>((ref) => OfflineCache(ref.watch(localStoreProvider)));

/// Server id of this phone or browser (POST /me/devices), set after sign-in.
class DeviceIdController extends Notifier<String?> {
  @override
  String? build() => null;
  void set(String? id) => state = id;
}

final deviceIdProvider = NotifierProvider<DeviceIdController, String?>(DeviceIdController.new);

final apiClientProvider = Provider<ApiClient>((ref) {
  final url = ref.watch(prefsProvider.select((p) => p.serverUrl));
  return ApiClient(
    serverUrl: url,
    tokens: ref.watch(tokenStoreProvider),
    clientName: 'vistar-employee-${isAndroidApp ? 'android' : 'web'}',
    onSessionEnded: (reason) => ref.read(sessionProvider.notifier).sessionEnded(reason),
  );
});

final apiContextProvider = Provider<ApiContext>((ref) => ApiContext(
      client: ref.watch(apiClientProvider),
      cache: ref.watch(offlineCacheProvider),
      queue: ref.watch(writeQueueProvider),
      store: ref.watch(localStoreProvider),
      timezone: () => ref.read(meProvider)?.workspace.timezone ?? 'Asia/Kolkata',
      userId: () => ref.read(meProvider)?.user.id,
      deviceId: () => ref.read(deviceIdProvider),
      clock: ref.watch(clockProvider),
    ));

// ---------------------------------------------------------------- demo (explicit opt-in only)

final isDemoProvider = Provider<bool>((ref) => ref.watch(prefsProvider.select((p) => p.demoMode)));
final demoLatencyProvider = Provider<Duration>((ref) => const Duration(milliseconds: 350));
final demoWorldProvider = Provider<DemoWorld>((ref) => DemoWorld(now: ref.watch(clockProvider)()));
final fakeBackendProvider = Provider<FakeBackend>((ref) => FakeBackend(ref.watch(demoWorldProvider), latency: ref.watch(demoLatencyProvider)));

// ---------------------------------------------------------------- repositories

T _pick<T>(Ref ref, T Function(FakeBackend b) fake, T Function(ApiContext c) api) =>
    ref.watch(isDemoProvider) ? fake(ref.watch(fakeBackendProvider)) : api(ref.watch(apiContextProvider));

final authRepositoryProvider = Provider<AuthRepository>((ref) => _pick<AuthRepository>(ref, FakeAuthRepository.new, ApiAuthRepository.new));
final todayRepositoryProvider = Provider<TodayRepository>((ref) => _pick<TodayRepository>(ref, FakeTodayRepository.new, ApiTodayRepository.new));
final leadsRepositoryProvider = Provider<LeadsRepository>((ref) => _pick<LeadsRepository>(ref, FakeLeadsRepository.new, ApiLeadsRepository.new));
final tasksRepositoryProvider = Provider<TasksRepository>((ref) => _pick<TasksRepository>(ref, FakeTasksRepository.new, ApiTasksRepository.new));
final callsRepositoryProvider = Provider<CallsRepository>((ref) => _pick<CallsRepository>(ref, FakeCallsRepository.new, ApiCallsRepository.new));
final inboxRepositoryProvider = Provider<InboxRepository>((ref) => _pick<InboxRepository>(ref, FakeInboxRepository.new, ApiInboxRepository.new));
final teamFloorRepositoryProvider = Provider<TeamFloorRepository>((ref) => _pick<TeamFloorRepository>(ref, FakeTeamFloorRepository.new, ApiTeamFloorRepository.new));
final presenceRepositoryProvider = Provider<PresenceRepository>((ref) => _pick<PresenceRepository>(ref, FakePresenceRepository.new, ApiPresenceRepository.new));
final attendanceRepositoryProvider = Provider<AttendanceRepository>((ref) => _pick<AttendanceRepository>(ref, FakeAttendanceRepository.new, ApiAttendanceRepository.new));
final accountRepositoryProvider = Provider<AccountRepository>((ref) => _pick<AccountRepository>(ref, FakeAccountRepository.new, ApiAccountRepository.new));

/// Sends queued writes (API mode) or accepts them (Demo mode).
final writeSenderProvider = Provider<WriteSender>((ref) {
  if (ref.watch(isDemoProvider)) return fakeWriteSender;
  return ApiWriteSender(ref.watch(apiContextProvider)).call;
});

final pendingWritesProvider = StreamProvider<int>((ref) async* {
  final q = ref.watch(writeQueueProvider);
  yield (await q.pending()).length;
  yield* q.pendingCount;
});

// ---------------------------------------------------------------- session-derived

final meProvider = Provider<Me?>((ref) {
  final s = ref.watch(sessionProvider);
  return s is SignedIn ? s.me : null;
});

/// Workspace timezone for widgets (dates and times are always shown in it, SPEC 4.2).
String timezoneOf(WidgetRef ref) => ref.watch(meProvider)?.workspace.timezone ?? 'Asia/Kolkata';
