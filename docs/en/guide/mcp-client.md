# MCP client

CanaryMCP exposes a Streamable HTTP MCP endpoint at `https://<worker-domain>/mcp`. Authenticate with the paired device's **MCP read-only token**, not its device-write token.

```json
{
  "mcpServers": {
    "canarymcp": {
      "url": "https://<your-worker-domain>/mcp",
      "headers": { "Authorization": "Bearer <MCP-read-only-token>" }
    }
  }
}
```

Client configuration formats vary; use the client’s own fields or UI. This is a placeholder example, not a usable credential. Never commit the token or paste it into a public issue.

| Tool | Input | Result |
| --- | --- | --- |
| `read_device_context` | Required `category`: location, battery, usage, accessibility, device, network, or storage | Latest non-expired snapshot for that category. Reads one category at a time to reduce accidental access and bound each response. Missing data does not prove a category is disabled or the current device state. |
| `get_device_status` | None | Device label, available categories, expiry times; no payload values. |
| `get_webhook_status` | None | Configured/enabled state and update time; no URL or secret. |
| `get_webhook_delivery_history` | None | Latest ten delivery IDs, timestamps, and HTTP outcomes; no message body. |
| `send_webhook_message` | `title` up to 120 chars; `message` up to 1,600 chars | Sends short text to the single destination configured in Android. It does not accept a URL or device context. |

Ask the model to read only the categories needed for the task. Treat context as private; do not infer that missing data means the user denied permission or that a category is empty.

## Webhook side effect

The webhook tool sends data outside the MCP server. It must be enabled in the paired app, and its tool description instructs the AI to call it only when the user explicitly asks to send that message. Repeated calls can create repeated notifications; each has a unique `deliveryId` for receiver-side deduplication.

`delivered=true` means the configured HTTP server returned 2xx, not that a downstream app displayed it. Redirects are not followed, and upstream response bodies are never returned. After the owner deletes the webhook, later send requests are rejected. Revoking the device invalidates both tokens.
