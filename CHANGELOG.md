# CanaryMCP 变更记录 / Changelog

重要变化按版本候选与发布日期记录。当前 `0.2.0` 为未公开发布的候选。

## [Unreleased] — proposed `v0.2.0`

### 新增 / Added

- 扩展 Android 设备上下文类别至七项：电量、位置、使用情况、一次性无障碍快照、设备摘要、网络状态和粗粒度存储健康。
- 新增逐项默认关闭的授权开关、手动同步、类别删除、删除全部快照和整台设备撤销。
- 新增 Remote MCP 工具 `get_device_status`、`get_webhook_status`、`get_webhook_delivery_history` 与 `send_webhook_message`；上下文读取要求一次指定一个类别。
- 新增设备所有者配置的单一 HTTPS Webhook 目标、AES-GCM 密文保存、可选 HMAC-SHA256 签名、按设备限流及最小化投递审计。
- 新增 VitePress 中英文文档站，含快速开始、Android 权限、MCP、Webhook、API、安全与运维指南，启用本地搜索。
- 为 Cloudflare 部署配置独立的配对与 Webhook 加密 Worker secrets。

### 安全与隐私 / Security and privacy

- 对七类 context payload 加入字段白名单、类型/数量限制；拒绝额外字段和超出范围的值。
- REST/MCP 输出 D1 记录前再次运行同一 schema 校验；旧版不合规 payload fail closed，不返回给客户端，按原有过期时间清理。
- 在 Android 客户端和 Worker 两侧校验 Webhook HTTPS 目标策略；Webhook MCP 工具不接受 AI 目标 URL，只有用户明确要求时才应调用。
- 回查服务端 Webhook 状态；遮蔽本地目标 URL；复制 MCP bearer token 后 1 分钟尝试清理剪贴板。
- 串行化同步、类别删除、全删与撤销；类别删除会在发请求前检查最新授权，避免旧删除覆盖更新同步。
- 配对密钥少于 32 字符时拒绝；CI 加入 npm audit、VitePress 构建和本地 D1 migration 检查。
- 更新 Vite/Vitest 并锁定依赖；新增对各类别 schema、Webhook 配置、消息与密码学路径的单元测试。

### 候选已验证 / Candidate checks

- Worker TypeScript 类型检查通过；单元测试通过；`npm audit --audit-level=moderate` 为零漏洞。
- D1 migration 在本地执行成功；双窗口限流 SQL 在 Wrangler/Miniflare D1 中实测前 5 次预留成功、第 6 次未增加任一窗口计数，并清理测试行；`wrangler deploy --dry-run` 通过。
- VitePress 中英文构建通过；本地 D1 migration 和 Wrangler dry-run 通过。Android Debug 构建因工作区缺少 Java 编译器与 Android SDK 未能执行；没有生成 APK。

### 发布前待维护者处理 / Maintainer release blockers

- 在真实 Cloudflare 账号完成生产或 staging D1 migration/Worker/MCP 集成测试，并确认边缘层对 `/v1/pair` 增加失败速率限制；应用本身暂无配对失败限流。
- 按可信公网服务完成 Webhook 接收/签名测试。应用自身未实现 DNS pinning；不要附加自定义出站代理或私网 VPC 绑定，除非另行完成 SSRF 审查。
- Android 真机测试授权、系统设置撤权、离线删除、恢复与设备撤销；确认无障碍服务的真实用途满足目标分发渠道政策。
- 配置正式隐私/跨境数据说明、支持方式、私密安全报告渠道和签名/密钥轮换方案。
- Android Release APK 尚未签名。拟议 Release 仅可先附源码归档；附件、tag、完整 notes 要先审阅并得到确认。
