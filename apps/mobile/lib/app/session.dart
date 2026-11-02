import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api/api_error.dart';
import '../data/models.dart';
import 'providers.dart';
import 'runtime.dart';

sealed class Session {
  const Session();
}

class SessionRestoring extends Session {
  const SessionRestoring();
}

class SignedOut extends Session {
  const SignedOut({this.notice});

  /// Shown on the login screen ("Your session ended. Sign in again.").
  final String? notice;
}

class SignedIn extends Session {
  const SignedIn(this.me, {this.demo = false});
  final Me me;
  final bool demo;
}

/// Signed-in state. Restores on start (refresh token in secure storage, or the browser cookie),
/// signs in with email and password or into Demo mode, and ends the session when the refresh
/// token is rejected (expired, revoked, or reused: the server revokes the family).
class SessionController extends Notifier<Session> {
  @override
  Session build() {
    Future.microtask(_restore);
    return const SessionRestoring();
  }

  Future<void> _restore() async {
    try {
      final me = await ref.read(authRepositoryProvider).restore();
      state = me == null ? const SignedOut() : SignedIn(me, demo: ref.read(isDemoProvider));
    } catch (_) {
      state = const SignedOut(notice: 'Could not reach the server. Check your connection and sign in again.');
    }
  }

  Future<void> signIn(String email, String password, {bool demo = false}) async {
    await ref.read(prefsProvider.notifier).setDemoMode(demo);
    final me = await ref.read(authRepositoryProvider).signIn(email, password);
    await ref.read(prefsProvider.notifier).setLastEmail(email.trim());
    state = SignedIn(me, demo: demo);
  }

  /// Refetch /auth/me (profile, branding or settings changed).
  Future<void> reloadMe() async {
    final s = state;
    if (s is! SignedIn) return;
    try {
      state = SignedIn(await ref.read(authRepositoryProvider).me(), demo: s.demo);
    } on ApiFailure {
      // Keep the current profile when offline.
    }
  }

  void replaceMe(Me me) {
    final s = state;
    if (s is SignedIn) state = SignedIn(me, demo: s.demo);
  }

  Future<void> signOut() async {
    final queue = ref.read(writeQueueProvider);
    try {
      // Last chance for queued call logs and task updates before the token goes away.
      await queue.flush(ref.read(writeSenderProvider)).timeout(const Duration(seconds: 8));
    } catch (_) {}
    // The socket disconnect that follows is a deliberate logout of this device.
    ref.read(runtimeProvider)?.prepareSignOut();
    try {
      await ref.read(authRepositoryProvider).signOut();
    } catch (_) {}
    await queue.clear();
    await ref.read(localStoreProvider).clear();
    await ref.read(prefsProvider.notifier).setDemoMode(false);
    ref.read(deviceIdProvider.notifier).set(null);
    state = const SignedOut();
  }

  void sessionEnded(String reason) {
    if (state is SignedIn && !(state as SignedIn).demo) {
      state = SignedOut(notice: reason);
    }
  }
}

final sessionProvider = NotifierProvider<SessionController, Session>(SessionController.new);
