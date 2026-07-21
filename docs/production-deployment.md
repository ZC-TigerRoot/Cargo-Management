# Cargo 生产部署与更新指南

本文记录 Cargo Management 当前采用的最终生产部署方案，以及后续从 GitHub 更新生产环境的标准流程。

> 当前生产环境使用 **Next.js standalone 发布包 + 宝塔/PM2 进程托管 + Nginx HTTPS 反向代理**。生产进程不直接在源码目录中运行，也不使用 `next dev`。

## 1. 当前生产拓扑

| 项目 | 当前配置 |
| --- | --- |
| GitHub 仓库 | `git@github.com:ZC-TigerRoot/Cargo-Management.git` |
| 部署分支 | `main` |
| 生产服务器 | `root@bj.tigerroot.cn:22` |
| 公网地址 | `https://cargo.tigerroot.cn` |
| 宝塔项目名 | `cargo-management` |
| 运行用户 | `www` |
| 内部监听地址 | `127.0.0.1:3000` |
| 源码目录 | `/www/wwwroot/Cargo-Management-source` |
| 稳定运行目录 | `/www/wwwroot/Cargo-Management/app` |
| 共享环境变量 | `/www/wwwroot/Cargo-Management/shared/.env` |
| 持久化上传目录 | `/www/wwwroot/Cargo-Management/shared/uploads` |

```mermaid
flowchart LR
    A["GitHub main"] --> B["临时源码目录"]
    B --> C["测试、类型检查和构建"]
    C --> D["Prisma 数据库迁移"]
    D --> E["Next.js standalone 发布包"]
    E --> F["稳定 app 目录"]
    F --> G["宝塔 / PM2"]
    G --> H["127.0.0.1:3000"]
    H --> I["Nginx HTTPS"]
```

### 目录设计原则

- `Cargo-Management-source` 保存维护用源码，但更新构建应在新的临时目录中进行，不能覆盖正在运行的程序。
- `Cargo-Management/app` 只保存经过验证的 standalone 运行包。宝塔始终指向这个固定路径，不要把它替换成版本软链接。
- `.env` 和上传文件放在 `shared` 中，不随发布包替换。
- `app/.env` 必须是指向 `shared/.env` 的绝对软链接，发布包中不得包含普通 `.env` 文件。
- 至少保留上一个可运行版本的备份，以便程序启动失败时回滚。

## 2. 首次部署

### 2.1 服务器依赖

服务器需要准备：

- 宝塔面板、Nginx 和 Node 项目管理器；
- Node.js 运行环境；当前生产环境使用经过验证的 Node.js 24，项目最低基线为 Node.js 22；
- Corepack 和项目锁定的 `pnpm@11.7.0`；
- PostgreSQL；
- Git 和可用的 GitHub SSH 访问；
- 足够的磁盘、内存和 swap。

构建和运行应使用相同的 Node.js 主版本。服务器版本可能变化，每次部署前都要重新检查：

```bash
node --version
corepack --version
pnpm --version
git --version
df -h
free -h
```

### 2.2 创建生产目录

```bash
mkdir -p /www/wwwroot/Cargo-Management/app
mkdir -p /www/wwwroot/Cargo-Management/shared/uploads
chown -R www:www /www/wwwroot/Cargo-Management
```

共享目录不能在日常更新中删除或覆盖。

### 2.3 配置生产环境变量

创建 `/www/wwwroot/Cargo-Management/shared/.env`：

```dotenv
DB_HOST="127.0.0.1"
DB_PORT="5432"
DB_NAME="cargo_management"
DB_USER="cargo"
DB_PASSWORD="请填写生产数据库密码"

AUTH_SECRET="请填写至少32字符的随机值"
APP_URL="https://cargo.tigerroot.cn"

ADMIN_EMAIL="请填写初始管理员邮箱"
ADMIN_PASSWORD="请填写至少12字符的初始管理员密码"
ADMIN_NAME="系统管理员"

SEED_DEMO_DATA="false"
UPLOAD_DIR="/www/wwwroot/Cargo-Management/shared/uploads"

HOSTNAME="127.0.0.1"
PORT="3000"
NODE_ENV="production"
```

生成 `AUTH_SECRET`：

```bash
openssl rand -hex 32
```

限制环境文件权限，且不要在命令输出、日志或 Git 中显示其内容：

```bash
chown www:www /www/wwwroot/Cargo-Management/shared/.env
chmod 600 /www/wwwroot/Cargo-Management/shared/.env
```

### 2.4 首次检出和构建

通过 SSH agent forwarding 让服务器临时使用本机已经授权 GitHub 的密钥。不要把个人私钥复制到服务器。

```bash
git clone --branch main --single-branch \
  git@github.com:ZC-TigerRoot/Cargo-Management.git \
  /www/wwwroot/Cargo-Management-source

cd /www/wwwroot/Cargo-Management-source
ln -s /www/wwwroot/Cargo-Management/shared/.env .env

corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=8
pnpm db:generate
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

任一检查失败都应停止部署，不能迁移数据库或中断现有进程。

### 2.5 初始化数据库

首次创建空数据库时执行：

```bash
cd /www/wwwroot/Cargo-Management-source
pnpm db:deploy
pnpm db:seed
```

`pnpm db:seed` **仅执行一次**。它会创建或更新管理员、重置管理员密码，并使该管理员的已有会话失效。生产环境保持 `SEED_DEMO_DATA="false"`。

### 2.6 组装 standalone 运行包

一个完整的运行包必须包含：

- `.next/standalone/` 中的全部内容；
- `public/`；
- `.next/static/`，放到运行包的 `.next/static/`；
- `scripts/standalone-supervisor.cjs`，在运行包中命名为 `supervisor.cjs`；
- 指向共享环境文件的 `.env` 软链接；
- 记录 Git commit 的 `REVISION` 文件。

示例：

```bash
cd /www/wwwroot/Cargo-Management-source
RELEASE_DIR="$(mktemp -d /www/wwwroot/Cargo-Management/.release-XXXXXX)"

cp -a .next/standalone/. "$RELEASE_DIR/"
cp -a public "$RELEASE_DIR/public"
mkdir -p "$RELEASE_DIR/.next"
cp -a .next/static "$RELEASE_DIR/.next/static"
cp scripts/standalone-supervisor.cjs "$RELEASE_DIR/supervisor.cjs"
git rev-parse HEAD > "$RELEASE_DIR/REVISION"

test -f "$RELEASE_DIR/server.js"
test -f "$RELEASE_DIR/supervisor.cjs"
test -z "$(find "$RELEASE_DIR" -type f -name .env -print -quit)"
find "$RELEASE_DIR" -type f -name '*rhel-openssl-3.0.x*' -print -quit | grep -q .
find "$RELEASE_DIR" -type f -name '*rhel-openssl-1.0.x*' -print -quit | grep -q .
ln -s /www/wwwroot/Cargo-Management/shared/.env "$RELEASE_DIR/.env"
```

Prisma 发布包必须同时包含 `rhel-openssl-3.0.x` 和 `rhel-openssl-1.0.x` 引擎。缺少任意一个时不要上线。

首次上线时，把验证后的发布包同步到固定运行目录：

```bash
rsync -a --delete "$RELEASE_DIR/" /www/wwwroot/Cargo-Management/app/
chown -R www:www /www/wwwroot/Cargo-Management/app
```

### 2.7 宝塔项目配置

宝塔 Node 项目使用以下配置：

| 表单项 | 填写内容 |
| --- | --- |
| 项目类型 | 使用能够运行自定义启动文件的“传统项目”模式；已有项目保持当前托管方式 |
| 项目名称 | `cargo-management` |
| 项目目录 | `/www/wwwroot/Cargo-Management/app` |
| 启动文件/命令 | `supervisor.cjs` / `node supervisor.cjs` |
| Node 版本 | 与构建时相同的已验证版本 |
| 运行用户 | `www` |
| 项目端口 | `3000` |

不要选择 `dev: next dev`，也不要让生产进程直接在源码目录中执行 `next start`。

Nginx 将公网域名反向代理到 `http://127.0.0.1:3000`，至少保留以下请求头设置：

```nginx
client_max_body_size 6m;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

## 3. 日常更新方式

### 3.1 推荐方式：让 OpenCode 执行受保护部署

代码合并并推送到 GitHub `main` 后，在本项目中执行：

```text
/deploy
```

部署流程会自动完成：

1. 检查服务器身份、资源、运行进程、生产路径和当前健康状态；
2. 通过临时 SSH agent forwarding 获取 GitHub 最新 `main`；
3. 在全新的 staging 目录安装依赖并执行测试、类型检查和构建；
4. 组装并验证 standalone 发布包；
5. 执行 `pnpm db:deploy`，但不执行 seed；
6. 备份当前运行目录，只停止 Cargo 项目并切换文件；
7. 使用宝塔现有管理方式重启项目；
8. 检查本地页面、公网页面、登录 API 和近期日志；
9. 若运行检查失败，恢复上一个应用版本。

部署完成后应记录新旧 commit、数据库迁移结果、进程重启方式和健康检查结果。

### 3.2 手动更新流程

如果需要人工更新，应严格按下面顺序执行。

#### 第一步：部署前检查

- 确认目标服务器、仓库和分支正确；
- 确认共享 `.env`、上传目录和数据库存在；
- 检查磁盘、内存、swap、Node、pnpm、Git 和 PostgreSQL；
- 记录当前 `app/REVISION`；
- 确认 Cargo 当前进程及宝塔/PM2 的停止、启动和状态命令；
- 检查 `http://127.0.0.1:3000/login` 和公网登录页当前正常。

#### 第二步：在新目录拉取并验证代码

```bash
STAGE_DIR="$(mktemp -d /www/wwwroot/Cargo-Management/.deploy-XXXXXX)"
git clone --branch main --single-branch \
  git@github.com:ZC-TigerRoot/Cargo-Management.git \
  "$STAGE_DIR/source"

cd "$STAGE_DIR/source"
test "$(git remote get-url origin)" = "git@github.com:ZC-TigerRoot/Cargo-Management.git"
git rev-parse HEAD
ln -s /www/wwwroot/Cargo-Management/shared/.env .env

corepack enable
corepack prepare pnpm@11.7.0 --activate
pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=8
pnpm db:generate
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

#### 第三步：组装发布包并执行迁移

按“2.6 组装 standalone 运行包”创建并验证 release。所有构建检查通过后，且在停止服务之前执行：

```bash
cd "$STAGE_DIR/source"
pnpm db:deploy
```

日常更新严禁执行：

```bash
pnpm db:seed
```

如果迁移失败，停止更新并保持当前运行程序不变。不要自动回滚数据库迁移。

#### 第四步：备份并切换应用

先记录宝塔/PM2 中 Cargo 项目的准确停止和启动方式。以下变量仅表示流程，实际服务控制命令必须以服务器当前配置为准：

```bash
APP_DIR="/www/wwwroot/Cargo-Management/app"
BACKUP_DIR="/www/wwwroot/Cargo-Management/app-backup-$(date +%Y%m%d-%H%M%S)"

cp -a "$APP_DIR" "$BACKUP_DIR"

# 通过宝塔/PM2 只停止 cargo-management 项目
# <Cargo 项目停止命令>

rsync -a --delete "$RELEASE_DIR/" "$APP_DIR/"
chown -R www:www "$APP_DIR"

# 通过原有管理方式启动 cargo-management 项目
# <Cargo 项目启动命令>
```

不要使用 `pkill node`、`killall node` 等会影响其他项目的宽泛命令。

#### 第五步：上线验证

```bash
curl --fail --silent --show-error \
  http://127.0.0.1:3000/login > /dev/null

curl --fail --silent --show-error \
  https://cargo.tigerroot.cn/login > /dev/null

HEALTH_EMAIL="deploy-health-$(date +%s)@invalid.example"
curl --silent --output /dev/null --write-out '%{http_code}\n' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header 'Origin: https://cargo.tigerroot.cn' \
  --data "{\"email\":\"$HEALTH_EMAIL\",\"password\":\"invalid-health-check-password\"}" \
  https://cargo.tigerroot.cn/api/v1/auth/login
```

预期结果：

- 内网登录页返回 HTTP 200；
- 公网 HTTPS 登录页返回 HTTP 200，TLS 验证正常；
- 使用不存在账号的登录请求返回 HTTP 401；
- Cargo 进程以 `www` 用户运行；
- 近期日志中没有启动、端口、Prisma 或迁移错误。

成功后保留至少一个上次运行版本的备份，并在确认新版本稳定后清理其余临时 staging 文件。

## 4. 回滚方式

如果文件切换后应用无法通过健康检查：

1. 只停止 Cargo 项目；
2. 保留失败版本及其日志；
3. 将刚才创建的 `app-backup-*` 内容恢复到固定的 `app` 目录；
4. 恢复 `www` 所有权；
5. 使用原有宝塔/PM2 方式启动；
6. 重新执行内网、公网、API 和日志检查。

数据库迁移不会因为应用文件回滚而自动撤销。不要在生产环境自动执行降级迁移；如果新迁移与旧代码不兼容，需要单独制定数据库恢复方案。

## 5. 更新中禁止修改的内容

日常更新不得删除、覆盖或泄露：

- `/www/wwwroot/Cargo-Management/shared/.env`；
- `/www/wwwroot/Cargo-Management/shared/uploads`；
- PostgreSQL 数据；
- Nginx 站点和 TLS 证书；
- 宝塔中的其他项目和 Node 进程；
- 服务器或 GitHub 私钥；
- 当前管理员密码。

## 6. 常见错误

- 使用 `dev: next dev` 运行生产站点；
- 在源码目录中原地 `git pull`、构建并覆盖正在运行的文件；
- 日常更新执行 `pnpm db:seed`，导致管理员密码被重置；
- 把 `.env` 或上传文件打进发布包；
- 用软链接替换固定的 `app` 目录，导致宝塔无法正确识别进程；
- 构建或测试失败后仍继续迁移数据库；
- 迁移失败后仍停止当前服务；
- 使用宽泛的进程终止命令影响其他 Node 项目；
- 只检查进程状态，没有检查内网、公网、API 和日志。

## 7. 发布完成记录

每次发布至少记录：

```text
部署时间：
部署人员/执行方式：
服务器：bj.tigerroot.cn
站点：https://cargo.tigerroot.cn
部署分支：main
旧 commit：
新 commit：
数据库迁移：成功 / 无迁移 / 失败
服务重启方式：
内网健康检查：
公网健康检查：
登录 API 检查：
日志检查：
应用回滚：未触发 / 已触发
保留备份目录：
备注：
```
