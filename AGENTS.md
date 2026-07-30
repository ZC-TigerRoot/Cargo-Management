# Cargo Management 项目规则

## 技术基线

- 本地开发：Node.js 22
- 生产环境：Node.js 24
- 包管理器：`pnpm@11.7.0`（由 `package.json` 中 `packageManager` 锁定）
- 数据库：PostgreSQL 16
- 日期：数据库持久化日期使用 PostgreSQL `DATE` 和 `YYYY-MM-DD`，当天边界统一按 Asia/Shanghai；JWT、限流等运行时精确时刻使用 UTC

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
- 业务批次按仓库隔离；相同业务类型和单号在不同仓库必须使用不同的 `BusinessBatch`，不得跨仓共享或更新批次主数据
- 写请求校验同源信息
- 上传文件保存在 `UPLOAD_DIR`，数据库只存相对路径
- 不将 `.env`、私钥或凭据提交到仓库

## 车辆状态行为

- 创建/导入时按业务日期自动推断状态；编辑补充数据时，若当前状态与推断结果一致（即非人工设定），会按新数据自动重算（`vehicle-repository.ts` 中 `expectedAutoStatus`）
- 人工越级修改的状态（如"异常"、"已出库"）在后续补充数据时保持不变，直到再次手动修改；司机签收后的"已完成"同样不被自动重算覆盖
- `出库通知单交付给商社日期` 有值自动对应"已出库"；`实际出库日期` 有值且 `客户交付签收单日期` 为空自动对应"待签收"，签收单交付后自动变为"已完成"
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
