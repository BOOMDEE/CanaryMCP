package com.boomdee.canarymcp

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.launch
import java.security.MessageDigest

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { CanaryTheme { CanaryHome() } }
    }
}

@Composable
private fun CanaryTheme(content: @Composable () -> Unit) {
    val context = LocalContext.current
    val dark = androidx.compose.foundation.isSystemInDarkTheme()
    val scheme = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    } else if (dark) {
        darkColorScheme()
    } else {
        lightColorScheme()
    }
    MaterialTheme(colorScheme = scheme, content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CanaryHome() {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()
    val settings = remember { context.getSharedPreferences("canary_settings", Context.MODE_PRIVATE) }
    val tokenStore = remember { SecureTokenStore(context) }
    val snackbars = remember { SnackbarHostState() }

    var workerUrl by rememberSaveable { mutableStateOf(settings.getString("worker_url", "") ?: "") }
    var pairingSecret by rememberSaveable { mutableStateOf("") }
    var paired by remember { mutableStateOf(tokenStore.readDeviceToken() != null) }
    var deviceLabel by rememberSaveable { mutableStateOf(settings.getString("device_label", "Android 手机") ?: "Android 手机") }
    var deviceId by rememberSaveable { mutableStateOf(settings.getString("device_id", "") ?: "") }
    var isBusy by remember { mutableStateOf(false) }
    var askRevoke by remember { mutableStateOf(false) }
    var showPrivacy by remember { mutableStateOf(false) }
    var refreshCounter by remember { mutableIntStateOf(0) }
    var usagePending by rememberSaveable { mutableStateOf(false) }
    var accessibilityPending by rememberSaveable { mutableStateOf(false) }
    var webhookUrl by remember { mutableStateOf(tokenStore.readWebhookUrl().orEmpty()) }
    var webhookSigningSecret by remember { mutableStateOf(tokenStore.readWebhookSigningSecret().orEmpty()) }
    var webhookConfigured by remember { mutableStateOf(settings.getBoolean("webhook_configured", false)) }
    var webhookEnabled by remember { mutableStateOf(settings.getBoolean("webhook_enabled", false)) }
    var webhookStatusKnown by remember { mutableStateOf(false) }
    var revealWebhookUrl by remember { mutableStateOf(false) }

    var batteryEnabled by rememberSaveable { mutableStateOf(settings.getBoolean("share_battery", false)) }
    var locationEnabled by rememberSaveable { mutableStateOf(settings.getBoolean("share_location", false)) }
    var preciseLocation by rememberSaveable { mutableStateOf(settings.getBoolean("precise_location", false)) }
    var usageEnabled by rememberSaveable { mutableStateOf(settings.getBoolean("share_usage", false)) }
    var accessibilityEnabled by rememberSaveable { mutableStateOf(settings.getBoolean("share_accessibility", false)) }
    var deviceEnabled by rememberSaveable { mutableStateOf(settings.getBoolean("share_device", false)) }
    var networkEnabled by rememberSaveable { mutableStateOf(settings.getBoolean("share_network", false)) }
    var storageEnabled by rememberSaveable { mutableStateOf(settings.getBoolean("share_storage", false)) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshCounter += 1
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val usageSettingsLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val granted = DeviceCollectors.hasUsageAccess(context)
        if (usagePending && granted) {
            usageEnabled = true
            settings.edit().putBoolean("share_usage", true).apply()
            usagePending = false
        } else if (usagePending) {
            usagePending = false
            scope.launch { snackbars.showSnackbar("未开启使用情况访问；该类别保持关闭。") }
        }
        refreshCounter += 1
    }
    val accessibilitySettingsLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val enabledInSystem = DeviceCollectors.isAccessibilityEnabled(context)
        if (accessibilityPending && enabledInSystem) {
            accessibilityEnabled = true
            settings.edit().putBoolean("share_accessibility", true).apply()
            accessibilityPending = false
        } else if (accessibilityPending) {
            accessibilityPending = false
            scope.launch { snackbars.showSnackbar("无障碍服务未开启；快照分享保持关闭。") }
        }
        refreshCounter += 1
    }
    val coarseLocationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted || hasAnyLocationPermission(context)) {
            locationEnabled = true
            settings.edit().putBoolean("share_location", true).apply()
        } else {
            locationEnabled = false
            settings.edit().putBoolean("share_location", false).apply()
            scope.launch { snackbars.showSnackbar("未授予位置权限；位置分享保持关闭。") }
        }
        refreshCounter += 1
    }
    val fineLocationLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val fineGranted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true
        val coarseGranted = result[Manifest.permission.ACCESS_COARSE_LOCATION] == true || hasAnyLocationPermission(context)
        if (coarseGranted) {
            locationEnabled = true
            settings.edit().putBoolean("share_location", true).apply()
        }
        preciseLocation = fineGranted
        settings.edit().putBoolean("precise_location", fineGranted).apply()
        if (!fineGranted) scope.launch { snackbars.showSnackbar("精确位置未授予，仍可继续使用大致位置。") }
        refreshCounter += 1
    }

    fun removeRemoteSnapshot(category: String) {
        val settingKey = when (category) {
            "battery" -> "share_battery"
            "location" -> "share_location"
            "usage" -> "share_usage"
            "accessibility" -> "share_accessibility"
            "device" -> "share_device"
            "network" -> "share_network"
            "storage" -> "share_storage"
            else -> return
        }
        val token = tokenStore.readDeviceToken() ?: return
        val baseUrl = workerUrl
        scope.launch {
            try {
                val deleted = CloudApi(baseUrl, token).deleteCategory(category) {
                    (category == "location" && settings.getBoolean("location_redaction_pending", false)) ||
                        !settings.getBoolean(settingKey, false)
                }
                if (category == "location" && deleted) settings.edit().putBoolean("location_redaction_pending", false).apply()
            } catch (_: Exception) {
                snackbars.showSnackbar("云端$category 快照删除失败；联网后请重试。")
            }
        }
    }

    LaunchedEffect(refreshCounter, paired) {
        if (locationEnabled && !hasAnyLocationPermission(context)) {
            locationEnabled = false
            settings.edit().putBoolean("share_location", false).apply()
            removeRemoteSnapshot("location")
        }
        if (usageEnabled && !DeviceCollectors.hasUsageAccess(context)) {
            usageEnabled = false
            settings.edit().putBoolean("share_usage", false).apply()
            removeRemoteSnapshot("usage")
        }
        if (accessibilityEnabled && !DeviceCollectors.isAccessibilityEnabled(context)) {
            accessibilityEnabled = false
            settings.edit().putBoolean("share_accessibility", false).apply()
            context.getSharedPreferences(AccessibilityCaptureService.PREFERENCES, Context.MODE_PRIVATE)
                .edit().remove(AccessibilityCaptureService.KEY_LAST_SNAPSHOT)
                .putBoolean(AccessibilityCaptureService.KEY_ARMED, false).apply()
            removeRemoteSnapshot("accessibility")
        }
        if (!hasFineLocationPermission(context) && preciseLocation) {
            preciseLocation = false
            settings.edit().putBoolean("precise_location", false).putBoolean("location_redaction_pending", true).apply()
        }
        if (settings.getBoolean("location_redaction_pending", false)) removeRemoteSnapshot("location")
        if (paired) {
            val readToken = tokenStore.readMcpToken()
            if (readToken != null) {
                try {
                    val remote = CloudApi(workerUrl, readToken).webhookStatus()
                    webhookConfigured = remote.optBoolean("configured", false)
                    webhookEnabled = remote.optBoolean("enabled", false)
                    webhookStatusKnown = true
                    settings.edit()
                        .putBoolean("webhook_configured", webhookConfigured)
                        .putBoolean("webhook_enabled", webhookEnabled)
                        .apply()
                    if (!webhookConfigured) {
                        tokenStore.clearWebhookConfiguration()
                        webhookUrl = ""
                        webhookSigningSecret = ""
                    }
                } catch (_: Exception) {
                    webhookStatusKnown = false
                }
            } else {
                webhookStatusKnown = false
            }
        }
    }

    fun saveConsent(key: String, value: Boolean) {
        settings.edit().putBoolean(key, value).apply()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Column {
                    Text("CanaryMCP")
                    Text("设备上下文 · 逐项授权", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } },
                actions = { TextButton(onClick = { showPrivacy = true }) { Text("隐私说明") } },
            )
        },
        snackbarHost = { SnackbarHost(snackbars) },
    ) { insets ->
        Column(
            modifier = Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("连接 Worker", style = MaterialTheme.typography.titleLarge)
            OutlinedTextField(
                value = workerUrl,
                onValueChange = { workerUrl = it; settings.edit().putString("worker_url", it).apply() },
                modifier = Modifier.fillMaxWidth(),
                enabled = !paired,
                label = { Text("Worker HTTPS 地址") },
                placeholder = { Text("https://canary-mcp.<你的账号>.workers.dev") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                singleLine = true,
                supportingText = { Text(if (paired) "请先撤销设备配对后再更换 Worker。" else "正式 Worker 使用 HTTPS；Debug 版仅对本机测试地址允许 HTTP。") },
            )
            OutlinedTextField(
                value = deviceLabel,
                onValueChange = { deviceLabel = it.take(80); settings.edit().putString("device_label", it.take(80)).apply() },
                modifier = Modifier.fillMaxWidth(),
                enabled = !paired,
                label = { Text("设备标签") },
                singleLine = true,
            )
            if (!paired) {
                OutlinedTextField(
                    value = pairingSecret,
                    onValueChange = { pairingSecret = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("配对密钥") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    supportingText = { Text("只在配对请求中发送，不保存在本机；仅向你信任的 Worker 地址发送共享密钥。") },
                )
                Button(
                    onClick = {
                        if (workerUrl.isBlank() || pairingSecret.isBlank()) {
                            scope.launch { snackbars.showSnackbar("请填写 Worker 地址和配对密钥。") }
                        } else {
                            isBusy = true
                            scope.launch {
                                try {
                                    val result = CloudApi(workerUrl).pair(pairingSecret, deviceLabel.ifBlank { "Android 手机" })
                                    tokenStore.save(result.deviceToken, result.mcpToken)
                                    deviceId = result.deviceId
                                    settings.edit().putString("device_id", result.deviceId).apply()
                                    paired = true
                                    webhookStatusKnown = false
                                    pairingSecret = ""
                                    snackbars.showSnackbar("设备已配对。写入令牌与 MCP 只读令牌已分别加密保存。")
                                } catch (error: Exception) {
                                    snackbars.showSnackbar(error.message ?: "配对失败，请检查 Worker 地址与网络。")
                                } finally { isBusy = false }
                            }
                        }
                    },
                    enabled = !isBusy,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(if (isBusy) "正在配对…" else "配对设备") }
            } else {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("已配对", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                        Text("设备：${deviceLabel.ifBlank { "Android 手机" }}")
                        if (deviceId.isNotBlank()) Text("设备 ID：${deviceId.take(8)}…", style = MaterialTheme.typography.bodySmall)
                        Text("MCP 地址：${workerUrl.trimEnd('/')}/mcp", style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = {
                                val token = tokenStore.readMcpToken()
                                if (token == null) {
                                    scope.launch { snackbars.showSnackbar("令牌不可用，请重新配对。") }
                                } else {
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    clipboard.setPrimaryClip(ClipData.newPlainText("CanaryMCP MCP bearer token", token))
                                    val copiedFingerprint = sha256Fingerprint(token)
                                    Handler(Looper.getMainLooper()).postDelayed({
                                        val currentText = runCatching {
                                            clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(context)?.toString()
                                        }.getOrNull()
                                        if (currentText != null && sha256Fingerprint(currentText) == copiedFingerprint) {
                                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) clipboard.clearPrimaryClip()
                                            else clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
                                        }
                                    }, 60_000)
                                    Toast.makeText(context, "MCP 令牌已复制，1 分钟后尝试自动清除；请勿分享给不受信任的服务。", Toast.LENGTH_LONG).show()
                                }
                            }) { Text("复制 MCP 令牌") }
                            OutlinedButton(onClick = { askRevoke = true }) { Text("撤销设备") }
                        }
                    }
                }
            }

            Spacer(Modifier.height(4.dp))
            Text("按类别授权", style = MaterialTheme.typography.titleLarge)
            Text("默认全部关闭。每次上传都由你手动触发；关闭类别会请求删除云端该类快照。", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

            ConsentCard(
                title = "电量状态",
                description = "电量百分比与充电状态。无需系统权限；仅在手动同步时读取。",
                checked = batteryEnabled,
                onCheckedChange = { enabled ->
                    batteryEnabled = enabled
                    saveConsent("share_battery", enabled)
                    if (!enabled) removeRemoteSnapshot("battery")
                },
            )
            ConsentCard(
                title = "位置",
                description = "位置权限只在打开本项后请求；仅上传最新坐标，不记录轨迹。大致位置会网格化，精确位置需额外开启。",
                checked = locationEnabled,
                onCheckedChange = { enabled ->
                    if (!enabled) {
                        locationEnabled = false
                        saveConsent("share_location", false)
                        removeRemoteSnapshot("location")
                    } else if (hasAnyLocationPermission(context)) {
                        locationEnabled = true
                        saveConsent("share_location", true)
                    } else {
                        coarseLocationLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
                    }
                },
                secondary = {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        Column(Modifier.weight(1f)) {
                            Text("精确位置", style = MaterialTheme.typography.titleSmall)
                            Text("额外请求精确位置权限；关闭后仅用大致坐标。", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        Switch(
                            checked = preciseLocation,
                            enabled = locationEnabled,
                            onCheckedChange = { enabled ->
                                if (!enabled) {
                                    preciseLocation = false
                                    settings.edit().putBoolean("precise_location", false).putBoolean("location_redaction_pending", true).apply()
                                    removeRemoteSnapshot("location")
                                } else if (hasFineLocationPermission(context)) {
                                    preciseLocation = true
                                    saveConsent("precise_location", true)
                                } else {
                                    fineLocationLauncher.launch(arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION))
                                }
                            },
                        )
                    }
                },
            )
            ConsentCard(
                title = "应用使用情况",
                description = "最近 24 小时内前 15 个活跃应用的包名、前台时长和最近使用时间。需要你去系统设置单独授权。",
                checked = usageEnabled,
                onCheckedChange = { enabled ->
                    if (!enabled) {
                        usageEnabled = false
                        saveConsent("share_usage", false)
                        removeRemoteSnapshot("usage")
                    } else if (DeviceCollectors.hasUsageAccess(context)) {
                        usageEnabled = true
                        saveConsent("share_usage", true)
                    } else {
                        usagePending = true
                        usageSettingsLauncher.launch(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
                    }
                },
                secondary = {
                    TextButton(onClick = { usagePending = true; usageSettingsLauncher.launch(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }) {
                        Text(if (DeviceCollectors.hasUsageAccess(context)) "系统授权已开启" else "打开使用情况访问设置")
                    }
                },
            )
            ConsentCard(
                title = "无障碍树快照（实验性）",
                description = "需要在系统设置中启用服务。只在你点按一次性采集按钮后，抓取下一次切换到的单个窗口；密码节点文本会过滤，但其他屏幕文字仍可能敏感。",
                checked = accessibilityEnabled,
                onCheckedChange = { enabled ->
                    if (!enabled) {
                        accessibilityEnabled = false
                        saveConsent("share_accessibility", false)
                        context.getSharedPreferences(AccessibilityCaptureService.PREFERENCES, Context.MODE_PRIVATE)
                            .edit().remove(AccessibilityCaptureService.KEY_LAST_SNAPSHOT)
                            .putBoolean(AccessibilityCaptureService.KEY_ARMED, false).apply()
                        removeRemoteSnapshot("accessibility")
                    } else if (DeviceCollectors.isAccessibilityEnabled(context)) {
                        accessibilityEnabled = true
                        saveConsent("share_accessibility", true)
                    } else {
                        accessibilityPending = true
                        accessibilitySettingsLauncher.launch(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
                },
                secondary = {
                    TextButton(onClick = {
                        accessibilityPending = true
                        accessibilitySettingsLauncher.launch(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                    }) { Text(if (DeviceCollectors.isAccessibilityEnabled(context)) "系统服务已开启" else "打开无障碍设置") }
                    if (accessibilityEnabled && DeviceCollectors.isAccessibilityEnabled(context)) {
                        OutlinedButton(onClick = {
                            DeviceCollectors.armAccessibilitySnapshot(context)
                            scope.launch { snackbars.showSnackbar("已武装一次性快照；请在 2 分钟内切换到目标应用，超时自动取消。") }
                        }) { Text("采集下一屏（一次）") }
                    }
                },
            )

            ConsentCard(
                title = "设备摘要",
                description = "设备厂商/型号、Android 与 App 版本、系统语言和时区；不读取 IMEI、Android ID 或广告标识。",
                checked = deviceEnabled,
                onCheckedChange = { enabled ->
                    deviceEnabled = enabled
                    saveConsent("share_device", enabled)
                    if (!enabled) removeRemoteSnapshot("device")
                },
            )
            ConsentCard(
                title = "网络状态",
                description = "当前连接类型、互联网可用/验证状态和是否计费；不读取 SSID、IP、MAC 地址或浏览记录。",
                checked = networkEnabled,
                onCheckedChange = { enabled ->
                    networkEnabled = enabled
                    saveConsent("share_network", enabled)
                    if (!enabled) removeRemoteSnapshot("network")
                },
            )
            ConsentCard(
                title = "存储空间",
                description = "设备内部存储总量与可用量按 64 MiB 粗略取整，并标记是否低于 1 GiB；不读取文件名或内容。",
                checked = storageEnabled,
                onCheckedChange = { enabled ->
                    storageEnabled = enabled
                    saveConsent("share_storage", enabled)
                    if (!enabled) removeRemoteSnapshot("storage")
                },
            )

            if (paired) {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("AI Webhook 消息", style = MaterialTheme.typography.titleMedium)
                        Text(
                            when {
                                !webhookStatusKnown -> "尚未从 Worker 核实状态；本地显示仅为缓存，离线时不代表 Webhook 仍然可用。"
                                webhookEnabled -> "已启用：MCP 客户端可在你明确要求时发送短文本到此目标。目标与签名密钥已通过 Android Keystore 加密保存在本机。"
                                else -> "默认关闭。启用后，MCP 只能向你在此填写的单一 HTTPS 目标发送短文本；不会附带设备上下文，也不能自行选择目标。"
                            },
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        OutlinedTextField(
                            value = webhookUrl,
                            onValueChange = { webhookUrl = it },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !isBusy,
                            label = { Text("Webhook HTTPS URL") },
                            placeholder = { Text("https://example.net/webhook/…") },
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                            visualTransformation = if (revealWebhookUrl) VisualTransformation.None else PasswordVisualTransformation(),
                            trailingIcon = {
                                TextButton(onClick = { revealWebhookUrl = !revealWebhookUrl }) {
                                    Text(if (revealWebhookUrl) "隐藏" else "显示")
                                }
                            },
                            singleLine = true,
                            supportingText = { Text("仅允许 HTTPS / 443 端口；保存后服务器会加密保存目标。URL 可能自带访问凭证，请勿粘贴到聊天中。") },
                        )
                        OutlinedTextField(
                            value = webhookSigningSecret,
                            onValueChange = { webhookSigningSecret = it },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = !isBusy,
                            label = { Text("签名密钥（可选）") },
                            visualTransformation = PasswordVisualTransformation(),
                            singleLine = true,
                            supportingText = { Text("填写后以 HMAC-SHA256 发送 X-CanaryMCP-Signature；至少 32 个字符。") },
                        )
                        Button(
                            onClick = {
                                val token = tokenStore.readDeviceToken()
                                if (token == null || webhookUrl.isBlank()) {
                                    scope.launch { snackbars.showSnackbar("请先配对，并填写 HTTPS Webhook 地址。") }
                                } else {
                                    isBusy = true
                                    scope.launch {
                                        try {
                                            CloudApi(workerUrl, token).configureWebhook(webhookUrl.trim(), webhookSigningSecret, true)
                                            tokenStore.saveWebhookConfiguration(webhookUrl.trim(), webhookSigningSecret)
                                            webhookConfigured = true
                                            webhookEnabled = true
                                            webhookStatusKnown = true
                                            settings.edit().putBoolean("webhook_configured", true).putBoolean("webhook_enabled", true).apply()
                                            snackbars.showSnackbar("Webhook 已启用。MCP 仅可在用户明确要求时向此目标发送文字。")
                                        } catch (error: Exception) {
                                            snackbars.showSnackbar(error.message ?: "Webhook 设置失败；服务器未回显目标地址或密钥。")
                                        } finally { isBusy = false }
                                    }
                                }
                            },
                            enabled = !isBusy,
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text(if (webhookEnabled) "保存并更新目标" else "保存并启用 Webhook") }
                        if (webhookConfigured || webhookEnabled) {
                            OutlinedButton(
                                onClick = {
                                    val token = tokenStore.readDeviceToken()
                                    if (token == null) scope.launch { snackbars.showSnackbar("设备令牌不可用，请重新配对。") }
                                    else {
                                        isBusy = true
                                        scope.launch {
                                            try {
                                                CloudApi(workerUrl, token).deleteWebhook()
                                                tokenStore.clearWebhookConfiguration()
                                                webhookUrl = ""
                                                webhookSigningSecret = ""
                                                webhookConfigured = false
                                                webhookEnabled = false
                                                webhookStatusKnown = true
                                                settings.edit().putBoolean("webhook_configured", false).putBoolean("webhook_enabled", false).apply()
                                                snackbars.showSnackbar("Webhook 已停用，目标、密钥和投递历史已删除。")
                                            } catch (error: Exception) {
                                                snackbars.showSnackbar(error.message ?: "停用 Webhook 失败。")
                                            } finally { isBusy = false }
                                        }
                                    }
                                },
                                enabled = !isBusy,
                                modifier = Modifier.fillMaxWidth(),
                            ) { Text("停用并删除 Webhook 配置") }
                        }
                    }
                }
            }

            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("手动同步", style = MaterialTheme.typography.titleMedium)
                    Text("仅上传已开启类别的当前快照。服务端每类只保留最新一份，最长七天；MCP 读取仅限本设备。", style = MaterialTheme.typography.bodyMedium)
                    Button(
                        onClick = {
                            val token = tokenStore.readDeviceToken()
                            if (token == null) {
                                scope.launch { snackbars.showSnackbar("请先配对设备。") }
                            } else {
                                isBusy = true
                                scope.launch {
                                    try {
                                        val sent = CloudApi(workerUrl, token).sync(context, settings)
                                        snackbars.showSnackbar(if (sent == 0) "没有可上传的快照；请检查授权状态或先采集一屏。" else "已同步 $sent 个类别。")
                                    } catch (error: Exception) {
                                        snackbars.showSnackbar(error.message ?: "同步失败；未输出敏感数据到日志。")
                                    } finally { isBusy = false }
                                }
                            }
                        },
                        enabled = paired && !isBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (isBusy) "正在同步…" else "同步已授权数据") }
                    OutlinedButton(
                        onClick = {
                            val token = tokenStore.readDeviceToken()
                            if (token == null) scope.launch { snackbars.showSnackbar("请先配对设备。") }
                            else {
                                isBusy = true
                                scope.launch {
                                    try {
                                        CloudApi(workerUrl, token).deleteAllContext()
                                        context.getSharedPreferences(AccessibilityCaptureService.PREFERENCES, Context.MODE_PRIVATE)
                                            .edit().remove(AccessibilityCaptureService.KEY_LAST_SNAPSHOT).putBoolean(AccessibilityCaptureService.KEY_ARMED, false).apply()
                                        snackbars.showSnackbar("云端快照和本地无障碍快照已删除。")
                                    } catch (error: Exception) { snackbars.showSnackbar(error.message ?: "删除失败。") }
                                    finally { isBusy = false }
                                }
                            }
                        },
                        enabled = paired && !isBusy,
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("删除所有快照") }
                }
            }
            Spacer(Modifier.height(16.dp))
        }
    }

    if (showPrivacy) {
        AlertDialog(
            onDismissRequest = { showPrivacy = false },
            title = { Text("数据与权限") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("七类设备上下文分别开关，默认关闭；不启用后台位置、通知、通讯录，也不读取 IMEI/Android ID 等系统标识或自动同步。")
                    Text("位置、使用情况与无障碍能力只在你分别授权后使用。无障碍快照须你主动武装一次，并在切换到目标应用后采集；服务不会执行点击手势。")
                    Text("设备摘要不含系统唯一标识；网络摘要不含 SSID/IP/MAC；存储空间按 64 MiB 粗略取整。上传仅由“同步已授权数据”触发；D1 每类只保留最新快照并在七天后清理。")
                    Text("Webhook 默认关闭。启用后，AI 只能向你明确配置的 HTTPS 目标发送短文本，不能选择目标或读取配置密钥，也不会自动附带设备上下文；你可停用并删除目标与投递历史。")
                    Text("App 写入令牌、MCP 只读令牌与本地 Webhook 设置分别保存在 Android Keystore；可关闭类别删除云端数据，或删除全部快照、撤销整台设备。")
                    Text("无障碍服务面向辅助功能用途，应用商店对该权限有额外要求。发布前需确认分发平台政策与实际产品用途。")
                }
            },
            confirmButton = { TextButton(onClick = { showPrivacy = false }) { Text("知道了") } },
        )
    }

    if (askRevoke) {
        AlertDialog(
            onDismissRequest = { askRevoke = false },
            title = { Text("撤销设备配对？") },
            text = { Text("这会删除云端本设备的快照并立即撤销令牌；之后需重新配对。") },
            confirmButton = {
                TextButton(onClick = {
                    askRevoke = false
                    val token = tokenStore.readDeviceToken()
                    scope.launch {
                        isBusy = true
                        try {
                            if (token != null) CloudApi(workerUrl, token).revokeDevice()
                            tokenStore.clear()
                            context.getSharedPreferences(AccessibilityCaptureService.PREFERENCES, Context.MODE_PRIVATE)
                                .edit().clear().apply()
                            settings.edit().remove("device_id").putBoolean("webhook_configured", false).putBoolean("webhook_enabled", false).apply()
                            deviceId = ""
                            webhookUrl = ""
                            webhookSigningSecret = ""
                            webhookConfigured = false
                            webhookEnabled = false
                            webhookStatusKnown = false
                            paired = false
                            snackbars.showSnackbar("设备已撤销；云端快照与 Webhook 配置已请求删除。")
                        } catch (error: Exception) {
                            snackbars.showSnackbar(error.message ?: "撤销失败；请检查网络后重试。")
                        } finally { isBusy = false }
                    }
                }) { Text("撤销") }
            },
            dismissButton = { TextButton(onClick = { askRevoke = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun ConsentCard(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    secondary: @Composable (() -> Unit)? = null,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                Switch(checked = checked, onCheckedChange = onCheckedChange)
            }
            Text(description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            secondary?.invoke()
        }
    }
}

private fun hasAnyLocationPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

private fun hasFineLocationPermission(context: Context): Boolean =
    ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

private fun sha256Fingerprint(value: String): String = MessageDigest.getInstance("SHA-256")
    .digest(value.toByteArray(Charsets.UTF_8))
    .joinToString("") { byte -> (byte.toInt() and 0xff).toString(16).padStart(2, '0') }
