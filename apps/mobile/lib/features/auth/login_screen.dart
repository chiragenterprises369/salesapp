import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';

import '../../app/providers.dart';
import '../../core/api/api_error.dart';
import '../../core/haptics.dart';
import '../../design/design.dart';

/// Vistar mark: rounded accent tile with a V. Long-press opens the developer sheet on login.
class BrandMark extends StatelessWidget {
  const BrandMark({super.key, this.size = 44, this.logoUrl});
  final double size;
  final String? logoUrl;

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final url = logoUrl;
    if (url != null && url.isNotEmpty) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(size * 0.28),
        child: Image.network(url, width: size, height: size, fit: BoxFit.contain, errorBuilder: (_, _, _) => BrandMark(size: size)),
      );
    }
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: c.accent, borderRadius: BorderRadius.circular(size * 0.28), boxShadow: VElevation.card(c)),
      child: Text('V', textScaler: TextScaler.noScaling, style: TextStyle(fontFamily: fontFamily, fontSize: size * 0.5, fontWeight: FontWeight.w700, color: c.onAccent, height: 1)),
    );
  }
}

class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: Semantics(
          label: 'Vistar is starting',
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BrandMark(size: 56),
              const SizedBox(height: VSpace.xl),
              SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: context.colors.accent)),
            ],
          ),
        ),
      ),
    );
  }
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  late final _email = TextEditingController(text: ref.read(prefsProvider).lastEmail);
  final _password = TextEditingController();
  bool _obscure = true;
  bool _busy = false;
  bool _demo = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_form.currentState?.validate() ?? false)) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).signIn(_email.text, _password.text, demo: _demo);
      await Haptics.success();
    } catch (e) {
      final f = ApiFailure.from(e);
      setState(() {
        _error = switch (f.code) {
          'AUTH_INVALID_CREDENTIALS' => 'Email or password is not correct.',
          'AUTH_ACCOUNT_DISABLED' => 'This account is disabled. Ask your company admin.',
          'RATE_LIMITED' => 'Too many attempts. Wait a minute and try again.',
          'NETWORK' => 'Could not reach the server. Check your internet connection.',
          _ => f.message,
        };
      });
      await Haptics.warning();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _toggleDemo(bool v) {
    setState(() {
      _demo = v;
      _error = null;
      if (v) {
        _email.text = 'anil@shakti.example';
        _password.text = 'vistar-demo-123';
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    final s = ref.watch(sessionProvider);
    final notice = s is SignedOut ? s.notice : null;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.symmetric(horizontal: VSpace.xxl, vertical: VSpace.xxxl),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Form(
                  key: _form,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Semantics(
                          label: 'Vistar. Long press for developer settings',
                          child: GestureDetector(onLongPress: () => showDeveloperSheet(context, ref), child: const BrandMark(size: 52)),
                        ),
                      ),
                      const SizedBox(height: VSpace.xxl),
                      Semantics(header: true, child: Text('Sign in', style: context.text.displaySmall)),
                      const SizedBox(height: VSpace.xs + 2),
                      Text('Use the work email your company added you with.', style: context.text.bodyLarge!.copyWith(color: c.mutedStrong)),
                      const SizedBox(height: VSpace.xxl),
                      if (notice != null) ...[
                        InfoBanner(icon: LucideIcons.info, text: notice, tone: Tone.blue),
                        const SizedBox(height: VSpace.lg),
                      ],
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        textInputAction: TextInputAction.next,
                        autofillHints: const [AutofillHints.email, AutofillHints.username],
                        autocorrect: false,
                        decoration: const InputDecoration(labelText: 'Work email', prefixIcon: Icon(LucideIcons.mail, size: 18)),
                        validator: (v) => (v == null || !RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim())) ? 'Enter your work email' : null,
                      ),
                      const SizedBox(height: VSpace.md + 2),
                      TextFormField(
                        controller: _password,
                        obscureText: _obscure,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.password],
                        onFieldSubmitted: (_) => _submit(),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(LucideIcons.lockKeyhole, size: 18),
                          suffixIcon: IconButton(
                            tooltip: _obscure ? 'Show password' : 'Hide password',
                            icon: Icon(_obscure ? LucideIcons.eye : LucideIcons.eyeOff, size: 18),
                            onPressed: () => setState(() => _obscure = !_obscure),
                          ),
                        ),
                        validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
                      ),
                      AnimatedSize(
                        duration: VMotion.of(context),
                        child: _error == null
                            ? const SizedBox(width: double.infinity)
                            : Padding(
                                padding: const EdgeInsets.only(top: VSpace.md),
                                child: Semantics(
                                  liveRegion: true,
                                  child: Row(
                                    children: [
                                      Icon(LucideIcons.circleAlert, size: 16, color: c.dangerText),
                                      const SizedBox(width: VSpace.sm),
                                      Expanded(child: Text(_error!, style: context.text.bodyMedium!.copyWith(color: c.dangerText))),
                                    ],
                                  ),
                                ),
                              ),
                      ),
                      const SizedBox(height: VSpace.xl),
                      FilledButton(
                        onPressed: _busy ? null : _submit,
                        style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                        child: _busy
                            ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.2, color: c.onAccent))
                            : Text(_demo ? 'Open demo' : 'Sign in'),
                      ),
                      const SizedBox(height: VSpace.xxl),
                      VCard(
                        padding: const EdgeInsets.fromLTRB(VSpace.lg, VSpace.sm, VSpace.sm, VSpace.sm),
                        child: MergeSemantics(
                          child: Row(
                            children: [
                              Icon(LucideIcons.flaskConical, size: 18, color: c.fgSecondary),
                              const SizedBox(width: VSpace.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text('Demo mode', style: context.text.titleSmall),
                                    Text('Explore the app with sample data. Nothing is sent to a server.', style: context.text.bodySmall!.copyWith(color: c.mutedStrong)),
                                  ],
                                ),
                              ),
                              Switch(value: _demo, onChanged: _busy ? null : _toggleDemo),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: VSpace.lg),
                      Text(
                        'Forgot your password? Ask your company admin to send a new invite.',
                        textAlign: TextAlign.center,
                        style: context.text.bodySmall!.copyWith(color: c.mutedStrong),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Hidden developer sheet: server URL (e.g. http://192.168.1.20:4000 for a phone on the same
/// Wi-Fi as the API) with a connection test.
Future<void> showDeveloperSheet(BuildContext context, WidgetRef ref) async {
  await HapticFeedback.mediumImpact();
  if (!context.mounted) return;
  await showVSheet<void>(context, title: 'Developer settings', subtitle: 'Server for this device. Ask your admin before changing it.', builder: (_) => const _DevSheet());
}

class _DevSheet extends ConsumerStatefulWidget {
  const _DevSheet();

  @override
  ConsumerState<_DevSheet> createState() => _DevSheetState();
}

class _DevSheetState extends ConsumerState<_DevSheet> {
  late final _url = TextEditingController(text: ref.read(prefsProvider).serverUrl);
  String? _result;
  bool _ok = false;
  bool _testing = false;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _test() async {
    setState(() {
      _testing = true;
      _result = null;
    });
    try {
      var base = _url.text.trim();
      while (base.endsWith('/')) {
        base = base.substring(0, base.length - 1);
      }
      final res = await Dio(BaseOptions(connectTimeout: const Duration(seconds: 6), receiveTimeout: const Duration(seconds: 6))).get<dynamic>('$base/api/health');
      setState(() {
        _ok = true;
        _result = 'Connected (${res.statusCode}).';
      });
    } catch (e) {
      setState(() {
        _ok = false;
        _result = 'Could not reach $_url: ${ApiFailure.from(e).message}';
      });
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: VSpace.xl),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          TextField(
            controller: _url,
            keyboardType: TextInputType.url,
            autocorrect: false,
            decoration: const InputDecoration(labelText: 'Server URL', hintText: 'http://192.168.1.20:4000', prefixIcon: Icon(LucideIcons.server, size: 18)),
          ),
          if (_result != null) ...[
            const SizedBox(height: VSpace.md),
            Text(_result!, style: context.text.bodyMedium!.copyWith(color: _ok ? c.successText : c.dangerText)),
          ],
          const SizedBox(height: VSpace.lg),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(onPressed: _testing ? null : _test, child: Text(_testing ? 'Testing...' : 'Test connection')),
              ),
              const SizedBox(width: VSpace.md),
              Expanded(
                child: FilledButton(
                  onPressed: () async {
                    await ref.read(prefsProvider.notifier).setServerUrl(_url.text);
                    if (context.mounted) Navigator.of(context).pop();
                  },
                  child: const Text('Save'),
                ),
              ),
            ],
          ),
          const SizedBox(height: VSpace.sm),
        ],
      ),
    );
  }
}
