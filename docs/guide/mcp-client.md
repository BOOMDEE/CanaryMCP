# MCP 客户端

CanaryMCP 使用 Model Context Protocol 的 Streamable HTTP 传输。Endpoint 是 `https://<Worker 域名>/mcp`；请求需要配对设备生成的 **MCP 只读 bearer token**。不要把设备写入令牌错放在 MCP 客户端。

## 通用配置

为支持 HTTP headers 的 Remote MCP 客户端配置：

```json
{
  "mcpServers": {
    "canarymcp": {
      "url": "https://<your-worker-domain>/mcp",
      "headers": {
        "Authorization": "Bearer <paste-the-MCP-read-only-token>"
      }
    }
  }
}
```

具体客户端可能把字段命名为 `remoteMcpServers`、`httpHeaders` 或通过 UI 录入 URL/Header；按客户端本身格式调整。此配置仅用于解释连接参数，不是可直接复制的有效凭证。私有令牌不要提交到 Git、Issue 或截图。

## 工具目录

| 工具 | 输入 | 返回 |
| --- | --- | --- |
| `read_device_context` | 必填 `category`：location、battery、usage、accessibility、device、network 或 storage | 该类别尚未过期的最新快照。一次只读一个类别，以减少意外读取并控制单次响应大小。没有数据不代表权限已开启或设备当前状态。 |
| `get_device_status` | 无 | 设备标签、当前有数据的类别和各自过期时间，不返回快照内容。 |
| `get_webhook_status` | 无 | Webhook 是否配置/启用和更新时间；不会返回 URL 或签名密钥。 |
| `get_webhook_delivery_history` | 无 | 最近十次投递的随机 ID、时间、成功与 HTTP 状态；不保存/返回消息正文。 |
| `send_webhook_message` | `title`（最多 120 字符）和 `message`（最多 1600 字符） | 把短文本发给 App 所有者配置的单一 URL；不接受目标参数，不携带设备上下文。 |

## 让模型读取上下文

由于上下文可能过期或包含敏感资料，应要求 AI 只读处理当前任务必需的类别，并把数据视作私密设备信息。例如，不需要位置时，不要让模型调用位置类别读取。对缺失类别不要推断它未授权还是当前无法采集；可调用 `get_device_status` 看当前可用类别。

## Webhook 的发送规则

`send_webhook_message` 会产生外部副作用：只有用户已在 App 显式启用目标，并且当前在对话中明确要求发送该条消息时，AI 才应调用。MCP 工具描述对此有明确限制；它没有“测试目标”“任意 URL”或上下文附带参数。重复调用可能产生多条通知；每个请求有独立 `deliveryId`，目标可用它做去重。

发送结果中的 `delivered=true` 表示配置的服务器返回 2xx，不保证第三方应用最终展示消息。3xx 重定向不会跟随；上游响应体不返回给模型。失败时检查 `get_webhook_delivery_history` 及目标服务端日志，但不要复制 URL query token 到聊天。

## 权限和撤销

MCP 读取令牌只授权该 token 所属设备的读取和已显式启用的 Webhook 发送；不能写设备快照、查询其他设备或访问任意 SQL。清除本机 Webhook 配置后，后续 MCP send 会被拒绝；撤销配对会撤销读写令牌并清除本设备服务端配置。
