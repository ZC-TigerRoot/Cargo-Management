# 车仓通 · 汽车仓储管理系统

面向海外保税仓和国内汽车仓储业务的响应式 Web/PWA。系统包含车辆台账、实时库存看板、角色权限、车辆审计时间线、司机二维码提车签收、Excel 预校验和库存导出。

## 本地启动

要求 Node.js 22、pnpm 11 和 PostgreSQL 16。

1. 复制 `.env.example` 为 `.env`，填写 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER` 和 `DB_PASSWORD`，设置不少于 32 字符的随机 `AUTH_SECRET`，并替换管理员邮箱和密码。
2. 使用 `docker compose up -d` 启动 PostgreSQL。
3. 执行 `pnpm install`、`pnpm db:generate`、`pnpm db:migrate` 和 `pnpm db:seed`。
4. 执行 `pnpm dev`，访问 `http://localhost:3000/login`。

如需创建演示车辆和 `/driver/demo-pickup` 提货任务，可在首次执行 `pnpm db:seed` 前设置 `SEED_DEMO_DATA="true"`。生产环境应保持为 `false`。

## 权限与数据安全

- 登录会话使用由 `AUTH_SECRET` 签名的 HttpOnly、SameSite=Strict Cookie，有效期 8 小时。
- 只有管理员可以删除车辆，也只有管理员可以创建、编辑、启停用户，重置密码并分配角色和数据范围；密码重置会使该用户原有登录会话失效。删除车辆会同步清理其业务事件、提货关联和无其他引用的现场附件，并保留删除审计。货代可管理业务和基础设置，但不能访问用户管理。客户只能查看绑定客户名下的车辆；仓管只能查看、录入和修改分配给自己的仓库数据。
- 权限在页面代理和每个 API handler 中同时校验，写请求还校验同源信息。
- 提货任务保存可读取的随机令牌，已创建任务的二维码和签收链接可从提货任务页重复查看与下载。
- 提货二维码管理支持按任务号、提单号 / PO、车架号、车型、品牌、客户、仓库和 BOE 信息，同时筛选可生成二维码的车辆及已有二维码任务。
- 司机签收时必须填写姓名和联系电话；两项信息随签收事件保存并显示在后台车辆详情时间线。司机现场照片以文件形式保存在 `UPLOAD_DIR`（默认 `./data/uploads`），数据库只保存相对路径和文件元数据；后台通过登录鉴权接口在对应签收时间线节点查看，上传目录不可直接公开。
- 车辆修改使用版本号进行乐观锁检查；并发冲突返回 HTTP 409，不会静默覆盖其他用户的修改。
- 车辆创建、字段修改、状态变更、提货任务、司机签收、用户权限和系统设置均在数据库事务中写入审计日志；车辆详情展示修改人、中国标准时间及字段前后值。
- 车辆表格支持按业务类型、状态、仓库、客户、车型、品牌、单号、BOE、日期、金额和库存账龄等字段独立组合筛选，各筛选项与结果区实时统计数量；导出的 Excel 严格使用当前筛选条件，并附带筛选统计工作表。
- 车辆表格支持选择显示属性、按属性升降序、调整属性排列顺序，以及管理员多选或全选后批量删除；个人显示偏好保存在浏览器中。
- 手工新建车辆时所有业务字段均可缺省，系统先创建待完善档案；Excel 导入仍要求每个可导入行包含唯一车架号。

## 主要接口

- `POST /api/v1/auth/login`、`POST /api/v1/auth/logout`：登录会话。
- `GET/POST/PATCH/DELETE /api/v1/vehicles`：车辆查询、录入、带版本控制的更正和管理员删除。
- `GET /api/v1/dashboard`：实时库存指标。
- `GET/POST /api/v1/pickups`：查询和创建提货二维码任务。
- `GET/POST /api/v1/driver/:token`：司机读取任务与 multipart 图片上传、幂等签收。
- `GET /api/v1/attachments/:id`：按车辆数据权限读取现场图片。
- `POST /api/v1/import/preview`、`POST /api/v1/import`：Excel 导入预校验和有效行导入；限制 10 MB 和 10,000 行，异常行会逐行返回原因且不会导入。
- `GET /api/v1/export`：按中国标准时间导出库存 Excel，支持与页面一致的字段筛选参数，并包含筛选统计、出入库金额与 BOE 字段。
- `GET/POST/PATCH /api/v1/users`、`GET/PATCH /api/v1/settings`：管理员用户、当前域名和主数据接口。

Excel 字段映射和拒绝规则见 `docs/field-mapping.md`。数据库保存绝对时间，所有录入、页面、审计、任务编号日期和导出统一使用中国标准时间（Asia/Shanghai）。

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
docker volume create cargo_uploads
docker run --env-file .env -e UPLOAD_DIR=/app/data/uploads -v cargo_uploads:/app/data/uploads -p 3000:3000 cargo-management
```

部署前必须执行 `pnpm db:deploy` 和 `pnpm db:seed`，并确保数据库连接和管理员密码使用生产值。生产环境必须把 `APP_URL` 设置为用户实际访问的 HTTPS origin（例如 `https://cargo.example.com`，不要添加路径），并把 `UPLOAD_DIR` 指向持久化、可写且会备份的目录；多实例部署时应挂载同一共享文件系统。管理员可在“基础设置”中配置生成提货二维码使用的当前域名；未配置时依次使用 `APP_URL` 和当前请求域名。

使用 Nginx 反向代理时，应把公开请求信息传给应用：

```nginx
client_max_body_size 6m;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```
