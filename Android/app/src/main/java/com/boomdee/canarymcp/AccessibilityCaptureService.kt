package com.boomdee.canarymcp

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.ArrayDeque

class AccessibilityCaptureService : AccessibilityService() {
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        if (event.packageName?.toString() == packageName) return
        val preferences = getSharedPreferences(PREFERENCES, MODE_PRIVATE)
        if (!preferences.getBoolean(KEY_ARMED, false)) return
        val armedAt = preferences.getLong(KEY_ARMED_AT, 0L)
        if (armedAt <= 0L || System.currentTimeMillis() - armedAt > MAX_ARMED_MILLIS) {
            preferences.edit().remove(KEY_ARMED_AT).putBoolean(KEY_ARMED, false).apply()
            return
        }
        val root = rootInActiveWindow
        if (root == null) {
            preferences.edit().remove(KEY_ARMED_AT).putBoolean(KEY_ARMED, false).apply()
            return
        }
        val nodes = JSONArray()
        val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
        queue.add(root to 0)
        var processed = 0
        while (queue.isNotEmpty() && processed < MAX_NODES) {
            val (node, depth) = queue.removeFirst()
            processed += 1
            val bounds = android.graphics.Rect()
            node.getBoundsInScreen(bounds)
            val entry = JSONObject()
                .put("className", node.className?.toString()?.take(100) ?: JSONObject.NULL)
                .put("clickable", node.isClickable)
                .put("enabled", node.isEnabled)
                .put("bounds", JSONObject()
                    .put("left", bounds.left)
                    .put("top", bounds.top)
                    .put("right", bounds.right)
                    .put("bottom", bounds.bottom))
            if (!node.isPassword) {
                val text = node.text?.toString()?.trim()?.take(MAX_TEXT_CHARS)
                val description = node.contentDescription?.toString()?.trim()?.take(MAX_TEXT_CHARS)
                if (!text.isNullOrBlank()) entry.put("text", text)
                if (!description.isNullOrBlank()) entry.put("description", description)
            }
            nodes.put(entry)
            if (depth < MAX_DEPTH) {
                for (index in 0 until node.childCount) {
                    val child = runCatching { node.getChild(index) }.getOrNull() ?: continue
                    if (queue.size < MAX_NODES) queue.add(child to depth + 1)
                }
            }
        }
        val snapshot = JSONObject()
            .put("packageName", event.packageName?.toString()?.take(200) ?: "unknown")
            .put("capturedAt", Instant.now().toString())
            .put("nodes", nodes)
            .put("truncated", queue.isNotEmpty())
        preferences.edit()
            .putString(KEY_LAST_SNAPSHOT, snapshot.toString())
            .putString(KEY_ARMED_AT, null)
            .putBoolean(KEY_ARMED, false)
            .apply()
    }

    override fun onInterrupt() = Unit

    companion object {
        const val PREFERENCES = "canary_capture"
        const val KEY_ARMED = "capture_armed"
        const val KEY_ARMED_AT = "capture_armed_at"
        const val KEY_LAST_SNAPSHOT = "last_snapshot"
        private const val MAX_NODES = 100
        private const val MAX_DEPTH = 7
        private const val MAX_TEXT_CHARS = 160
        private const val MAX_ARMED_MILLIS = 2 * 60 * 1000L
    }
}
