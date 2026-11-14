# Quick start

## Requirements

Use Node.js 22.12+, JDK 17, and Android SDK 35. Android minSdk is 26; dynamic colors are available from Android 12. Cloudflare Workers and D1 are needed only for deployment.

## Run the Worker locally

From the repository root:

```bash
npm ci
cp .dev.vars.example .dev.vars
# Set PAIRING_SECRET and WEBHOOK_ENCRYPTION_KEY to different random 32-byte base64url values.
# Each value must be 43 characters; do not use the placeholders as real secrets.
npm run db:local
npm run dev
```

The local Worker uses `http://localhost:8787`; local D1 is separate from production. Check `GET /health`. Never commit `.dev.vars`.

Generate a local webhook key without adding it to tracked files:

```bash
printf 'WEBHOOK_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')" >> .dev.vars
```

A lost production encryption key makes existing encrypted destinations unreadable. Delete and reconfigure each webhook before rotating it.

## Build and pair Android

Open `Android/` in Android Studio with SDK 35 and JDK 17, then run:

```bash
cd Android
./gradlew assembleDebug
```

Enter the Worker root URL (do not append `/mcp`), a device label, and the pairing secret. Debug emulator builds may use `http://10.0.2.2:8787`; release builds require HTTPS. The pairing secret is sent to that endpoint, so pair only with a Worker you control or fully trust.

## Sync categories

All seven categories are off by default. Enable only what you need, then tap “Sync enabled data.” There is no scheduled background collection. Each device/category stores one latest snapshot, which becomes unreadable after seven days and is physically cleaned daily. See [Android app](/en/guide/android-app) for scope and permission details.

## Connect MCP

Copy the MCP **read-only** token from Android. Configure a Streamable HTTP server at `https://<your-worker-domain>/mcp` with `Authorization: Bearer <read-only-token>`. Never put the token in a URL, source control, or an untrusted service. See [MCP client](/en/guide/mcp-client).

## Optional webhook

Set `WEBHOOK_ENCRYPTION_KEY` as a Worker secret, apply migration `0002_webhooks_and_context_categories.sql`, then configure and enable one HTTPS destination in the paired app. AI can send text only when explicitly requested by the user; it cannot choose a target or attach device snapshots. See [Webhook messages](/en/guide/webhooks).

For official deployment references, see [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [D1 migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/).
