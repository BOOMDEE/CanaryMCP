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

This workspace has no Android SDK, and its Java runtime lacks `javac`; the attempted Debug build stopped before compiling app source, and no device test was run. The Release APK is unsigned; do not use a Debug APK as a release artifact. Public release still needs a signed Android package, final privacy and data-processing notice, a support and private security-reporting route, accessibility-service distribution-policy review, edge-level failed-attempt throttling for `/v1/pair`, signing plan, and final artifact review.

## Candidate release

The current candidate version is `0.2.0` (Android `versionCode 2`, `versionName 0.2.0`), proposed tag `v0.2.0`. No tag or public GitHub Release has been created. The only safe preliminary attachment is a source archive; a production Android APK must wait for maintainer signing. Review the exact tag, complete release notes, and attachment list before any public release.
