# CanaryMCP

[中文](#中文) | [English](#english)

## 中文

CanaryMCP 把 Android 设备上下文、Cloudflare Worker/D1 与 Remote MCP 接起来：用户逐类开启权限，手动采集并同步；已配对的 MCP 客户端只能读取该设备的数据。设备所有者还可单独配置一个 Webhook，让 AI 在用户明确要求时发出短文本。

> **状态：`0.2.1` 为待审阅候选；`v0.2.0` 已于 2026-11-14 公开发布。** 拟议 tag 为 `v0.2.1`。首个签名 Android APK 候选已构建并通过本地验签，但生产 Cloudflare、Android 真机权限、外部 MCP 客户端和收件端签名尚未端到端验证；公开 Release 仍须审阅确切 tag、notes 与附件，并完成 `PRE-RELEASE-CHECKLIST.md` 中的阻塞项。

### 能力与边界

| 类别 | 读取范围 | 默认行为 / 限制 |
| --- | --- | --- |
| 电量 | 电量百分比、充电状态 | 默认关闭；手动同步。 |
| 位置 | 经纬度、精度选项、准确度、provider、采集时间 | 大致位置网格化且排除 GPS provider；精确位置需另开系统权限；无后台位置/轨迹。 |
| 使用情况 | 最近 24 小时最多 15 个活跃应用的包名、前台时长、最近使用时间 | 需要 Android Usage Access 与 App 开关。 |
| 无障碍快照 | 单个窗口树摘要，节点/文字数量有上限 | 默认关闭；用户须在 App 主动武装一次；2 分钟超时；过滤密码节点文字；仍可能读到敏感屏幕内容，且分发政策未确认。 |
| 设备摘要 | 厂商/型号、Android 与 App 版本、语言、时区 | 不读取 IMEI、Android ID、序列号或广告 ID。 |
| 网络 | 当前传输类型、Internet/validated/metered 状态 | 不读取 SSID、IP、MAC、DNS 或路由。 |
| 存储 | 内部存储总量/可用量、低空间标记 | 按 64 MiB 取整；不读取文件或目录。 |

所有数据类别默认关闭；没有后台采集或定时同步。上传由“同步已授权数据”按钮触发。Worker 对七类载荷分别验证字段白名单、类型与数量，并将每设备每类别最新值保存最多 7 天；用户关闭类别、删除全部快照或撤销设备时，App 会请求云端删除。离线删除无法保证实时完成。

### Remote MCP 工具

| 工具 | 作用 | 权限边界 |
| --- | --- | --- |
| `read_device_context` | 读取一个指定类别的最新快照 | 必须点名类别；一次不批量读取，缺失数据不能推断为关闭或“当前为零”。 |
| `get_device_status` | 返回可用类别与过期时间 | 不返回上下文内容。 |
| `get_webhook_status` | 返回 Webhook 配置/启用状态 | 不返回目标 URL 或签名密钥。 |
| `get_webhook_delivery_history` | 返回最近十次投递时间与 HTTP 结果 | 不保存/返回正文、目标或密钥。 |
| `send_webhook_message` | 向 App 所有者已设置的唯一目标发送 `title` 和 `message` | 只有用户明确要求发送时才调用；AI 不能给 URL、附带设备数据或修改 header。每设备每分钟最多 5 次、每小时最多 20 次。 |

Webhook 默认关闭。目标必须是 HTTPS/DNS 主机名（443），拒绝常见 IP 字面量、内网名称、用户名密码和重定向；配置以 AES-GCM 加密在 D1 中保存，可选 HMAC-SHA256 签名。当前 Worker 没有私网 VPC 绑定，依赖 Cloudflare 普通出站代理限制；应用自身不做 DNS pinning，因此只应配置可信的公网服务。详情和风险边界见[安全说明](docs/guide/privacy-security.md)与[Webhook 指南](docs/guide/webhooks.md)。

### 本地开发

需要 Node.js 22（22.12+）与 npm。仓库根目录运行：

```bash
npm ci
cp .dev.vars.example .dev.vars
# 为两个 secret 分别生成互不相同的 32-byte 随机值：
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
# 将不同的生成结果填入 PAIRING_SECRET 与 WEBHOOK_ENCRYPTION_KEY；不要提交 .dev.vars
npm run db:local
npm run dev
```

Worker 本地地址默认为 `http://localhost:8787`；本地数据库与线上 D1 分离。Android Debug 模拟器可使用 `http://10.0.2.2:8787`，正式变体只允许 HTTPS。配对密钥会发送到 App 中填写的 Worker；仅向你控制或充分信任的端点配对。健康检查：`GET /health`。

### 部署到 Cloudflare

1. GitHub Actions 设置变量 `CLOUDFLARE_ACCOUNT_ID`，并设置密钥 `CLOUDFLARE_API_TOKEN`、`CANARYMCP_PAIRING_SECRET` 与 `WEBHOOK_ENCRYPTION_KEY`。
2. 两个应用密钥必须互相独立；生产配对密钥至少 32 字符，推荐 32-byte 随机 base64url。Webhook 加密密钥必须是 32 随机字节的 43 字符 base64url 值。
3. 手动运行 **Actions → Deploy Worker → Run workflow**。Workflow 校验输入、测试/构建、按需创建 D1、应用 migrations、通过 Wrangler 上传 Worker secrets 并部署；push 不会自动部署生产。
4. 配对前确认 `wrangler.jsonc` 中 D1 ID 指向目标账号，且 Worker/D1 token 权限满足最小权限要求。

不要把真实值放在 Git、截图、Issue、URL 或文档中。更换 `WEBHOOK_ENCRYPTION_KEY` 会使既有加密配置无法解密；先在 App 删除 Webhook 再轮换。

### Android App

使用 Android Studio 打开 `Android/`：compile/target SDK 35、min SDK 26、JDK 17。调试构建：

```bash
cd Android
./gradlew assembleDebug
```

配对后设备写入 token、MCP 只读 token 与 Webhook 本地配置分别由 Android Keystore 加密。复制 MCP token 是显式操作，剪贴板会在 1 分钟后尝试清除；Webhook URL 默认遮蔽并可短暂显示。App 恢复前台时会向 Worker 回查 Webhook 状态。关闭类别会在共享互斥锁下请求删除，避免旧删除请求覆盖新同步。

`v0.2.1` 候选 APK 已完成签名 Release 构建和本地证书校验，但尚未进行真机测试，也不代表应用商店政策已确认。不要把 Debug APK 当作发行附件。无障碍服务涉及高敏感信息，公开发布前必须确认产品用途与应用商店规则。

### 文档站

VitePress 中英文文档位于 `docs/`，包含快速开始、Android 授权说明、MCP 客户端、Webhook、API 参考、安全模型和运维/Release 流程；提供内置本地搜索。

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

### 验证

```bash
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run docs:build
CI=1 npm run db:local
npx wrangler deploy --dry-run
```

Worker 单元测试、静态文档构建和 Wrangler dry-run 不等同于生产 Cloudflare 集成测试。Android 构建需 JDK 17 与 Android SDK；真机权限撤权、MCP 互操作、Webhook 收件端 HMAC 验证和正式隐私/跨境说明仍待维护者确认。

### 项目文档

- [VitePress 中文首页](docs/index.md)、[快速开始](docs/guide/quickstart.md)、[Android App](docs/guide/android-app.md)
- [MCP 客户端](docs/guide/mcp-client.md)、[Webhook 消息](docs/guide/webhooks.md)、[API 参考](docs/guide/api-reference.md)
- [隐私与安全](docs/guide/privacy-security.md)、[部署/开发/发布](docs/guide/operations.md)
- [数据隐私](DATA-PRIVACY.md)、[安全政策](SECURITY.md)、[贡献指南](CONTRIBUTING.md)、[发布检查清单](PRE-RELEASE-CHECKLIST.md)、[变更记录](CHANGELOG.md)
- Apache-2.0，见 [LICENSE](LICENSE)。

---

## English

CanaryMCP connects Android device context to a Cloudflare Worker/D1 backend and a Remote MCP endpoint. The owner opts into each category and starts every upload manually. Paired MCP clients can read only that device. The owner may separately configure one webhook destination so an AI client can send short text when the user explicitly asks.

> **Status: `0.2.1` is a candidate under review; `v0.2.0` was publicly released on 2026-11-14.** Proposed tag: `v0.2.1`. The first signed Android APK candidate has been built and locally verified, but production Cloudflare, real-device permission flows, external MCP interoperability, and receiver-side signature checks have not been end-to-end tested. Review the exact tag, notes, and attachments and resolve the blockers in `PRE-RELEASE-CHECKLIST.md` before public release.

### Capabilities and boundaries

| Category | Data read | Default / limits |
| --- | --- | --- |
| Battery | Percentage and charging state | Off by default; manual sync. |
| Location | Coordinates, precision choice, accuracy, provider, capture time | Approximate mode rounds coordinates and excludes GPS; precise mode needs a separate system permission; no background tracking or route history. |
| App usage | Up to 15 active packages from the last 24 hours, foreground duration, last-used time | Requires Android Usage Access and an app opt-in. |
| Accessibility snapshot | A bounded one-window node-tree summary | Off by default; one-shot arming by the owner; 2-minute expiry; password node text is skipped. Other visible text may still be sensitive; distribution-policy review is pending. |
| Device summary | Manufacturer/model, Android/App version, locale, time zone | No IMEI, Android ID, serial number, or advertising ID. |
| Network | Active transport, Internet/validated/metered state | No SSID, IP, MAC, DNS, or routes. |
| Storage | Internal total/available bytes and low-space flag | Rounded to 64 MiB; no file or directory reads. |

Every category is off by default. There is no background collection or scheduled upload; the owner taps **Sync authorized data**. The Worker validates an allowlist, types, and item counts for all seven categories. D1 keeps only the latest snapshot per device/category for up to seven days. Disabling a category, deleting all context, or revoking a device requests cloud deletion; offline deletion cannot be guaranteed immediately.

### Remote MCP tools

| Tool | Purpose | Scope |
| --- | --- | --- |
| `read_device_context` | Read the latest snapshot for one selected category | A category is required; no bulk read. Missing data does not imply opt-out or a zero value. |
| `get_device_status` | List available categories and expiry times | No snapshot values. |
| `get_webhook_status` | Read configured/enabled state | No destination URL or signing key. |
| `get_webhook_delivery_history` | Read the latest ten times and HTTP outcomes | No body, destination, or key is retained/returned. |
| `send_webhook_message` | Send `title` and `message` to the single app-configured destination | Call only after the user explicitly asks; no AI-supplied URL, device context, or custom headers. Per-device limits: 5/minute and 20/hour. |

Webhook is off by default. Its destination must be an HTTPS DNS hostname on port 443; common IP literals, internal names, userinfo, and redirects are rejected. The destination is AES-GCM encrypted in D1 and may use an HMAC-SHA256 signature. The current Worker has no private VPC binding and relies on Cloudflare's normal outbound proxy boundary; the app does not pin DNS resolutions, so use only a trusted public service. See [Privacy & security](docs/en/guide/privacy-security.md) and the [Webhook guide](docs/en/guide/webhooks.md).

### Local development

Requires Node.js 22 (22.12+) and npm:

```bash
npm ci
cp .dev.vars.example .dev.vars
# Generate two independent secrets (32 random bytes each):
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
# Put different generated values in PAIRING_SECRET and WEBHOOK_ENCRYPTION_KEY; never commit .dev.vars
npm run db:local
npm run dev
```

The local Worker listens at `http://localhost:8787`; local D1 is separate from production. Android Debug emulators may use `http://10.0.2.2:8787`; Release variants require HTTPS. The pairing secret is sent to the Worker URL entered in the app, so pair only with an endpoint you control or fully trust. Health check: `GET /health`.

### Cloudflare deployment

1. Add GitHub Actions variable `CLOUDFLARE_ACCOUNT_ID` and secrets `CLOUDFLARE_API_TOKEN`, `CANARYMCP_PAIRING_SECRET`, and `WEBHOOK_ENCRYPTION_KEY`.
2. Use independent values. The pairing secret must be at least 32 characters (32 random bytes in base64url is recommended). The webhook key must be 32 random bytes encoded as a 43-character base64url value.
3. Manually run **Actions → Deploy Worker → Run workflow**. It validates inputs, checks/builds, creates D1 if needed, applies migrations, uploads Worker secrets with Wrangler, and deploys. Pushes do not deploy production automatically.
4. Confirm the D1 ID in `wrangler.jsonc` points to the intended account and scope API permissions narrowly.

Never commit real values or paste them into screenshots, issues, URLs, or docs. Rotating `WEBHOOK_ENCRYPTION_KEY` makes existing ciphertext unreadable; delete webhook settings in Android before rotation.

### Android app

Open `Android/` in Android Studio. It uses compile/target SDK 35, min SDK 26, and JDK 17:

```bash
cd Android
./gradlew assembleDebug
```

Android Keystore encrypts the device-write token, MCP-read-only token, and local webhook settings. Copying the MCP token is explicit; the clipboard is cleared after one minute when possible. The webhook URL is masked by default. On resume, the app checks webhook state from the Worker. Category deletion is serialized with sync and re-checks the latest owner preference before sending.

The `v0.2.1` candidate APK has been built and its certificate verified locally; it has not been tested on a real device or reviewed against app-store policy. Never use a Debug APK as a production release. Accessibility-service usage is highly sensitive and needs product-purpose and app-store policy review.

### Documentation site

`docs/` contains bilingual VitePress guides for quick start, Android consent, MCP clients, webhooks, API, privacy/security, operations, and release. It includes local search.

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

### Checks

```bash
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run docs:build
CI=1 npm run db:local
npx wrangler deploy --dry-run
```

Unit tests, static docs generation, and a Wrangler dry run do not prove production Cloudflare integration. Android builds require JDK 17 and the Android SDK. Real-device revocation, MCP interoperability, receiver-side HMAC verification, and final privacy/data-transfer notices remain for maintainer review.

### Project documents

- [VitePress home](docs/en/index.md), [quick start](docs/en/guide/quickstart.md), [Android app](docs/en/guide/android-app.md)
- [MCP client](docs/en/guide/mcp-client.md), [webhooks](docs/en/guide/webhooks.md), [API reference](docs/en/guide/api-reference.md)
- [Privacy & security](docs/en/guide/privacy-security.md), [operations and release](docs/en/guide/operations.md)
- [Data privacy](DATA-PRIVACY.md), [security policy](SECURITY.md), [contributing](CONTRIBUTING.md), [pre-release checklist](PRE-RELEASE-CHECKLIST.md), [changelog](CHANGELOG.md)
- Apache-2.0; see [LICENSE](LICENSE).
