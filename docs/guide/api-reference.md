# API 参考

所有 Worker JSON API 响应包含 `Cache-Control: no-store, private` 与 `X-Content-Type-Options: nosniff`。MCP endpoint 为 `/mcp`，使用 Streamable HTTP；REST endpoint 供 Android 配对、同步和配置 Webhook。

## 认证

配对 `/v1/pair` 使用 body 中的 `pairingSecret`。Worker 拒绝短于 32 个字符的配对密钥；生产建议使用 32 个随机字节的 base64url 值。配对成功后返回两个一次性明文 bearer token：`deviceToken`（写入/管理）和 `mcpToken`（只读 MCP）。Worker 只把其 SHA-256 哈希保存在 D1；App 用 Android Keystore 加密保存明文。每个 token 绑定一台设备。

| 请求 | 所需令牌 | 权限 |
| --- | --- | --- |
| `GET /health` | 无 | DB 连通性状态。 |
| `POST /v1/pair` | body 中的配对 secret | 新建设备，返回读/写令牌。 |
| `POST /v1/context` | `deviceToken` | 校验并覆盖一类最新快照。 |
| `GET /v1/context` | `mcpToken` | 列出当前设备的快照。 |
| `DELETE /v1/context` 或 `/v1/context/{category}` | `deviceToken` | 删除本设备所有快照或单一类别。 |
| `GET /v1/webhook` | `mcpToken` | 仅返回 configured/enabled/更新时间。 |
| `PUT /v1/webhook`、`DELETE /v1/webhook` | `deviceToken` | 配置/启停、删除目的地。 |
| `DELETE /v1/device` | `deviceToken` | 撤销设备。 |
| `POST /mcp` | `mcpToken` | MCP 工具读取快照或按权限向已配置 Webhook 发送文字。 |

标准认证头：

```http
Authorization: Bearer <deviceToken-or-mcpToken>
```

不要把 token 放到 URL、query string、日志或示例配置中。

## 配对

```http
POST /v1/pair
Content-Type: application/json
```

```json
{"pairingSecret":"<PAIRING_SECRET>","label":"My Android phone"}
```

`201` 返回 `{deviceId, deviceToken, mcpToken, mcpUrl, expiresInDays}`。该响应中的 token 必须立即由 App 安全保存；丢失后重新配对并撤销旧设备。

## 上传快照

```http
POST /v1/context
Authorization: Bearer <deviceToken>
Content-Type: application/json
```

```json
{
  "category": "network",
  "capturedAt": "2026-11-14T08:30:00.000Z",
  "payload": {
    "transport": "wifi",
    "internetAvailable": true,
    "validated": true,
    "metered": false,
    "capturedAt": "2026-11-14T08:30:00.000Z"
  }
}
```

允许类别：`location`、`battery`、`usage`、`accessibility`、`device`、`network`、`storage`。所有 payload 总字节上限 32 KiB；请求 body 上限 40 KiB；采集时间不允许超前超过五分钟，也不能早于七天。七类 payload 均按字段白名单和类型/数量边界校验；无障碍节点最多 100 个、使用情况 app 最多 15 个，未知属性（包括 SSID、IP、MAC、唯一设备标识）会被拒绝。成功返回 `202`，并设置 7 天后失效时间；同设备同类别会覆盖旧快照。

## 快照与设备删除

- `GET /v1/context` 用 MCP 只读令牌返回有效快照数组。
- `DELETE /v1/context/{category}` 仅接受白名单类别；移除对应记录。
- `DELETE /v1/context` 移除所有快照，但不删除配对令牌或 Webhook。
- `DELETE /v1/device` 删除设备及其关联快照、Webhook、投递审计与限流桶；旧 token 立即失效。

## Webhook 配置

PUT 请求仅有三个字段，strict validation 会拒绝未知字段。`url` 必须为符合策略的 HTTPS 主机地址；`signingSecret` 可留空或为至少 32 个字符；`enabled` 必须是 boolean。

```http
PUT /v1/webhook
Authorization: Bearer <deviceToken>
Content-Type: application/json
```

```json
{"url":"https://receiver.example.net/hooks/<secret>","signingSecret":"<optional-32+-char-secret>","enabled":true}
```

返回只包含 `{ok, configured, enabled, updatedAt}`，不回显 URL 和签名密钥。MCP `send_webhook_message` 仅允许 `title` 和 `message`。更多限制见 [Webhook 指南](/guide/webhooks)。

## 错误响应

| HTTP | 错误 | 含义 |
| --- | --- | --- |
| `400` | `invalid_json` / `invalid_context` / `invalid_webhook_config` / `body_too_large` | body 无法解析、字段/类型不符合约束或超过长度。 |
| `401` | `unauthorized` / `invalid_credentials` | bearer token 或配对 secret 错误。 |
| `404` | `not_found` | 未知 endpoint。 |
| `405` | `method_not_allowed` | 方法错误；`Allow` header 列出接受的方法。 |
| `503` | `pairing_not_configured` / `webhook_not_configured` / `database_unavailable` | 缺少对应 Worker 配置或数据库不可用。 |
| `500` | `internal_error` | 未分类服务端错误；不会回显请求内容和密钥。 |

失败的 Webhook MCP 调用会返回通用文本及状态码，不返回上游正文、URL 或 query token。
