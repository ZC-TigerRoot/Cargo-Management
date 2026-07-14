# 车仓通 · 汽车仓储管理系统

面向海外保税仓和国内汽车仓储业务的响应式 Web/PWA。首版包含车辆台账、实时库存看板、角色权限预览、入库录入、车辆审计时间线、司机免登录提车签收、Excel 预校验和导出接口。

## 本地启动

1. 复制 `.env.example` 为 `.env`。
2. 使用 `docker compose up -d` 启动 PostgreSQL。
3. 执行 `pnpm db:generate`、`pnpm db:migrate` 和 `pnpm dev`。
4. 访问 `http://localhost:3000`；司机签收演示页为 `/driver/demo-pickup`。

当前首页使用内置演示车辆，以便在数据库初始化前直接验收交互。`prisma/schema.prisma` 是生产数据模型；接入正式环境时，将演示数据仓库替换为 Prisma 仓储层并配置对象存储。

## 主要接口

- `GET/POST /api/v1/vehicles`：车辆查询与录入。
- `GET /api/v1/dashboard`：库存指标。
- `GET/POST /api/v1/driver/:token`：司机任务与签收。
- `POST /api/v1/import/preview`：Excel 导入预校验。
- `GET /api/v1/export`：库存 Excel 导出。

Excel 字段映射和拒绝导入规则见 `docs/field-mapping.md`。

