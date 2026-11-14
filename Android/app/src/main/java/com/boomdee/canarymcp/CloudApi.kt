package com.boomdee.canarymcp

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class CloudApi(private val baseUrl: String, private val token: String? = null) {
    data class PairingResult(val deviceId: String, val deviceToken: String, val mcpToken: String)

    suspend fun pair(pairingSecret: String, label: String): PairingResult = withContext(Dispatchers.IO) {
        val response = request(
            method = "POST",
            path = "/v1/pair",
            body = JSONObject().put("pairingSecret", pairingSecret).put("label", label),
        )
        PairingResult(response.getString("deviceId"), response.getString("deviceToken"), response.getString("mcpToken"))
    }

    suspend fun upload(category: String, capturedAt: String, payload: JSONObject) = withContext(Dispatchers.IO) {
        request(
            method = "POST",
            path = "/v1/context",
            body = JSONObject()
                .put("category", category)
                .put("capturedAt", capturedAt)
                .put("payload", payload),
            authenticated = true,
        )
    }

    suspend fun deleteCategory(category: String) = withContext(Dispatchers.IO) {
        request(method = "DELETE", path = "/v1/context/$category", authenticated = true)
    }

    suspend fun deleteAllContext() = withContext(Dispatchers.IO) {
        request(method = "DELETE", path = "/v1/context", authenticated = true)
    }

    suspend fun revokeDevice() = withContext(Dispatchers.IO) {
        request(method = "DELETE", path = "/v1/device", authenticated = true)
    }

    suspend fun sync(context: Context, preferences: android.content.SharedPreferences): Int = withContext(Dispatchers.IO) {
        var sent = 0
        if (preferences.getBoolean("share_battery", false)) {
            upload("battery", java.time.Instant.now().toString(), DeviceCollectors.battery(context))
            sent += 1
        }
        if (preferences.getBoolean("share_location", false)) {
            val location = DeviceCollectors.location(context, preferences.getBoolean("precise_location", false))
            if (location != null) {
                upload("location", java.time.Instant.now().toString(), location)
                sent += 1
            }
        }
        if (preferences.getBoolean("share_usage", false)) {
            val usage = DeviceCollectors.usage(context)
            if (usage != null) {
                upload("usage", java.time.Instant.now().toString(), usage)
                sent += 1
            }
        }
        if (preferences.getBoolean("share_accessibility", false) && DeviceCollectors.isAccessibilityEnabled(context)) {
            val snapshot = DeviceCollectors.savedAccessibilitySnapshot(context)
            if (snapshot != null) {
                upload("accessibility", snapshot.optString("capturedAt", java.time.Instant.now().toString()), snapshot)
                sent += 1
            }
        }
        sent
    }

    private fun request(
        method: String,
        path: String,
        body: JSONObject? = null,
        authenticated: Boolean = false,
    ): JSONObject {
        if (authenticated && token.isNullOrBlank()) throw IllegalStateException("请先配对设备。")
        val root = baseUrl.trim().trimEnd('/')
        val parsed = runCatching { URL(root) }.getOrElse { throw IllegalArgumentException("Worker 地址无效。") }
        val localDebugHost = BuildConfig.DEBUG && parsed.host.lowercase() in setOf("localhost", "127.0.0.1", "10.0.2.2")
        if (parsed.protocol != "https" && !(localDebugHost && parsed.protocol == "http")) {
            throw IllegalArgumentException("Worker 地址必须使用 HTTPS。")
        }
        if (parsed.userInfo != null || parsed.query != null || parsed.ref != null) {
            throw IllegalArgumentException("Worker 地址不能包含用户名、查询参数或片段。")
        }
        val connection = (URL(root + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 12_000
            readTimeout = 15_000
            useCaches = false
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Cache-Control", "no-store")
            if (authenticated) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
        }
        return try {
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (status !in 200..299) {
                val errorCode = runCatching { JSONObject(text).optString("error") }.getOrDefault("")
                val message = when (errorCode) {
                    "invalid_credentials", "unauthorized" -> "配对密钥或令牌无效，请检查连接设置。"
                    "pairing_not_configured" -> "Worker 尚未设置配对密钥。"
                    "body_too_large" -> "快照过大，未上传。"
                    else -> "Worker 请求失败（HTTP $status）。"
                }
                throw ApiException(message)
            }
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    class ApiException(message: String) : Exception(message)
}
