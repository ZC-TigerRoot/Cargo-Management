---
description: 完整验证 Cargo 项目
agent: build
---

依次执行 pnpm test、pnpm lint、pnpm exec tsc --noEmit 和 pnpm build。
任何一步失败都停止，报告根因，不部署。
