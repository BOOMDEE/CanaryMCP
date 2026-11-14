# Webhook messages

A webhook lets an AI client send short text to **one destination configured by the device owner**, only when the user explicitly requests it. It is not an arbitrary URL fetcher and does not forward context automatically.

## Enable it

1. Set `WEBHOOK_ENCRYPTION_KEY` on the Worker, apply migration `0002_webhooks_and_context_categories.sql`, then deploy.
2. In the paired Android app, enter one full HTTPS endpoint you control. Treat URL query values as credentials; do not paste the URL into a chat.
3. Optionally enter a signing secret of at least 32 characters.
4. Tap **Save and enable webhook**. The Worker encrypts the destination and signing secret in D1; local copies use Android Keystore.

Once enabled, any MCP client holding this device's read token may send text. The app does not ask the owner to approve each delivery. The MCP tool instructions require the AI to call it only when the user explicitly asks. In Android, **Disable and delete webhook configuration** removes the server-side destination, secret, audit history, and rate-limit rows. Revoking the device also deletes them.

## Destination and network boundaries

- Only HTTPS on default TLS port 443 and DNS hostnames are accepted. IP literals, userinfo, fragments, nonstandard ports, and localhost/`.local`/`.internal`-style names are rejected.
- The destination is set using the device-write token; MCP requests cannot change its URL, headers, or signing key.
- The Worker uses `redirect: manual`, refuses redirects, has an eight-second timeout, and never reads or returns the upstream response body. MCP sees only a success/failure result and HTTP status.
- A custom DNS hostname may still be changed by its owner; the app does not pin DNS resolutions. Cloudflare's [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/) says ordinary outbound HTTP is mediated by a proxy that restricts requests to public Internet services or the Worker's own origin. Private services require an explicit [VPC Service binding](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/); CanaryMCP has no such binding and does not support private destinations. Still use only trusted public services: syntax checks do not verify receiver identity or policy. Consider who can read the message and how long it is retained.

A webhook is an external side effect. Enable it only after verifying the service and treating the full URL (which may contain a bearer credential) like a password.

## Payload and signature

The MCP tool is `send_webhook_message`, with only `title` (up to 120 characters) and `message` (up to 1,600 characters). The strict schema rejects extra properties, control characters, and oversized text. Example payload:

```json
{
  "event": "canarymcp.message",
  "deliveryId": "<random UUID for receiver-side deduplication>",
  "sentAt": "2026-11-14T08:30:00.000Z",
  "message": { "title": "Reminder", "message": "Please review today's plan." }
}
```

It contains no device label, location, app usage, snapshot, MCP token, or device ID. Use `deliveryId` for receiver-side deduplication; sender-side delivery is not guaranteed exactly once.

When configured, the Worker sends `X-CanaryMCP-Signature: sha256=<64 lowercase hex characters>`, an HMAC-SHA256 of the exact UTF-8 JSON body. Example verification in Node.js:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody, header, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  const actual = Buffer.from(header ?? "", "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
```

Verify against the raw request body before JSON parsing and use a constant-time comparison. Never log the key or the full URL.

## Limits, audit, and failures

One D1 statement atomically reserves both per-device limits: 5 deliveries per minute and 20 per hour. If either bucket is full, neither counter changes and no request is sent. D1 audit stores only random delivery ID, timestamp, HTTP status, and success; no text, URL, secret, or response body. Audit is removed after 30 days; limit buckets are cleaned daily.

A 2xx means the configured server accepted the HTTP request, not that a downstream app displayed it. Redirects are not followed. 4xx/5xx responses return only status; network/DNS/TLS/timeout failures return no status. Check `get_webhook_delivery_history` and the receiver's own logs, without copying URL query credentials into chat.

## Encryption-key rotation

`WEBHOOK_ENCRYPTION_KEY` must decode to exactly 32 random bytes in base64url form. It encrypts D1 destination and secret with AES-GCM, a random nonce, and device-bound associated data. Losing or replacing the key makes existing configurations unreadable. Delete each old configuration in the app before rotating, then set the new secret and reconfigure. Store deployed keys as Cloudflare or GitHub Actions secrets, never in `wrangler.jsonc` or source control. See [Cloudflare's Worker secrets guide](https://developers.cloudflare.com/workers/configuration/secrets/).
