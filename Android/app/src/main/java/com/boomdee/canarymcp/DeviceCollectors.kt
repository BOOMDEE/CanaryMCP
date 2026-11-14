package com.boomdee.canarymcp

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Process
import android.provider.Settings
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import kotlin.math.roundToInt

object DeviceCollectors {
    fun battery(context: Context): JSONObject {
        val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
        val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
        val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
        val percent = if (level >= 0 && scale > 0) (level * 100f / scale).roundToInt() else JSONObject.NULL
        val charging = status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        return JSONObject()
            .put("percent", percent)
            .put("charging", charging)
            .put("status", when (status) {
                BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
                BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
                BatteryManager.BATTERY_STATUS_FULL -> "full"
                BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
                else -> "unknown"
            })
            .put("capturedAt", Instant.now().toString())
    }

    fun location(context: Context, preciseOptIn: Boolean): JSONObject? {
        val coarseGranted = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val fineGranted = ContextCompat.checkSelfPermission(context, android.Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        if (!coarseGranted && !fineGranted) return null
        val precise = preciseOptIn && fineGranted
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val allowedProviders = if (precise) manager.getProviders(true) else manager.getProviders(true).filterNot { it.equals(LocationManager.GPS_PROVIDER, true) }
        val location = allowedProviders.asSequence()
            .mapNotNull { provider -> runCatching { manager.getLastKnownLocation(provider) }.getOrNull() }
            .maxByOrNull { it.time } ?: return null
        val latitude = if (precise) location.latitude else roundToGrid(location.latitude, 2)
        val longitude = if (precise) location.longitude else roundToGrid(location.longitude, 2)
        return JSONObject()
            .put("latitude", latitude)
            .put("longitude", longitude)
            .put("accuracyMeters", if (precise) location.accuracy.toDouble() else maxOf(1_500.0, location.accuracy.toDouble()))
            .put("precision", if (precise) "precise" else "approximate")
            .put("provider", if (precise) location.provider ?: "unknown" else "approximate")
            .put("sourceTimestamp", Instant.ofEpochMilli(location.time).toString())
            .put("capturedAt", Instant.now().toString())
    }

    fun hasUsageAccess(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        return appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED
    }

    fun usage(context: Context): JSONObject? {
        if (!hasUsageAccess(context)) return null
        val manager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
        val end = System.currentTimeMillis()
        val start = end - 24L * 60L * 60L * 1000L
        val packages = manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end)
            .asSequence()
            .filter { it.totalTimeInForeground > 0L && it.packageName != context.packageName }
            .sortedByDescending { it.lastTimeUsed }
            .take(15)
            .map { stats ->
                JSONObject()
                    .put("packageName", stats.packageName)
                    .put("foregroundMs", stats.totalTimeInForeground)
                    .put("lastUsedAt", Instant.ofEpochMilli(stats.lastTimeUsed).toString())
            }
        return JSONObject()
            .put("windowHours", 24)
            .put("apps", JSONArray().apply { packages.forEach { put(it) } })
            .put("capturedAt", Instant.now().toString())
    }

    fun isAccessibilityEnabled(context: Context): Boolean {
        val component = ComponentName(context, AccessibilityCaptureService::class.java).flattenToString()
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
            ?: return false
        return enabled.split(':').any { it.equals(component, ignoreCase = true) }
    }

    fun savedAccessibilitySnapshot(context: Context): JSONObject? {
        val raw = context.getSharedPreferences(AccessibilityCaptureService.PREFERENCES, Context.MODE_PRIVATE)
            .getString(AccessibilityCaptureService.KEY_LAST_SNAPSHOT, null) ?: return null
        return runCatching { JSONObject(raw) }.getOrNull()
    }

    fun armAccessibilitySnapshot(context: Context) {
        context.getSharedPreferences(AccessibilityCaptureService.PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putLong(AccessibilityCaptureService.KEY_ARMED_AT, System.currentTimeMillis())
            .putBoolean(AccessibilityCaptureService.KEY_ARMED, true)
            .apply()
    }

    private fun roundToGrid(value: Double, decimals: Int): Double {
        val factor = 10.0.powInt(decimals)
        return (value * factor).roundToInt() / factor
    }

    private fun Double.powInt(exponent: Int): Double {
        var result = 1.0
        repeat(exponent) { result *= this }
        return result
    }
}
