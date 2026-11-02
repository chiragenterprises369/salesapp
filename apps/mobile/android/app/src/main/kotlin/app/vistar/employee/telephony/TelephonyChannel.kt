package app.vistar.employee.telephony

import android.Manifest
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.CallLog
import android.provider.MediaStore
import android.provider.Settings
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Platform channel `vistar/telephony` (methods) and `vistar/telephony/events` (phone state stream).
 * SIM calling (D-057): the system places the call from the employee's own SIM; this code never
 * records audio. Recordings are the phone's own recorder files, found through MediaStore.
 */
object TelephonyChannel {
    private const val METHODS = "vistar/telephony"
    private const val EVENTS = "vistar/telephony/events"
    private const val PREFS = "vistar_telephony"

    /** Folders used by OEM call recorders (lower case, matched against RELATIVE_PATH or DATA). */
    val RECORDING_FOLDERS = listOf(
        "recordings/call",            // Samsung (One UI)
        "call recordings",            // Samsung older, Realme/Oppo/OnePlus "Music/Recordings/Call Recordings"
        "miui/sound_recorder/call_rec", // Xiaomi / Redmi / POCO (MIUI)
        "sound_recorder/call_rec",
        "recordings/call recordings",
        "music/recordings/call recordings",
        "record/call",                // Vivo
        "record/phonerecord",
        "phonerecord",                // Motorola / older Vivo
        "callrecord",                 // Motorola and some MediaTek dialers
        "call_recordings",
        "recorder/call",              // Oppo ColorOS
        "recordings/callrecordings",
        "android/data/com.google.android.dialer", // Google dialer exports
        "call recorder",
    )

    private val io = Executors.newSingleThreadExecutor()

    fun register(engine: FlutterEngine, context: Context) {
        MethodChannel(engine.dartExecutor.binaryMessenger, METHODS).setMethodCallHandler { call, result ->
            handle(context, call, result)
        }
        EventChannel(engine.dartExecutor.binaryMessenger, EVENTS).setStreamHandler(object : EventChannel.StreamHandler {
            override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
                CallEventBus.sink = events
            }

            override fun onCancel(arguments: Any?) {
                CallEventBus.sink = null
            }
        })
    }

    private fun granted(context: Context, permission: String) =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun handle(context: Context, call: MethodCall, result: MethodChannel.Result) {
        try {
            when (call.method) {
                "getCapabilities" -> result.success(capabilities(context))
                "getSims" -> result.success(sims(context))
                "placeCall" -> result.success(placeCall(context, call.argument<String>("number")!!, call.argument<String>("accountId")))
                "openDialer" -> {
                    openDialer(context, call.argument<String>("number")!!)
                    result.success("dialer")
                }
                "startMonitoring" -> result.success(
                    CallMonitorService.start(context, call.argument<String>("title"), call.argument<String>("text")),
                )
                "stopMonitoring" -> {
                    CallMonitorService.stop(context)
                    result.success(true)
                }
                "isMonitoring" -> result.success(CallMonitorService.running)
                "drainPendingEvents" -> result.success(CallEventBus.drain(context))
                "queryCallLog" -> {
                    val from = (call.argument<Number>("fromMs") ?: 0).toLong()
                    val to = (call.argument<Number>("toMs") ?: System.currentTimeMillis()).toLong()
                    io.execute { postResult(result) { queryCallLog(context, from, to) } }
                }
                "findRecordings" -> {
                    val from = (call.argument<Number>("fromMs") ?: 0).toLong()
                    val to = (call.argument<Number>("toMs") ?: System.currentTimeMillis()).toLong()
                    io.execute { postResult(result) { findRecordings(context, from, to) } }
                }
                "copyRecording" -> {
                    val uri = Uri.parse(call.argument<String>("uri")!!)
                    io.execute { postResult(result) { copyRecording(context, uri) } }
                }
                "requestBatteryExemption" -> result.success(requestBatteryExemption(context))
                else -> result.notImplemented()
            }
        } catch (e: SecurityException) {
            result.error("PERMISSION_DENIED", e.message, null)
        } catch (e: Exception) {
            result.error("TELEPHONY_ERROR", e.message, null)
        }
    }

    private fun postResult(result: MethodChannel.Result, block: () -> Any?) {
        val main = android.os.Handler(android.os.Looper.getMainLooper())
        try {
            val value = block()
            main.post { result.success(value) }
        } catch (e: SecurityException) {
            main.post { result.error("PERMISSION_DENIED", e.message, null) }
        } catch (e: Exception) {
            main.post { result.error("TELEPHONY_ERROR", e.message, null) }
        }
    }

    private fun installId(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        prefs.getString("install_id", null)?.let { return it }
        val id = UUID.randomUUID().toString()
        prefs.edit().putString("install_id", id).apply()
        return id
    }

    private fun capabilities(context: Context): Map<String, Any?> {
        val pm = context.packageManager
        val power = context.getSystemService(PowerManager::class.java)
        return mapOf(
            "sdkInt" to Build.VERSION.SDK_INT,
            "manufacturer" to Build.MANUFACTURER,
            "model" to Build.MODEL,
            "hasTelephony" to pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY),
            "batteryExempt" to (power?.isIgnoringBatteryOptimizations(context.packageName) ?: false),
            "monitoring" to CallMonitorService.running,
            "installId" to installId(context),
            "callPhone" to granted(context, Manifest.permission.CALL_PHONE),
            "readPhoneState" to granted(context, Manifest.permission.READ_PHONE_STATE),
            "readCallLog" to granted(context, Manifest.permission.READ_CALL_LOG),
            "readAudio" to granted(
                context,
                if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE,
            ),
        )
    }

    private fun sims(context: Context): List<Map<String, Any?>> {
        if (!granted(context, Manifest.permission.READ_PHONE_STATE)) return emptyList()
        val telecom = context.getSystemService(TelecomManager::class.java) ?: return emptyList()
        val handles: List<PhoneAccountHandle> = telecom.callCapablePhoneAccounts ?: emptyList()
        return handles.mapIndexed { index, handle ->
            val account = telecom.getPhoneAccount(handle)
            mapOf(
                "accountId" to handle.id,
                "slot" to index,
                "label" to (account?.label?.toString() ?: "SIM ${index + 1}"),
                "number" to account?.address?.schemeSpecificPart?.takeIf { it.isNotBlank() },
            )
        }
    }

    private fun placeCall(context: Context, number: String, accountId: String?): String {
        val uri = Uri.fromParts("tel", number, null)
        if (!granted(context, Manifest.permission.CALL_PHONE)) {
            openDialer(context, number)
            return "dialer"
        }
        val telecom = context.getSystemService(TelecomManager::class.java)
        if (telecom == null) {
            openDialer(context, number)
            return "dialer"
        }
        val extras = Bundle()
        if (accountId != null && granted(context, Manifest.permission.READ_PHONE_STATE)) {
            telecom.callCapablePhoneAccounts?.firstOrNull { it.id == accountId }?.let {
                extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, it)
            }
        }
        return try {
            telecom.placeCall(uri, extras)
            "placed"
        } catch (e: SecurityException) {
            openDialer(context, number)
            "dialer"
        }
    }

    private fun openDialer(context: Context, number: String) {
        val intent = Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }

    private fun queryCallLog(context: Context, fromMs: Long, toMs: Long): List<Map<String, Any?>> {
        if (!granted(context, Manifest.permission.READ_CALL_LOG)) throw SecurityException("READ_CALL_LOG not granted")
        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE,
            CallLog.Calls.DURATION,
            CallLog.Calls.PHONE_ACCOUNT_ID,
        )
        val out = mutableListOf<Map<String, Any?>>()
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            projection,
            "${CallLog.Calls.DATE} >= ? AND ${CallLog.Calls.DATE} <= ?",
            arrayOf(fromMs.toString(), toMs.toString()),
            "${CallLog.Calls.DATE} DESC",
        )?.use { c ->
            val iId = c.getColumnIndexOrThrow(CallLog.Calls._ID)
            val iNumber = c.getColumnIndexOrThrow(CallLog.Calls.NUMBER)
            val iType = c.getColumnIndexOrThrow(CallLog.Calls.TYPE)
            val iDate = c.getColumnIndexOrThrow(CallLog.Calls.DATE)
            val iDuration = c.getColumnIndexOrThrow(CallLog.Calls.DURATION)
            val iAccount = c.getColumnIndex(CallLog.Calls.PHONE_ACCOUNT_ID)
            while (c.moveToNext() && out.size < 50) {
                val type = when (c.getInt(iType)) {
                    CallLog.Calls.INCOMING_TYPE -> "incoming"
                    CallLog.Calls.OUTGOING_TYPE -> "outgoing"
                    CallLog.Calls.MISSED_TYPE -> "missed"
                    CallLog.Calls.REJECTED_TYPE -> "rejected"
                    CallLog.Calls.BLOCKED_TYPE -> "blocked"
                    CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
                    else -> "unknown"
                }
                out.add(
                    mapOf(
                        "id" to c.getLong(iId).toString(),
                        "number" to (c.getString(iNumber) ?: ""),
                        "type" to type,
                        "dateMs" to c.getLong(iDate),
                        "durationSec" to c.getLong(iDuration).toInt(),
                        "accountId" to (if (iAccount >= 0) c.getString(iAccount) else null),
                    ),
                )
            }
        }
        return out
    }

    private fun findRecordings(context: Context, fromMs: Long, toMs: Long): List<Map<String, Any?>> {
        val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_AUDIO else Manifest.permission.READ_EXTERNAL_STORAGE
        if (!granted(context, permission)) throw SecurityException("Audio files permission not granted")
        val collection = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
        } else {
            MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
        }
        val pathColumn = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaStore.Audio.Media.RELATIVE_PATH else "_data"
        val projection = arrayOf(
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.SIZE,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.DATE_MODIFIED,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.MIME_TYPE,
            pathColumn,
        )
        val fromSec = fromMs / 1000
        val toSec = toMs / 1000
        val selection = "(${MediaStore.Audio.Media.DATE_ADDED} BETWEEN ? AND ?) OR (${MediaStore.Audio.Media.DATE_MODIFIED} BETWEEN ? AND ?)"
        val args = arrayOf(fromSec.toString(), toSec.toString(), fromSec.toString(), toSec.toString())
        val out = mutableListOf<Map<String, Any?>>()
        context.contentResolver.query(collection, projection, selection, args, "${MediaStore.Audio.Media.DATE_ADDED} DESC")?.use { c ->
            val iId = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
            val iName = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME)
            val iSize = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE)
            val iAdded = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED)
            val iModified = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED)
            val iDuration = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION)
            val iMime = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE)
            val iPath = c.getColumnIndex(pathColumn)
            while (c.moveToNext() && out.size < 40) {
                val id = c.getLong(iId)
                val path = (if (iPath >= 0) c.getString(iPath) else null) ?: ""
                val folderMatch = RECORDING_FOLDERS.any { path.lowercase().replace('\\', '/').contains(it) }
                out.add(
                    mapOf(
                        "uri" to ContentUris.withAppendedId(collection, id).toString(),
                        "name" to (c.getString(iName) ?: ""),
                        "path" to path,
                        "size" to c.getLong(iSize),
                        "addedMs" to c.getLong(iAdded) * 1000,
                        "modifiedMs" to c.getLong(iModified) * 1000,
                        "durationMs" to c.getLong(iDuration),
                        "mime" to (c.getString(iMime) ?: "audio/mpeg"),
                        "folderMatch" to folderMatch,
                    ),
                )
            }
        }
        return out
    }

    private fun copyRecording(context: Context, uri: Uri): Map<String, Any?> {
        val dir = File(context.cacheDir, "recordings").apply { mkdirs() }
        val mime = context.contentResolver.getType(uri) ?: "audio/mpeg"
        val ext = when {
            mime.contains("mp4") || mime.contains("m4a") || mime.contains("aac") -> "m4a"
            mime.contains("amr") -> "amr"
            mime.contains("ogg") || mime.contains("opus") -> "ogg"
            mime.contains("wav") -> "wav"
            mime.contains("3gpp") -> "3gp"
            else -> "mp3"
        }
        val target = File(dir, "rec-${uri.lastPathSegment ?: System.currentTimeMillis()}.$ext")
        context.contentResolver.openInputStream(uri)?.use { input ->
            target.outputStream().use { output -> input.copyTo(output) }
        } ?: throw IllegalStateException("Recording could not be opened")
        return mapOf("path" to target.absolutePath, "mime" to mime, "size" to target.length())
    }

    private fun requestBatteryExemption(context: Context): Boolean {
        val power = context.getSystemService(PowerManager::class.java)
        if (power?.isIgnoringBatteryOptimizations(context.packageName) == true) return true
        return try {
            val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            false
        } catch (e: Exception) {
            val intent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            false
        }
    }
}
