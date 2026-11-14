# CanaryMCP

CanaryMCP connects **Android context that the device owner manually syncs** to a Cloudflare Remote MCP service. Every category is off by default. The app reads and uploads the currently enabled snapshots only after the owner taps “Sync enabled data.” Per-device tokens isolate each device.

> [!WARNING] This is a reviewable implementation candidate, not a published release. Production Cloudflare deployment, Android device end-to-end tests, a signed Android release package, and distribution-policy review have not been completed.

## What it does

- Individually opt into battery, location, app usage, one-shot accessibility snapshot, device summary, network state, and storage snapshots.
- Run a Streamable HTTP MCP service on Cloudflare Workers; clients can read only the latest unexpired snapshots for the paired device.
- Let the device owner configure one HTTPS webhook in Android. Once explicitly enabled, an MCP client may send short text only when the user explicitly requests it.
- Delete a category, all context, a webhook configuration, or the whole device; context expires after seven days.
- Provide Chinese and English guides, local search, API reference, and security notes via VitePress.

## Boundaries

No scheduled background sync, location history, contacts, messages, notifications, device advertising identifiers, arbitrary SQL, cross-device access, or AI-supplied webhook URL. Webhook messages never include context by default. Accessibility snapshots are highly sensitive and may violate distribution policies; never capture a screen containing a code, financial data, or private conversation.

## Documentation

- [Quick start](/en/guide/quickstart): local Worker, Android pairing, first sync.
- [Android app](/en/guide/android-app): categories, permissions, revocation.
- [MCP client](/en/guide/mcp-client): remote endpoint and tools.
- [Webhook messages](/en/guide/webhooks): destination, signature, limits, payload.
- [API reference](/en/guide/api-reference): routes, token scopes, examples.
- [Privacy & security](/en/guide/privacy-security): data flow and threat boundaries.
- [Operations & release](/en/guide/operations): deployment, docs site, tests, candidate status.

## Candidate status

Candidate version: `0.2.0`; proposed tag: `v0.2.0`. No public GitHub Release exists. The Android Release APK is unsigned and is not suitable as an installable release attachment. Review the exact tag, notes, and attachments before any public release.

## Official references

[VitePress getting started](https://vitepress.dev/guide/getting-started), [i18n](https://vitepress.dev/guide/i18n), [local search](https://vitepress.dev/reference/default-theme-search), [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/), [D1 migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/), and [Android network-state guide](https://developer.android.com/develop/connectivity/network-ops/reading-network-state).
