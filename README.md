# 车仓通 · 汽车仓储管理系统

面向海外保税仓和国内汽车仓储业务的响应式 Web/PWA。系统包含车辆台账、实时库存看板、角色权限、车辆审计时间线、司机二维码提车签收、Excel 预校验和库存导出。

## 本地启动

要求 Node.js 22、pnpm 11 和 PostgreSQL 16。

1. 复制 `.env.example` 为 `.env`，设置不少于 32 字符的随机 `AUTH_SECRET`，并替换管理员邮箱和密码。
2. 使用 `docker compose up -d` 启动 PostgreSQL。
3. 执行 `pnpm install`、`pnpm db:generate`、`pnpm db:migrate` 和 `pnpm db:seed`。
4. 执行 `pnpm dev`，访问 `http://localhost:3000/login`。

如需创建演示车辆和 `/driver/demo-pickup` 提货任务，可在首次执行 `pnpm db:seed` 前设置 `SEED_DEMO_DATA="true"`。生产环境应保持为 `false`。

## 权限与数据安全

- 登录会话使用由 `AUTH_SECRET` 签名的 HttpOnly、SameSite=Strict Cookie，有效期 8 小时。
- 仓管员可查看和录入；操作管理员可查看、录入、更正和导出；业务查看者只读；系统管理员拥有全部权限及用户管理权限。
- 权限在页面代理和每个 API handler 中同时校验，写请求还校验同源信息。
- 车辆修改使用版本号进行乐观锁检查；并发冲突返回 HTTP 409，不会静默覆盖其他用户的修改。
- 车辆创建、修改、状态变更、提货任务和司机签收均在数据库事务中写入审计日志或库存事件。

## 主要接口

- `POST /api/v1/auth/login`、`POST /api/v1/auth/logout`：登录会话。
- `GET/POST/PATCH /api/v1/vehicles`：车辆查询、录入和带版本控制的更正。
- `GET /api/v1/dashboard`：实时库存指标。
- `GET/POST /api/v1/pickups`：查询和创建提货二维码任务。
- `GET/POST /api/v1/driver/:token`：司机读取任务与幂等签收。
- `POST /api/v1/import/preview`：Excel 导入预校验；限制 10 MB 和 10,000 行。
- `GET /api/v1/export`：按仓库当地时区导出库存 Excel。
- `GET/PATCH /api/v1/users`、`GET /api/v1/settings`：管理员用户和主数据接口。

Excel 字段映射和拒绝规则见 `docs/field-mapping.md`。日期在表单中按车辆的仓库时区解释，数据库保存为绝对时间，页面和导出时再转换回仓库当地时间。

## 验证和部署

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Docker 镜像会固定并启用 pnpm 11.7.0：

```bash
docker build -t cargo-management .
docker run --env-file .env -p 3000:3000 cargo-management
```

部署前必须执行 `pnpm db:deploy` 和 `pnpm db:seed`，并确保 `APP_URL`、数据库连接和管理员密码使用生产值。
