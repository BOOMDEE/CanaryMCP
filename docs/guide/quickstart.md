# 快速开始

## 需要什么

- Node.js 22.12 或更新版本，用于 Worker、Vitest 5 与文档站。
- Android Studio、JDK 17 和 Android SDK 35，用于构建 App；App 最低支持 Android 8.0（API 26）。动态配色从 Android 12 起可用。
- Cloudflare Workers 与 D1 账号仅在部署 Worker 时需要。

## 本地启动 Worker

在仓库根目录安装锁定依赖、准备本地 secret 并迁移本地 D1：

```bash
npm ci
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars：为 PAIRING_SECRET 和 WEBHOOK_ENCRYPTION_KEY 分别填写独立的 32 字节随机 base64url 值。
# 每个值应为 43 个字符；不要使用模板中的占位符作为实际 secret。
npm run db:local
npm run dev
```

开发服务器默认监听 `http://localhost:8787`。本地数据库独立于线上数据库。检查服务可用性：

```bash
curl http://localhost:8787/health
```

正常时响应包含 `{"ok":true,"service":"canary-mcp"}`。不要把 `.dev.vars` 提交到 Git。

::: tip 生成本地 Webhook 加密密钥
在安全的本地终端生成 32 字节随机 key 的 base64url 形式，并将结果写入你自己的未跟踪 `.dev.vars`：

```bash
printf 'WEBHOOK_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" >> .dev.vars
```

线上密钥必须另行生成并保存在 Cloudflare/GitHub secret 管理中。该 key 用 AES-GCM 加密 D1 中的 Webhook URL 与签名密钥；丢失后旧配置无法解密，轮换需要重新配置 Webhook。
:::

## 构建与启动 Android App

用 Android Studio 打开仓库里的 `Android/` 工程，安装 SDK 35 和 JDK 17，再构建：

```bash
cd Android
./gradlew assembleDebug
```

模拟器 Debug 构建可使用 `http://10.0.2.2:8787` 连接本机 Worker；Release 构建强制 HTTPS。App 中填写 Worker 的根 URL（不要追加 `/mcp`），填写设备标签与 `PAIRING_SECRET`，然后点按“配对设备”。配对密钥会发给该地址；仅向你控制或充分信任的 Worker 配对。

## 选择数据并同步

每个类别开关默认关闭。按需在 App 中打开某类后，单独点按“同步已授权数据”；没有后台定时任务。关闭类别会尽力删除对应的云端快照，七天后快照不再可读并由每日 Cron 物理清理。

新手可先尝试“电量状态”“设备摘要”“网络状态”或“存储空间”；它们不需要额外运行时权限。位置、应用使用情况与无障碍能力需要额外系统授权，请先阅读 [Android App 指南](/guide/android-app)。

## 连接 MCP 客户端

设备配对后，App 使用 Android Keystore 保存独立的设备写入令牌与 MCP 只读令牌。点“复制 MCP 令牌”，将 Remote MCP 地址设为 `https://<你的 Worker 域名>/mcp`，并在客户端的 HTTP headers 中放入 `Authorization: Bearer <只读令牌>`。不要把令牌放进 URL、仓库或不可信工具。详细示例见 [MCP 客户端指南](/guide/mcp-client)。

## 开启 Webhook（可选）

先在 Cloudflare Worker 设置 `WEBHOOK_ENCRYPTION_KEY`，完成新 migration 部署；再在已配对 App 中输入你的 HTTPS Webhook URL，必要时加签名密钥，点“保存并启用 Webhook”。默认关闭。之后 AI 只有在你明确提出发送要求时，才可调用 `send_webhook_message`；它不能选择 URL，也不会读取或附带设备快照。详见 [Webhook 指南](/guide/webhooks)。

## 常见问题

| 现象 | 检查方式 |
| --- | --- |
| 配对提示密钥无效 | Worker 地址是否填根 URL；配对密钥是否与 `.dev.vars` /线上 secret 一致。 |
| MCP 401 | 确认使用的是 App 复制的只读 MCP 令牌，并配置在 `Authorization: Bearer …` 头。 |
| App 无法连本机 Worker | 模拟器使用 `10.0.2.2`，真机需要开发电脑可访问的 HTTPS 地址；Release 不允许 HTTP。 |
| 新类别没有数据 | 确认 migration `0002_webhooks_and_context_categories.sql` 已应用，然后开启类别并手动同步。 |
| Webhook 返回不可用 | 检查 `WEBHOOK_ENCRYPTION_KEY` 是否以 Secret 配置、格式是否正确，且设备端设置已保存启用。 |

Cloudflare 官方说明：[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)；[D1 migration 命令](https://developers.cloudflare.com/workers/wrangler/commands/d1/)。
