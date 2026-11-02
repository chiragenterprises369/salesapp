package app.vistar.employee.telephony

import android.content.Context
import android.os.Handler
import android.os.Looper
import io.flutter.plugin.common.EventChannel
import org.json.JSONArray
import org.json.JSONObject

/**
 * Delivers phone-state events to Dart. When no Dart listener is attached (engine starting, or the
 * Dart side has not subscribed yet), events are kept in SharedPreferences and drained by Dart with
 * `drainPendingEvents`, so a call that happens while the UI is gone is still reported.
 */
object CallEventBus {
    private const val PREFS = "vistar_telephony"
    private const val KEY_PENDING = "pending_events"
    private const val MAX_PENDING = 200

    private val main = Handler(Looper.getMainLooper())

    @Volatile
    var sink: EventChannel.EventSink? = null

    fun emit(context: Context, event: Map<String, Any?>) {
        main.post {
            val s = sink
            if (s != null) {
                s.success(event)
            } else {
                persist(context, event)
            }
        }
    }

    @Synchronized
    private fun persist(context: Context, event: Map<String, Any?>) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val list = try {
            JSONArray(prefs.getString(KEY_PENDING, "[]"))
        } catch (_: Exception) {
            JSONArray()
        }
        list.put(JSONObject(event.filterValues { it != null }))
        val trimmed = JSONArray()
        val start = maxOf(0, list.length() - MAX_PENDING)
        for (i in start until list.length()) trimmed.put(list.get(i))
        prefs.edit().putString(KEY_PENDING, trimmed.toString()).apply()
    }

    @Synchronized
    fun drain(context: Context): List<Map<String, Any?>> {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_PENDING, "[]") ?: "[]"
        prefs.edit().remove(KEY_PENDING).apply()
        val out = mutableListOf<Map<String, Any?>>()
        try {
            val list = JSONArray(raw)
            for (i in 0 until list.length()) {
                val o = list.getJSONObject(i)
                val m = mutableMapOf<String, Any?>()
                o.keys().forEach { k -> m[k] = o.get(k) }
                out.add(m)
            }
        } catch (_: Exception) {
            // Corrupt queue: drop it rather than crash the call tracker.
        }
        return out
    }
}
