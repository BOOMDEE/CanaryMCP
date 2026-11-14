# Webhook 消息

Webhook 让已配对设备的 AI 客户端在用户明确要求时，把简短文字发到**设备所有者预先配置的单一目的地**。它不是任意 URL 请求器，也不自动转发上下文。

## 如何启用

1. 为 Worker 设置 `WEBHOOK_ENCRYPTION_KEY`（32 个随机字节的 base64url，无 padding），先应用 migration `0002_webhooks_and_context_categories.sql` 并部署 Worker。
2. 在 Android App 的“AI Webhook 消息”面板输入目标的完整 HTTPS URL，例如某个你控制的服务端接收地址。不要把 URL/其 query 中的 token 发到对话。
3. （可选）填写不少于 32 个字符的签名密钥，接收方可用 HMAC-SHA256 校验请求。
4. 点“保存并启用 Webhook”。成功后 URL 与签名密钥在 D1 中 AES-GCM 加密；App 本地副本保存在 Android Keystore 中。

启用会允许有该设备 MCP 只读 token 的客户端发送消息；它不会要求每条消息再弹 App 确认。为控制副作用，MCP 工具说明要求 AI 仅在用户明确要求时调用。可在 App 点“停用并删除 Webhook 配置”立即删除服务器端目标、签名密钥、投递历史和限流记录；撤销设备也会级联清除。

## 目的地与网络边界

- 只允许 `https:`、默认 TLS 端口 443、DNS 主机名；拒绝 IP literal、用户名/密码、fragment、非标准端口和 localhost / `.local` / `.internal` 等内网样式域名。
- Webhook URL 由设备写入令牌对应的 App 配置。MCP 请求不能改 URL、header 或签名密钥。
- Worker 使用 `redirect: manual`，拒绝将消息跟随重定向发送到其他地址；超时为 8 秒。它不读取或回传上游响应体，MCP 只拿到 2xx / 非 2xx / 网络失败结果。
- URL 是用户主动填入的目标，但任意自定义 DNS 名称仍可能被其所有者更改解析；应用层目前不做 DNS pinning。Cloudflare [Workers 安全模型](https://developers.cloudflare.com/workers/reference/security-model/)说明普通出站 HTTP 会经过平台代理，只允许公网或 Worker 自身源站；访问私网需要显式的 [VPC Service 绑定](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/)，当前 CanaryMCP 不配置该绑定，也不支持私网目标。仍只配置你信任的公网服务；服务端不会验证目标组织身份、内容政策或第三方留存政策。不要将私密数据发往公共通知机器人。

这是一项外发功能，启用前请确认目标服务方是谁、谁能看见消息、URL 是否含 bearer token。消息由用户在对话里要求发送，但 URL 通常是长期凭证，应像密码一样保密。

## MCP 工具与请求体

工具名：`send_webhook_message`。参数只有 `title` 和 `message`；严格拒绝额外字段、控制字符和超长文本。示例接收 JSON：

```json
{
  "event": "canarymcp.message",
  "deliveryId": "<random UUID for receiver-side deduplication>",
  "sentAt": "2026-11-14T08:30:00.000Z",
  "message": {
    "title": "提醒",
    "message": "请查看今天的安排。"
  }
}
```

不会包含设备标签、位置、应用使用记录、快照内容、MCP token 或设备 ID。`deliveryId` 可用于接收方防止同一请求重试造成重复处理；发送端不会替接收服务做幂等保证。

如果填写了签名密钥，Worker 发送 `X-CanaryMCP-Signature: sha256=<64位小写十六进制>`，它是请求原始 UTF-8 JSON body 的 HMAC-SHA256。验证示例（Node.js）：

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, header, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(header ?? "", "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
```

服务器用请求体实际字节签名。接收服务应在 JSON 解析前保留 raw body，并用恒定时间比较；不要在应用日志中输出签名密钥或原始 URL。

## 速率、审计与失败

限额由单条 D1 语句原子预留两个窗口：每分钟最多 5 次、每小时最多 20 次。任一窗口达到上限时，两个窗口都不增加计数，也不会发送请求。D1 中只保存随机投递 ID、创建时间、HTTP 状态和成功位；保留 30 天后每日清理，不存消息、Webhook URL 或响应体。限流记录的窗口行每日清理。

- `2xx`：Worker 报告已成功送达目标 HTTP server，但不保证下游应用最终展示。
- `3xx`：视为失败，且不会跟随 `Location`。
- `4xx/5xx`：目标拒绝/出错；工具只返回状态码，不转发上游正文。
- DNS/TLS/超时：状态码为 null，日志不会回显目标 URL。
- Worker 缺少 key、目标被停用、速率达到上限：发送前拒绝。

`get_webhook_status` 只读配置状态；`get_webhook_delivery_history` 返回最近十次的投递结果。它们不会公开目标 URL 或 secret。

## 密钥与轮换

`WEBHOOK_ENCRYPTION_KEY` 是服务器端解密所需的根 key，worker 用随机 AES-GCM nonce，并把密文绑定到设备 ID；密文格式带有 `v1` 版本标记。丢失/替换 key 会使现存配置不可解密。当前安全恢复方法是先在 App 删除配置，再设置新 key 并重新录入目标。不要把 key 加入 `wrangler.jsonc`、`.env.example` 的真实值或公开仓库；使用 Cloudflare Secret 或 GitHub Actions Secret。Cloudflare 官方：[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
