# Cargo Management 项目规则

## 技术基线

- 本地开发：Node.js 22
- 生产环境：Node.js 24
- 包管理器：`pnpm@11.7.0`（由 `package.json` 中 `packageManager` 锁定）
- 数据库：PostgreSQL 16
- 时区：所有时间存储为 UTC，用户界面统一使用 Asia/Shanghai

## 验证顺序

任何提交或部署前必须按顺序执行以下命令，上一步失败则停止：

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

## 权限与安全

- 会话使用 `AUTH_SECRET` 签名的 HttpOnly、SameSite=Strict Cookie，有效期 8 小时
- 只有管理员可删除车辆、管理用户、重置密码
- 车辆修改使用版本号乐观锁，并发冲突返回 HTTP 409
- 写请求校验同源信息
- 上传文件保存在 `UPLOAD_DIR`，数据库只存相对路径
- 不将 `.env`、私钥或凭据提交到仓库

## 车辆状态行为

- 车辆状态仅在**创建/导入时**自动推断；编辑时间字段不会重新计算状态
- `实际出库时间` 自动对应"待签收"，而"已出库"没有自动触发条件
- 创建提货任务自动变为"待提货"；司机签收后直接变为"已完成"
- 状态可人工越级修改，但必须填写原因

## 已知技术债

- Excel 导入固定读取第一张工作表（`excel-import.ts:106`）；含隐藏汇总表的文件会读错数据
- 分页为浏览器端 `slice`，后端仍一次返回全部车辆和事件（`vehicle-table.tsx:108`、`vehicle-repository.ts:460`）
- 看板在内存中聚合全部车辆，大数据量下需改为 SQL 聚合
- 生产响应缺少部分推荐的 HTTP 安全响应头

## 部署规则

- 生产部署必须读取 `deploy-cargo-latest` skill 和其 `references/production.md`
- 日常更新**不得**执行 `pnpm db:seed`（会重置管理员密码和会话）
- 不得泄露 `.env` 或私钥
- 不得使用宽泛的 `pkill`、`killall` 停止 Node 进程
- 除非用户明确要求，否则不执行部署
