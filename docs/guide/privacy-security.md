# 隐私与安全

此页说明仓库当前代码设计，不是独立安全审计、正式隐私政策、法律意见或生产部署认证。维护者发布之前还需完成真机权限撤销测试、生产 Cloudflare 集成测试、正式隐私/跨境说明、私密漏洞报告渠道、支持渠道与无障碍服务分发规则核验。

## 数据如何流动

用户在 Android 内逐类开启并手动同步 → Worker 验证、按设备 token 授权 → D1 保存每个设备每类最新一份、最多七天 → REST/MCP 在输出前按当前 schema 再验证快照 → MCP 客户端仅用本设备只读 token 读取。不符合白名单的历史 payload 会被隐藏并按原过期时间清理。关闭类别会发起删除；撤销设备会删除其全部关联记录。删除请求离线失败时无法保证立即完成。

配对时，App 输入的共享 `PAIRING_SECRET` 会发送到配置的 Worker 根 URL；只与自己控制或充分信任的 Worker 配对。生产 Worker 地址使用 HTTPS。

## 默认拒绝与类别范围

| 类别 | 可能敏感点 | 保护措施 |
| --- | --- | --- |
| 电量 | 可推断设备状态 | 独立开关，仅手动同步；只留最新值。 |
| 位置 | 位置具有高度敏感性 | 精确/大致分开；大致经纬度网格化；关闭精确模式会请求删除旧快照，替代的大致快照仅在手动同步后上传；无后台位置/轨迹。 |
| 使用情况 | 包名可透露兴趣、健康或工作习惯 | 特殊设置授权 + App 开关；最近 24 小时最多 15 个活跃 app。 |
| 无障碍快照 | 可包含屏幕中几乎任何可见文本 | 一次性武装、两分钟超时、限节点/文本量、跳过密码节点；仍可能包含敏感数据，商店政策风险未解除。 |
| 设备摘要 | 厂商型号与语言/时区会构成画像线索 | 不读取 IMEI、Android ID、序列号或广告 ID。 |
| 网络状态 | 可推断网络可用性及计费情况 | 只上传 transport/validated/metered；不收集 SSID、IP、MAC、DNS 或路径。 |
| 存储空间 | 暴露设备剩余空间 | 按 64 MiB 粗略取整；不读任何目录/文件。 |

所有类别默认关闭。Android 仅在明确的同步操作中读取所开启类别，不存在常驻后台采集或定时上传。

## 存储、访问与删除

- 每台设备有随机 ID、设备标签、写入 token hash、只读 token hash；令牌明文仅在配对响应中返回，并在本机 Android Keystore 加密保存。
- D1 `context_latest` 主键为 `(device_id, category)`，新值覆盖旧值；API/MCP 七天后不返回，Cron 每日清理过期快照。
- Webhook URL/签名密钥使用 `WEBHOOK_ENCRYPTION_KEY` 做 AES-GCM 加密，关联认证数据包含配置版本和 device ID；密文不由 REST/MCP 返回。
- Webhook audit 仅记录随机 ID、时间、状态码与成功位，不记录正文、URL、secret 或 response body；30 天后每日清理。
- App 可以删除一类、删除全部快照、删除 Webhook 配置/投递历史或撤销设备。Worker 错误响应不会回显机密；上线后仍应复核 Cloudflare 平台日志与权限设置。

## MCP 与外发边界

MCP 只查询 token 对应设备；没有任意 SQL、跨设备读取、上下文写入或由 AI 指定 Webhook URL 的工具。Webhook 发送是有副作用操作：App 关闭默认；设备所有者必须手动设置 HTTPS 目的地并显式启用。之后 MCP 工具仍只接受短 `title`/`message`，工具说明要求 AI 仅在用户明确提出发送请求时调用，不添加上下文或凭证。服务器配置 8 秒超时、手动重定向、每设备每分钟 5 次/每小时 20 次的原子限额，且只回传上游 HTTP 状态。

自定义 Webhook DNS 名称可能由目的地所有者更改解析。应用层目前没有 DNS pinning；目的地语法检查不能证明接收方身份，也不能替用户审计目的地。当前 Wrangler 配置没有 VPC 私网绑定。Cloudflare [Workers 安全模型](https://developers.cloudflare.com/workers/reference/security-model/)说明普通出站 HTTP 由平台代理限制在公网服务或 Worker 自身源站；访问私网服务需要显式的 [VPC Service 绑定](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)，CanaryMCP 不支持这类绑定。仍应只配置可信的公网 HTTPS 服务；添加自定义代理或 VPC 绑定前必须另行做 SSRF 威胁评估。端点 URL 常含长期 bearer credential，需视同密码。

配对入口需要 32 字符以上的共享密钥，推荐独立随机 32 字节 base64url 值。当前应用没有失败尝试速率限制；面向公网部署前，应在 Cloudflare 等边缘层为 `/v1/pair` 加限速，并通过监控/告警检查异常失败流量。

## 密钥配置与轮换

生产部署需要 Cloudflare/GitHub secret 中的 `CANARYMCP_PAIRING_SECRET`、`WEBHOOK_ENCRYPTION_KEY`，以及具备 Worker/D1 权限的 Cloudflare API token。加密 key 必须为恰好 32 个随机字节的 base64url 字符串。不要把实际值放在源码、`wrangler.jsonc`、截图、Issue 或提交里。

更换根加密 key 后，原密文不能直接解密。先在 App 删除所有已配置 Webhook，再更新 Worker secret 并重新配置；不要直接替换 key 后假设旧配置仍可用。读写令牌丢失时应撤销/重新配对，而不是写明文数据库。

## 安全报告

`SECURITY.md` 当前说明尚未配置私密报告渠道，也没有承诺响应时限。不要在公开 Issue 发布漏洞利用、凭证或用户信息。上线前维护者应启用 GitHub Private Vulnerability Reporting 或提供专用私密邮箱，并更新该文件。

进一步阅读：[项目数据与权限说明](https://github.com/BOOMDEE/CanaryMCP/blob/main/DATA-PRIVACY.md)、[安全政策](https://github.com/BOOMDEE/CanaryMCP/blob/main/SECURITY.md)、[Webhook 设计说明](/guide/webhooks)、[Cloudflare secrets 官方指南](https://developers.cloudflare.com/workers/configuration/secrets/)。
