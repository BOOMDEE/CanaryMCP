# Operations & release

## Repository layout

`src/` contains the Worker API, MCP server, validation, and storage code. `migrations/` has versioned D1 SQL; migration 0002 adds context categories and webhook tables. `Android/` is the Kotlin/Compose app, and `docs/` is the VitePress bilingual site. `.github/workflows/ci.yml` runs worker checks, Wrangler dry run, docs build, and Android Debug build. `.github/workflows/deploy-worker.yml` is a manually triggered Cloudflare deployment.

## Worker and D1

```bash
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run docs:build
npx wrangler deploy --dry-run
npm run db:local
npm run dev
```

Create versioned SQL migration files and test them against local D1 before production. Production migrations run via the manual Deploy Worker workflow. Cloudflare documents [`wrangler d1 migrations apply`](https://developers.cloudflare.com/workers/wrangler/commands/d1/); interactive confirmation is skipped by non-interactive CI.

GitHub Actions requires repository variable `CLOUDFLARE_ACCOUNT_ID` and secrets `CLOUDFLARE_API_TOKEN`, `CANARYMCP_PAIRING_SECRET`, and `WEBHOOK_ENCRYPTION_KEY`. Scope the API token to the required Workers Scripts Edit and D1 Edit permissions. Generate the production webhook key as 32 random bytes encoded in base64url and store it as a secret; never use the local example value. See [Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).

## VitePress

VitePress is installed as an npm dev dependency with a typed `.mts` configuration, Chinese and English locales, and built-in local full-text search:

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

The default build output is `docs/.vitepress/dist`. Chinese is rooted at `/`; English pages are under `/en/`. Official references: [getting started](https://vitepress.dev/guide/getting-started), [i18n](https://vitepress.dev/guide/i18n), and [local search](https://vitepress.dev/reference/default-theme-search).

## Verification and gaps

The project requires Node.js 22.12+ (Vitest 5 requirement). Checks cover dependency audit, Worker TypeScript, unit tests, Wrangler dry-run, local D1 migrations, static documentation generation, and Android Debug compilation when an Android SDK is available. Unit tests do not prove production Cloudflare integration, real-device permission grant/deny/revoke flows, MCP client interoperability, or receiver-side webhook signature validation.

The current build environment has Android SDK 35 and a Java compiler; rely on the candidate record for the actual build and signature verification results. No real-device test has been run. Public release still requires a final privacy and data-processing notice, a support and private security-reporting route, accessibility-service distribution-policy review, edge-level failed-attempt throttling for `/v1/pair`, and final artifact review.

## Candidate release

`v0.2.0` was publicly released on 2026-11-14. The current candidate is `v0.2.1` (Android `versionCode 3`, `versionName 0.2.1`), with proposed tag `v0.2.1`; no tag or corresponding GitHub Release has been created. A signed candidate APK does not demonstrate real-device or production integration testing. Resolve the blockers in `PRE-RELEASE-CHECKLIST.md`, then review the exact tag, complete notes, and attachment list before public release.
