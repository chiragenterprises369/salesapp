package app.vistar.employee.zones

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.util.Locale

/**
 * Platform channel `vistar/zones` (SPEC 29.11): office zone signals for the Team Floor.
 * - scanBeacons: a short BLE scan that reads iBeacon advertisements (Apple manufacturer data,
 *   0x02 0x15 + UUID + major + minor + tx power). One cheap beacon per room gives room level.
 * - wifiScan: the access points from the last Wi-Fi scan (Android throttles new scans to 4 per
 *   2 minutes), the connected one first. Office Wi-Fi tells "in the office" from "outside".
 * The server maps beacons and BSSIDs to zones through the company's markers. Nothing is stored here.
 */
object ZonesChannel {
    private const val METHODS = "vistar/zones"
    private const val APPLE_COMPANY_ID = 0x004C

    fun register(engine: FlutterEngine, context: Context) {
        MethodChannel(engine.dartExecutor.binaryMessenger, METHODS).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "getCapabilities" -> result.success(capabilities(context))
                    "scanBeacons" -> scanBeacons(context, (call.argument<Number>("windowMs") ?: 4000).toLong(), result)
                    "wifiScan" -> result.success(wifiScan(context, call.argument<Boolean>("requestScan") ?: false))
                    else -> result.notImplemented()
                }
            } catch (e: SecurityException) {
                result.error("PERMISSION_DENIED", e.message, null)
            } catch (e: Exception) {
                result.error("ZONES_ERROR", e.message, null)
            }
        }
    }

    private fun granted(context: Context, permission: String) =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    private fun bleScanGranted(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) granted(context, Manifest.permission.BLUETOOTH_SCAN) else true

    private fun capabilities(context: Context): Map<String, Any?> {
        val bt = context.getSystemService(BluetoothManager::class.java)?.adapter
        val lm = context.getSystemService(LocationManager::class.java)
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
        return mapOf(
            "bluetoothOn" to (bt?.isEnabled == true),
            "bleScan" to bleScanGranted(context),
            "location" to granted(context, Manifest.permission.ACCESS_FINE_LOCATION),
            "locationOn" to (lm?.isLocationEnabled == true),
            "wifiOn" to (wifi?.isWifiEnabled == true),
        )
    }

    @SuppressLint("MissingPermission")
    private fun scanBeacons(context: Context, windowMs: Long, result: MethodChannel.Result) {
        val adapter = context.getSystemService(BluetoothManager::class.java)?.adapter
        val scanner = adapter?.bluetoothLeScanner
        if (adapter == null || !adapter.isEnabled || scanner == null || !bleScanGranted(context) || !granted(context, Manifest.permission.ACCESS_FINE_LOCATION)) {
            result.success(emptyList<Map<String, Any?>>())
            return
        }
        val seen = LinkedHashMap<String, Map<String, Any?>>()
        val callback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, r: ScanResult) {
                val beacon = parseIBeacon(r) ?: return
                val key = "${beacon["uuid"]}:${beacon["major"]}:${beacon["minor"]}"
                val prev = seen[key]
                if (prev == null || (prev["rssi"] as Int) < (beacon["rssi"] as Int)) seen[key] = beacon
            }

            override fun onBatchScanResults(results: MutableList<ScanResult>) {
                results.forEach { onScanResult(0, it) }
            }
        }
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        val handler = Handler(Looper.getMainLooper())
        var finished = false
        fun finish() {
            if (finished) return
            finished = true
            try {
                scanner.stopScan(callback)
            } catch (_: Exception) {
            }
            result.success(seen.values.sortedByDescending { it["rssi"] as Int }.take(30))
        }
        try {
            scanner.startScan(null, settings, callback)
        } catch (e: SecurityException) {
            result.error("PERMISSION_DENIED", e.message, null)
            return
        }
        handler.postDelayed({ finish() }, windowMs.coerceIn(1000, 10000))
    }

    private fun parseIBeacon(r: ScanResult): Map<String, Any?>? {
        val data = r.scanRecord?.getManufacturerSpecificData(APPLE_COMPANY_ID) ?: return null
        if (data.size < 23 || data[0] != 0x02.toByte() || data[1] != 0x15.toByte()) return null
        val hex = StringBuilder()
        for (i in 2 until 18) hex.append(String.format(Locale.ROOT, "%02x", data[i]))
        val h = hex.toString()
        val uuid = "${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20, 32)}"
        val major = ((data[18].toInt() and 0xFF) shl 8) or (data[19].toInt() and 0xFF)
        val minor = ((data[20].toInt() and 0xFF) shl 8) or (data[21].toInt() and 0xFF)
        return mapOf("uuid" to uuid, "major" to major, "minor" to minor, "rssi" to r.rssi.coerceIn(-127, 0))
    }

    @Suppress("DEPRECATION")
    @SuppressLint("MissingPermission")
    private fun wifiScan(context: Context, requestScan: Boolean): List<Map<String, Any?>> {
        if (!granted(context, Manifest.permission.ACCESS_FINE_LOCATION)) return emptyList()
        val wifi = context.applicationContext.getSystemService(WifiManager::class.java) ?: return emptyList()
        if (!wifi.isWifiEnabled) return emptyList()
        if (requestScan) {
            try {
                wifi.startScan()
            } catch (_: Exception) {
            }
        }
        val connected = wifi.connectionInfo?.bssid?.lowercase(Locale.ROOT)
        val now = android.os.SystemClock.elapsedRealtime()
        val list = wifi.scanResults
            .filter { it.BSSID != null && now - it.timestamp / 1000 < 5 * 60 * 1000 }
            .map { mapOf("bssid" to it.BSSID.lowercase(Locale.ROOT), "rssi" to it.level.coerceIn(-127, 0), "ssid" to (if (Build.VERSION.SDK_INT >= 33) it.wifiSsid?.toString() else it.SSID)) }
            .sortedWith(compareByDescending<Map<String, Any?>> { it["bssid"] == connected }.thenByDescending { it["rssi"] as Int })
            .take(40)
        return list
    }
}
