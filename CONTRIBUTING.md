# 贡献指南 / Contributing

欢迎为 CanaryMCP 提交问题、文档改进或代码贡献。项目包含 Cloudflare Worker/D1、Remote MCP、Android Kotlin/Jetpack Compose App 与 VitePress 双语文档。功能边界与安全要求以 `AGENTS.md`、`SECURITY.md` 和 `DATA-PRIVACY.md` 为准。

## 提交前

1. 阅读 [`README.md`](README.md)、[`AGENTS.md`](AGENTS.md)、[`DATA-PRIVACY.md`](DATA-PRIVACY.md) 和 [`SECURITY.md`](SECURITY.md)。
2. 对权限、数据格式、数据库 schema、MCP 工具、外发行为或安全边界的重大改动，先说明用户影响、威胁模型和迁移方案。
3. 不要把尚未实现或未经验证的计划描述为现有能力；涉及安全或隐私的外部限制应标为已知边界。

## 开发与验证

需要 Node.js 22.12+、npm；Android 修改需要 JDK 17 与 Android SDK 35。常用检查：

```bash
npm ci
npm audit --audit-level=moderate
npm run typecheck
npm test
npm run docs:build
CI=1 npm run db:local
npx wrangler deploy --dry-run
```

Android 调试构建：

```bash
cd Android
./gradlew assembleDebug
```

只在拥有明确授权的 Cloudflare staging 环境做远程 migration/部署。不要运行生产 D1 命令、触达生产数据或公开发布 Release，除非维护者明确授权。Android 真机授权撤回、MCP 客户端互操作、Webhook 接收端 HMAC 验证和商店政策检查需要单独验证；若没有完成，必须如实说明。

## 代码与文档

- 保持改动聚焦；新增功能同时更新中英文 README/相关 VitePress 页面、隐私说明、API 参考、测试与 `CHANGELOG.md`。
- 为用户输入、JSON 载荷和网络请求设字段白名单、大小限制与失败处理；Webhook 不能开放 AI 指定目标或附带设备上下文。
- 不提交密钥、令牌、Webhook URL、真实用户数据、`.dev.vars`、`.env`、Android keystore、APK 或构建产物。
- 数据库改动应追加编号 migration，并验证旧数据迁移与回滚/恢复方案；不要重写已发布 migration。
- Release APK 必须签名并审阅附件；Debug APK 不应作为正式发行包。公开发布前审阅 `PRE-RELEASE-CHECKLIST.md` 和精确 Release notes。

## Pull Request 与提交

Pull Request 应说明问题、改动摘要、验证命令与结果、文档/数据兼容影响，以及未完成的检查。若未运行某项测试，应解释原因，不要标记为通过。Commit 标题使用英文 Conventional Commit 格式，例如 `feat: add webhook delivery limits` 或 `fix: remove stale precise location snapshot`。

## 行为准则

所有参与者均须遵守 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。
