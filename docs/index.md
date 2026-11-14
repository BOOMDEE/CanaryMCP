# CanaryMCP

CanaryMCP 把 **用户手动同步的 Android 设备上下文** 与 **Cloudflare Remote MCP** 连接起来。每个数据类别默认关闭；App 只在用户点按“同步已授权数据”时读取并上传当前快照。配对令牌把读取范围限制在自己的设备。

::: warning 候选版本
当前是可审阅的候选实现，不是已发布版本。生产 Cloudflare 服务、Android 真机端到端、Android Release 签名和分发政策检查尚未完成。
:::

## 这个项目能做什么

- 在 App 中分别开启电量、位置、使用情况、一次性无障碍快照、设备摘要、网络状态和存储空间快照。
- 在 Cloudflare Worker 上运行 Streamable HTTP MCP 服务；AI 客户端可读取自己配对设备的最新快照与类别状态。
- 由设备所有者在 Android App 中设置单个 HTTPS Webhook 目标，并显式启用后，MCP 客户端才可在用户明确要求时向该目标发送短文本。
- 删除单类或全部云端快照、停用并删除 Webhook、撤销整个设备；快照的可读期限为七天。
- 通过 VitePress 提供中文和英文指南、本地搜索、API 参考与安全说明。

## 设计边界

CanaryMCP 不做后台定时同步、位置轨迹、通讯录/短信/通知读取、设备唯一标识采集、任意 SQL 或跨设备查询。Webhook 工具不接受 AI 提供的 URL，也不随消息附带任何设备上下文。无障碍快照是特别敏感且受分发政策限制的实验能力；不要在包含验证码、金融信息或私人对话的屏幕上使用它。

## 快速入口

- [快速开始](/guide/quickstart)：本地 Worker、Android 配对和首次同步。
- [Android App](/guide/android-app)：七类数据、系统权限与权限撤销。
- [MCP 客户端](/guide/mcp-client)：远程服务器连接示例和可用工具。
- [Webhook 消息](/guide/webhooks)：目的地设置、签名、限流和消息格式。
- [API 参考](/guide/api-reference)：路由、令牌权限、请求示例和错误码。
- [隐私与安全](/guide/privacy-security)：数据流、保留期限、威胁边界。
- [部署、开发与发布](/guide/operations)：Cloudflare 配置、VitePress、测试及尚未完成的检查。

## 项目状态

候选版本为 `0.2.0`，建议 Release tag 为 `v0.2.0`。当前尚无公开 GitHub Release；Android Release APK 未签名，因此不会作为可安装发行附件。完成任何正式发布之前，应先审查候选 tag、完整 Release notes 与附件清单。

## 官方资料

- [VitePress 入门与安装](https://vitepress.dev/guide/getting-started)、[多语言配置](https://vitepress.dev/guide/i18n) 和[本地搜索](https://vitepress.dev/reference/default-theme-search)
- [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) 与 [D1 migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Android 网络状态读取指南](https://developer.android.com/develop/connectivity/network-ops/reading-network-state)
