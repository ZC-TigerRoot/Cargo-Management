---
name: deploy-cargo-latest
description: Deploy the latest main branch of ZC-TigerRoot/Cargo-Management to its production server over SSH, using the user's local GitHub SSH key through agent forwarding. Use when the user asks to “部署最新版本”, “部署最新代码”, “更新生产服务器”, “拉取 GitHub 最新更新并部署”, or otherwise requests a production update of the Cargo project.
---

# Deploy Cargo Latest

Read [references/production.md](references/production.md) before running commands. Treat a matching request as authorization to deploy the latest remote `main` commit and restart only the Cargo production service. Do not extend that authorization to unrelated server maintenance.

## Protect credentials and production data

- Never print, copy, upload, or persist the private key or an SSH password. Never put credentials in command arguments, scripts, environment variables, commentary, or the final response.
- Use the local GitHub key only through a temporary `ssh-agent` and `ssh -A`. Never copy the key to the server. Kill the temporary agent when the deployment ends.
- Keep normal host-key verification enabled. Accept a genuinely new host only with `StrictHostKeyChecking=accept-new`; stop on a changed-host-key warning. Never use `StrictHostKeyChecking=no`.
- Authenticate to the production server separately from GitHub. Prefer an existing server key or agent. If a password is required, use an interactive TTY and ask the user to enter it; never write it into this skill or any file.
- Preserve the production `.env`, uploads, database, TLS configuration, Nginx configuration, and unrelated processes. Do not expose environment values in output.
- Do not run `pnpm db:seed` during routine deployments. This project's seed script resets the administrator password and invalidates sessions.

## Deploy in guarded stages

1. Announce the server, repository, branch, and intended health checks without exposing secrets.
2. Confirm the configured local GitHub key exists with mode `0600`, start a temporary agent, add that key, and connect to the configured SSH target with agent forwarding. Use a TTY when server authentication may prompt.
3. Before changing anything, run `hostname`, `whoami`, and `pwd`; confirm the Cargo paths, shared `.env`, persistent upload directory, free disk, memory/swap, Node, pnpm, Git, PostgreSQL reachability, current Cargo process, current deployed revision when recorded, and both local and public health. Stop if the target or service is ambiguous.
4. Verify GitHub access from the server through the forwarded agent. The expected successful `ssh -T git@github.com` message may return status 1; judge the message, not only the status. Stop if the key is not authorized for the repository.
5. Clone the exact SSH repository and remote `main` into a fresh staging directory under the production filesystem. Do not overwrite the existing source or app directory during fetch/build. Record the full commit SHA and verify `origin` exactly matches the configured repository.
6. Link the staged checkout's `.env` to the shared production environment file without displaying it. Enable the repository-pinned pnpm version, then run a memory-conscious frozen install, Prisma generation, tests, TypeScript checking, and the production build. Avoid shell tracing. On this host, keep pnpm child concurrency low and confirm swap remains available.
7. Assemble a clean Next.js standalone release from `.next/standalone`, `public`, `.next/static`, and `scripts/standalone-supervisor.cjs`. Reject the release if it contains any regular `.env` file, lacks `server.js`, or lacks either required RHEL Prisma engine. Add only an absolute `.env` symlink to the shared environment file and record the commit in `REVISION`.
8. Check pending migrations before changing the service. Normally run `pnpm db:deploy` from the staged source only after every build check passes. If `20260730100000_calendar_dates` is pending, it is an incompatible migration: first discover the exact BaoTa/PM2 controls, back up the current app directory, and stop only the Cargo service; then run `pnpm db:deploy` before switching files. Do not seed. If that migration fails, leave app files unchanged and restart the old Cargo service. Never attempt an automatic database migration rollback.
9. Discover and record the existing BaoTa/PM2 Cargo stop, start, and status mechanism before switching files. Back up the current app directory if step 8 did not already do so, stop only the Cargo service if it is still running, synchronize the staged standalone release into the stable app directory, restore the expected `www` ownership, and restart through the existing service manager. Do not use broad `pkill` commands.
10. Verify the Cargo process, `127.0.0.1:3000/login`, the public HTTPS login page, and a deliberately invalid login API request that must return 401 without logging credentials. Inspect recent Cargo logs for startup, Prisma, and migration errors.
11. If runtime verification fails, restore the backed-up app files and restart the previous app. State clearly that applied database migrations remain applied. Retain the previous app backup and any database backup; remove only failed staging files.
12. On success, update the maintained source checkout only if doing so cannot discard remote changes; otherwise leave the clean staged checkout as the new source directory. Keep at least the immediately previous app backup. Remove other temporary staging files only after verification.

## Report the deployment

Return the deployed full and short commit SHA, previous revision if known, server and site, migration result, restart method, local/public/API health results, rollback status, and any remaining warning. Never include secret values or private-key material.
