package app.vistar.employee

import android.content.Context
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

/**
 * The activity attaches to one cached engine (EngineHolder) instead of owning its own. The engine
 * outlives the activity while the call-tracking foreground service keeps the process alive, so the
 * Dart side keeps sending heartbeats, call events and queued uploads after the user leaves the app.
 */
class MainActivity : FlutterActivity() {
    override fun provideFlutterEngine(context: Context): FlutterEngine = EngineHolder.obtain(context.applicationContext)

    override fun shouldDestroyEngineWithHost(): Boolean = false
}
