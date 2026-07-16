# Cargo production reference

Treat these as expected values and verify them on every deployment because server state can drift.

## Connection and repository

- Production SSH target: `root@bj.tigerroot.cn`, port `22`
- Repository: `git@github.com:ZC-TigerRoot/Cargo-Management.git`
- Deployment branch: `main`
- Local GitHub identity file: `/Users/zctigerroot/.ssh/Codex`
- Expected public-key fingerprint: `SHA256:sEYs9fQpB2qhM/Ho+UjPO4IfC5V1Kcn268nXde/9gio`
- Use an ephemeral local SSH agent and agent forwarding. Do not install this personal private key on the server.

## Production layout

- Public site: `https://cargo.tigerroot.cn`
- BaoTa project: `cargo-management`
- Runtime user: `www`
- Internal listener: `127.0.0.1:3000`
- Stable app directory: `/www/wwwroot/Cargo-Management/app`
- Shared environment: `/www/wwwroot/Cargo-Management/shared/.env`
- Persistent uploads: `/www/wwwroot/Cargo-Management/shared/uploads`
- Maintained source directory: `/www/wwwroot/Cargo-Management-source`

The server was previously observed as AlmaLinux with a 4 GB swap file, Node 24, PostgreSQL, and a BaoTa-managed Node/PM2 process. Re-detect actual versions and the exact service-control command instead of assuming they are unchanged. The stable app path matters to BaoTa process detection, so do not replace it with a release symlink.

## Build and release invariants

- Use the pnpm version pinned by `packageManager` in `package.json`.
- Prefer `pnpm install --frozen-lockfile --child-concurrency=1 --network-concurrency=8` on this memory-constrained host.
- Run `pnpm db:generate`, `pnpm test`, `pnpm exec tsc --noEmit`, and `pnpm build` before migrations or service interruption.
- Build a standalone release with:
  - `.next/standalone/`
  - `public/`
  - `.next/static/` copied to `.next/standalone/.next/static/`
  - `scripts/standalone-supervisor.cjs` copied as `supervisor.cjs`
- Require both Prisma engine targets: `rhel-openssl-3.0.x` and `rhel-openssl-1.0.x`.
- Keep environment values out of the release. The only `.env` entry allowed in the final app directory is an absolute symlink to `/www/wwwroot/Cargo-Management/shared/.env`.
- Run `pnpm db:deploy`; never run `pnpm db:seed` for an update deployment.

## Minimum health checks

1. Confirm the managed Cargo process is running as the expected user.
2. Require HTTP 200 from `http://127.0.0.1:3000/login`.
3. Require HTTP 200 from `https://cargo.tigerroot.cn/login` with normal TLS verification.
4. POST a unique nonexistent email and dummy password to `/api/v1/auth/login` with the correct public `Origin`; require HTTP 401. Do not use or print a real credential.
5. Check recent Cargo logs for `Prisma`, startup, bind, migration, or supervisor errors.

Do not delete the shared environment, uploads, database data, Nginx site, certificate, or unrelated BaoTa projects. Do not modify the administrator password during deployment.
