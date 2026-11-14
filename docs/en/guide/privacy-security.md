# Privacy & security

This page describes the repository's implementation, not an independent security audit, legal privacy notice, production certification, or support commitment. Before release, maintainers still need real-device permission/revocation tests, production Cloudflare integration tests, a final privacy and data-processing notice, a private vulnerability-reporting channel, a support route, and distribution-policy review for accessibility service use.

## Data flow

The owner opts into categories in Android and taps manual sync → the Worker authenticates a device token and validates the snapshot → D1 stores one latest row per device/category for up to seven days → REST/MCP revalidates stored rows against the current schema before output → an MCP client with that device's read-only token can read it. Legacy payloads that fail the allowlist are withheld and kept only until their original expiry/cleanup. Category deletion requests remove rows; device revocation cascades across the device. Offline deletion requests cannot be guaranteed immediately.

During pairing, the app sends the entered `PAIRING_SECRET` to the configured Worker root URL. Pair only with a Worker you control or fully trust; production Worker URLs require HTTPS.

## Data minimization

| Category | Main sensitivity | Boundary |
| --- | --- | --- |
| Battery | Device state | Opt-in, manual sync, latest value only. |
| Location | Highly sensitive location data | Separate precise/approximate options; turning precise mode off requests deletion of the old snapshot, and a coarse replacement is uploaded only after manual sync; approximate grid rounding; no background permission or route history. |
| App usage | Package names may reveal habits or health/work interests | Android Usage Access plus app opt-in; at most 15 active packages from 24 hours. |
| Accessibility | Could capture most visible screen text | One-shot arm with 2-minute expiry, node/text caps, skip password node text; still potentially sensitive and subject to distribution rules. |
| Device summary | Model, locale, time zone | No IMEI, Android ID, serial number, or advertising ID. |
| Network | Connectivity and metering state | Transport/capability snapshot only; no SSID, IP, MAC, DNS, or routes. |
| Storage | Free-space estimate | Rounded down to 64 MiB; no file system listing. |

All categories are off by default. There is no background collector or scheduled upload.

## Storage and deletion

D1 stores device IDs and labels, SHA-256 hashes of separate write/read tokens, and one latest context per device/category. Snapshots stop being readable after seven days and a daily Worker cron physically removes them. Webhook URL/signing key are AES-GCM encrypted with `WEBHOOK_ENCRYPTION_KEY` and device-bound associated data. Delivery audit stores only random ID, timestamp, HTTP status, and success state; it stores no message body, URL, secret, or upstream response body and expires after 30 days.

The app can request category deletion, delete all snapshots, delete webhook settings/history, or revoke the entire device. Worker errors avoid echoing secrets. Review platform logs and production permissions before deployment.

## MCP and outbound messages

MCP reads only the token's paired device. It offers no arbitrary SQL, cross-device access, context write, or AI-supplied webhook destination. Webhook is off by default and requires the owner to configure one HTTPS target in Android. Its tool accepts a short title/message, never adds context, and instructs the AI to call only when the user explicitly asks. The Worker enforces an 8-second timeout, refuses redirects, atomically limits each device to 5 sends/minute and 20/hour, and returns only the upstream HTTP status.

A destination's DNS can still be changed by its owner. The app does not pin DNS resolutions; URL syntax validation does not authenticate the receiver or review its policies. The current Wrangler config has no private-network VPC binding. Cloudflare's [Workers security model](https://developers.cloudflare.com/workers/reference/security-model/) says its outbound HTTP proxy restricts requests to public Internet services or the Worker's own origin; private services require an explicit [VPC Service binding](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/), which CanaryMCP does not support. Use only trusted public HTTPS destinations. Any custom egress proxy or VPC binding requires a separate SSRF threat review. A URL may contain a long-lived bearer credential and must be kept secret.

The pairing endpoint requires a secret of at least 32 characters; use a distinct random 32-byte base64url value. The application has no failed-attempt rate limit yet. Add edge-level throttling for `/v1/pair` and monitor failed requests before exposing a production deployment publicly.

## Secrets and rotation

Production requires Cloudflare/GitHub secrets `CANARYMCP_PAIRING_SECRET` and `WEBHOOK_ENCRYPTION_KEY`, plus a scoped Cloudflare API token for deployment. The encryption key must be 32 random bytes encoded as base64url. Never put values in source, `wrangler.jsonc`, screenshots, issues, or commits. If the encryption key is lost or replaced, existing webhook ciphertext cannot be decrypted. Delete configured webhooks in Android before rotating and re-enter them after deploying the new key. Revoke/re-pair if token credentials are lost.

## Vulnerability reporting

`SECURITY.md` currently notes that no private reporting channel or response-time commitment has been set up. Do not post exploit details, credentials, or user data in public issues. Maintainers should enable GitHub Private Vulnerability Reporting or add a private address before release.

Further reading: [Data & permissions](https://github.com/BOOMDEE/CanaryMCP/blob/main/DATA-PRIVACY.md), [Security policy](https://github.com/BOOMDEE/CanaryMCP/blob/main/SECURITY.md), [Webhook guide](/en/guide/webhooks), and [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
