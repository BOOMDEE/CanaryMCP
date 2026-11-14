# 部署、开发与发布

## 仓库结构

- `src/`：Cloudflare Worker REST/MCP 服务、D1 数据访问、安全与校验。
- `migrations/`：D1 schema。`0001_initial.sql` 初始化设备/快照；`0002_webhooks_and_context_categories.sql` 增加类别与 Webhook 配置/审计/限流。
- `Android/`：Kotlin、Jetpack Compose App。
- `docs/`：VitePress 中文/英文文档站。
- `.github/workflows/ci.yml`：Worker 类型检查、单元测试、Wrangler dry-run、文档构建和 Android Debug 构建。
- `.github/workflows/deploy-worker.yml`：仅手动触发的 Cloudflare Worker/D1 部署。

## Worker 与 D1

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

新 migration 应追加连续编号 SQL 文件，并对旧数据做兼容迁移。先在本地 D1 测试；生产通过 Deploy Worker workflow 应用 migration。Cloudflare 官方提供 [`wrangler d1 migrations apply`](https://developers.cloudflare.com/workers/wrangler/commands/d1/)，此工作流默认按人工 workflow dispatch 运行，不因 push 自动更改生产。

线上 GitHub Actions 需要变量 `CLOUDFLARE_ACCOUNT_ID`，密钥 `CLOUDFLARE_API_TOKEN`、`CANARYMCP_PAIRING_SECRET` 和 `WEBHOOK_ENCRYPTION_KEY`。API Token 应只授予所需 Workers Scripts Edit 与 D1 Edit 权限。生产 `WEBHOOK_ENCRYPTION_KEY` 请用安全密码生成器产生 32 bytes 并 base64url 编码后，作为 GitHub Secret 添加；不可使用本地示例占位符。Cloudflare 官方：[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。

## 文档站开发

VitePress 是 npm devDependency，配置采用 TypeScript `.mts` 与 built-in local search：

```bash
npm run docs:dev
npm run docs:build
npm run docs:preview
```

开发服务默认显示本地站点地址；`docs:build` 输出到 `docs/.vitepress/dist`。VitePress 根据 Markdown 路径生成页面，语言选择在 `.vitepress/config.mts` 的 `locales` 配置。本站中文默认为 `/`，英文位于 `/en/`。官方：[安装和目录结构](https://vitepress.dev/guide/getting-started)、[i18n](https://vitepress.dev/guide/i18n)、[local search](https://vitepress.dev/reference/default-theme-search)。

## 验证与待补项目

项目使用 Node.js 22.12+（Vitest 5 要求）。CI / 本地可验证依赖审计、Worker 类型检查、测试、dry-run、D1 本地 migration、VitePress 静态构建和 Android Debug 编译（有 Android SDK 时）。单元测试不证明生产 Cloudflare 集成，也不替代真机权限首次授权/拒绝/撤销、不同 MCP 客户端握手和 Webhook 接收方验证测试。

本次构建环境已配置 Android SDK 35 与 Java 编译器；实际构建结果及签名校验应以候选记录为准。真机测试尚未执行。公开发布前仍需确认正式隐私政策、跨境/处理说明、可用支持与私密安全报告渠道、无障碍服务分发政策、配对入口边缘层失败限流，以及最终附件。

## Release 候选

`v0.2.0` 已于 2026-11-14 公开发布。当前候选为 `v0.2.1`（Android `versionCode 3` / `versionName 0.2.1`），拟议 tag 为 `v0.2.1`；尚未创建或推送该 tag，也未发布对应 GitHub Release。候选签名 APK 不代表真机或生产集成测试通过。公开发布前须完成 `PRE-RELEASE-CHECKLIST.md` 的阻塞项，并逐项审阅完整 notes 与附件清单。
