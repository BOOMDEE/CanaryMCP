# API reference

Worker JSON endpoints return `Cache-Control: no-store, private` and `X-Content-Type-Options: nosniff`. MCP uses Streamable HTTP at `/mcp`; REST endpoints support Android pairing, sync, and webhook configuration.

## Authentication and scopes

`POST /v1/pair` accepts a pairing secret of at least 32 characters and returns two random bearer tokens once: `deviceToken` for Android write/management operations and `mcpToken` for read-only MCP access. Use 32 random bytes encoded as base64url in production. D1 stores only SHA-256 token hashes. Android encrypts the token values with Keystore. Both tokens belong to one device.

| Endpoint | Credential | Scope |
| --- | --- | --- |
| `GET /health` | None | Health and database availability. |
| `POST /v1/pair` | Pairing secret in body | Create device and return tokens. |
| `POST /v1/context` | `deviceToken` | Validate and replace one latest snapshot. |
| `GET /v1/context` | `mcpToken` | Read this device's current context. |
| `DELETE /v1/context` or `/v1/context/{category}` | `deviceToken` | Delete this device's context. |
| `GET /v1/webhook` | `mcpToken` | State and update time only. |
| `PUT /v1/webhook`, `DELETE /v1/webhook` | `deviceToken` | Configure, enable, or delete destination. |
| `DELETE /v1/device` | `deviceToken` | Revoke device and cascade-delete its data. |
| `POST /mcp` | `mcpToken` | Read context or send to the configured webhook. |

Use `Authorization: Bearer <token>`. Never put tokens in URLs, query strings, or logs.

## Pairing

```http
POST /v1/pair
Content-Type: application/json
```

```json
{"pairingSecret":"<PAIRING_SECRET>","label":"My Android phone"}
```

A `201` response contains `{deviceId, deviceToken, mcpToken, mcpUrl, expiresInDays}`. Store returned tokens immediately; if lost, re-pair and revoke the old device.

## Context upload

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

Allowed categories: `location`, `battery`, `usage`, `accessibility`, `device`, `network`, and `storage`. Payload limit is 32 KiB; request limit is 40 KiB. Capture times cannot be over five minutes in the future or older than seven days. All seven payload types have strict field/type/count allowlists; unknown fields are rejected. Accessibility snapshots allow at most 100 nodes, and usage allows at most 15 apps. A `202` replaces the latest row for this device/category and sets a seven-day expiry.

## Delete and revoke

`GET /v1/context` returns current unexpired snapshots. `DELETE /v1/context/{category}` deletes a single allowlisted category. `DELETE /v1/context` deletes all context but keeps pairing and webhook configuration. `DELETE /v1/device` revokes both tokens and cascades to context, webhook, audit, and limit rows.

## Webhook configuration

`PUT /v1/webhook` strictly accepts only `url`, `signingSecret`, and boolean `enabled`. The destination must pass HTTPS hostname policy; the optional signing key must have at least 32 characters.

```http
PUT /v1/webhook
Authorization: Bearer <deviceToken>
Content-Type: application/json
```

```json
{"url":"https://receiver.example.net/hooks/<secret>","signingSecret":"<optional-32+-char-secret>","enabled":true}
```

The response contains `{ok, configured, enabled, updatedAt}` only; it never returns URL or secret. MCP `send_webhook_message` accepts only title and message. See [Webhook messages](/en/guide/webhooks).

## Errors

| HTTP | Error | Meaning |
| --- | --- | --- |
| `400` | `invalid_json`, `invalid_context`, `invalid_webhook_config`, `body_too_large` | Invalid JSON, shape/value, or size. |
| `401` | `unauthorized`, `invalid_credentials` | Invalid bearer token or pairing secret. |
| `404` | `not_found` | Unknown path. |
| `405` | `method_not_allowed` | Unsupported method; `Allow` lists accepted methods. |
| `503` | `pairing_not_configured`, `webhook_not_configured`, `database_unavailable` | Missing Worker configuration or database outage. |
| `500` | `internal_error` | Unclassified error; request body and secrets are not echoed. |

Webhook MCP failures return a generic message and status only. Upstream response bodies, URLs, and query credentials are not returned.
