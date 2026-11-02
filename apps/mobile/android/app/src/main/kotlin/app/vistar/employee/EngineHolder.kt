package app.vistar.employee

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import app.vistar.employee.telephony.TelephonyChannel
import app.vistar.employee.zones.ZonesChannel
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.embedding.engine.dart.DartExecutor

/** One FlutterEngine per process, shared by the activity and the call-tracking service. */
object EngineHolder {
    private const val ENGINE_ID = "vistar_main"

    @Synchronized
    fun obtain(context: Context): FlutterEngine {
        val cache = FlutterEngineCache.getInstance()
        cache.get(ENGINE_ID)?.let { return it }
        val app = context.applicationContext
        ensureUpdatesChannel(app)
        // Plugins are registered automatically by the FlutterEngine constructor.
        val engine = FlutterEngine(app)
        TelephonyChannel.register(engine, app)
        ZonesChannel.register(engine, app)
        engine.dartExecutor.executeDartEntrypoint(DartExecutor.DartEntrypoint.createDefault())
        cache.put(ENGINE_ID, engine)
        return engine
    }

    fun peek(): FlutterEngine? = FlutterEngineCache.getInstance().get(ENGINE_ID)

    /** Channel used by push notifications (manifest default_notification_channel_id). */
    private fun ensureUpdatesChannel(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel("vistar_updates") != null) return
        val channel = NotificationChannel("vistar_updates", "Leads, tasks and messages", NotificationManager.IMPORTANCE_HIGH)
        channel.description = "New leads, due tasks and WhatsApp replies"
        nm.createNotificationChannel(channel)
    }
}
