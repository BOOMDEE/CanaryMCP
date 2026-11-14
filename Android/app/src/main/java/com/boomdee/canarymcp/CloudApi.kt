package com.boomdee.canarymcp

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.URI
import java.net.HttpURLConnection
import java.net.URL

private object DeviceMutationLock {
    val mutex = Mutex()
}

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

    suspend fun deleteCategory(category: String, shouldDelete: () -> Boolean = { true }): Boolean = withContext(Dispatchers.IO) {
        DeviceMutationLock.mutex.withLock {
            if (!shouldDelete()) false else {
                request(method = "DELETE", path = "/v1/context/$category", authenticated = true)
                true
            }
        }
    }

    suspend fun deleteAllContext() = withContext(Dispatchers.IO) {
        DeviceMutationLock.mutex.withLock {
            request(method = "DELETE", path = "/v1/context", authenticated = true)
        }
    }

    suspend fun revokeDevice() = withContext(Dispatchers.IO) {
        DeviceMutationLock.mutex.withLock {
            request(method = "DELETE", path = "/v1/device", authenticated = true)
        }
    }

    suspend fun configureWebhook(url: String, signingSecret: String, enabled: Boolean) = withContext(Dispatchers.IO) {
        validateWebhookTarget(url)
        request(
            method = "PUT",
            path = "/v1/webhook",
            body = JSONObject().put("url", url).put("signingSecret", signingSecret).put("enabled", enabled),
            authenticated = true,
        )
    }

    suspend fun webhookStatus() = withContext(Dispatchers.IO) {
        request(method = "GET", path = "/v1/webhook", authenticated = true)
    }

    suspend fun deleteWebhook() = withContext(Dispatchers.IO) {
        request(method = "DELETE", path = "/v1/webhook", authenticated = true)
    }

    suspend fun sync(context: Context, preferences: android.content.SharedPreferences): Int = withContext(Dispatchers.IO) {
        DeviceMutationLock.mutex.withLock {
            var sent = 0
            if (preferences.getBoolean("share_battery", false)) {
                upload("battery", java.time.Instant.now().toString(), DeviceCollectors.battery(context))
                sent += 1
            }
            if (preferences.getBoolean("share_location", false)) {
                val location = DeviceCollectors.location(context, preferences.getBoolean("precise_location", false))
                if (location != null) {
                    upload("location", java.time.Instant.now().toString(), location)
                    preferences.edit().putBoolean("location_redaction_pending", false).apply()
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
            if (preferences.getBoolean("share_device", false)) {
                upload("device", java.time.Instant.now().toString(), DeviceCollectors.device(context))
                sent += 1
            }
            if (preferences.getBoolean("share_network", false)) {
                upload("network", java.time.Instant.now().toString(), DeviceCollectors.network(context))
                sent += 1
            }
            if (preferences.getBoolean("share_storage", false)) {
                upload("storage", java.time.Instant.now().toString(), DeviceCollectors.storage())
                sent += 1
            }
            sent
        }
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
        if (parsed.userInfo != null || parsed.query != null || parsed.ref != null || parsed.path !in setOf("", "/") || (parsed.port != -1 && parsed.port != 443 && !localDebugHost)) {
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
                    "invalid_webhook_config" -> "Webhook 地址或签名密钥无效；请检查 HTTPS 地址及签名密钥长度。"
                    "webhook_not_configured" -> "Worker 尚未设置 Webhook 加密密钥。"
                    else -> "Worker 请求失败（HTTP $status）。"
                }
                throw ApiException(message)
            }
            if (text.isBlank()) JSONObject() else JSONObject(text)
        } finally {
            connection.disconnect()
        }
    }

    private fun validateWebhookTarget(value: String) {
        val parsed = runCatching { URI(value) }.getOrElse { throw IllegalArgumentException("Webhook 目标必须是 HTTPS 公网域名。") }
        val hostname = parsed.host?.lowercase()?.removeSuffix(".")
        val validDnsName = hostname != null && Regex("^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$").matches(hostname)
        val blockedSuffixes = listOf(".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".onion")
        if (
            parsed.scheme != "https" || !validDnsName ||
            parsed.rawUserInfo != null || (parsed.port != -1 && parsed.port != 443) || parsed.rawFragment != null ||
            blockedSuffixes.any { hostname!!.endsWith(it) } || hostname == "home.arpa"
        ) throw IllegalArgumentException("Webhook 目标必须是 HTTPS / 443 公网域名，不能包含用户名或片段。")
    }

    class ApiException(message: String) : Exception(message)
}
