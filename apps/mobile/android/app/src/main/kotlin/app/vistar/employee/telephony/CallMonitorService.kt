package app.vistar.employee.telephony

import android.Manifest
import android.annotation.TargetApi
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import app.vistar.employee.EngineHolder
import app.vistar.employee.MainActivity
import app.vistar.employee.R

/**
 * Foreground service that observes the phone's call state while the employee is signed in during
 * working hours (started and stopped by the Dart side). It never records audio and never touches the
 * call itself: it only reports RINGING / OFFHOOK / IDLE so the app can tell the server "on a call"
 * and read the call log after hang-up.
 */
class CallMonitorService : Service() {
    companion object {
        const val CHANNEL_ID = "vistar_call_tracking"
        private const val NOTIFICATION_ID = 4101
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"

        @Volatile
        var running = false
            private set

        fun start(context: Context, title: String?, text: String?): Boolean {
            val intent = Intent(context, CallMonitorService::class.java)
            title?.let { intent.putExtra(EXTRA_TITLE, it) }
            text?.let { intent.putExtra(EXTRA_TEXT, it) }
            return try {
                context.startForegroundService(intent)
                true
            } catch (e: Exception) {
                // ForegroundServiceStartNotAllowedException (app in background without exemption) or SecurityException.
                false
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, CallMonitorService::class.java))
        }
    }

    private var telephony: TelephonyManager? = null
    private var callback: Any? = null
    private var lastState = TelephonyManager.CALL_STATE_IDLE

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        // A sticky restart after the process was killed: bring the Dart side back so it can upload.
        EngineHolder.obtain(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Vistar is tracking work calls"
        val text = intent?.getStringExtra(EXTRA_TEXT) ?: "Only during working hours. Tap to open the app."
        val notification = buildNotification(title, text)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            stopSelf()
            return START_NOT_STICKY
        }
        running = true
        registerListener()
        return START_STICKY
    }

    override fun onDestroy() {
        unregisterListener()
        running = false
        super.onDestroy()
    }

    private fun hasPhoneState(): Boolean =
        checkSelfPermission(Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED

    private fun registerListener() {
        if (callback != null || !hasPhoneState()) return
        val tm = getSystemService(TelephonyManager::class.java) ?: return
        telephony = tm
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val cb = CallStateCallback()
                tm.registerTelephonyCallback(mainExecutor, cb)
                callback = cb
            } else {
                val listener = LegacyListener()
                @Suppress("DEPRECATION")
                tm.listen(listener, PhoneStateListener.LISTEN_CALL_STATE)
                callback = listener
            }
        } catch (e: SecurityException) {
            callback = null
        }
    }

    private fun unregisterListener() {
        val tm = telephony ?: return
        val cb = callback ?: return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && cb is TelephonyCallback) {
                tm.unregisterTelephonyCallback(cb)
            } else if (cb is PhoneStateListener) {
                @Suppress("DEPRECATION")
                tm.listen(cb, PhoneStateListener.LISTEN_NONE)
            }
        } catch (_: Exception) {
        }
        callback = null
    }

    private fun onState(state: Int, number: String?) {
        if (state == lastState) return
        lastState = state
        val name = when (state) {
            TelephonyManager.CALL_STATE_RINGING -> "ringing"
            TelephonyManager.CALL_STATE_OFFHOOK -> "offhook"
            else -> "idle"
        }
        CallEventBus.emit(
            applicationContext,
            mapOf(
                "type" to "call_state",
                "state" to name,
                "number" to number?.takeIf { it.isNotBlank() },
                "at" to System.currentTimeMillis(),
            ),
        )
    }

    @TargetApi(Build.VERSION_CODES.S)
    private inner class CallStateCallback : TelephonyCallback(), TelephonyCallback.CallStateListener {
        override fun onCallStateChanged(state: Int) = onState(state, null)
    }

    @Suppress("DEPRECATION")
    private inner class LegacyListener : PhoneStateListener() {
        @Deprecated("Deprecated in Java")
        override fun onCallStateChanged(state: Int, phoneNumber: String?) = onState(state, phoneNumber)
    }

    private fun buildNotification(title: String, text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val channel = NotificationChannel(CHANNEL_ID, "Work call tracking", NotificationManager.IMPORTANCE_LOW)
            channel.description = "Shown while Vistar tracks work calls during working hours"
            channel.setShowBadge(false)
            nm.createNotificationChannel(channel)
        }
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_vistar)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }
}
