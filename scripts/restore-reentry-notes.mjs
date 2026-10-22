#!/usr/bin/env node
// Node 24: dry-run first, then pass its digest with --apply --expected-count 51
// --expected-digest <digest> --backup /root/<private-directory>/<new-file>.json.
import { createHash } from "node:crypto";
import { mkdir, open, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { databaseUrlFromEnv } from "../database-url.mjs";
import { appendReentryNotes, MAX_VEHICLE_NOTES_LENGTH } from "../src/lib/vehicle-notes.ts";
import {
  planReentryNotesRecovery,
  REENTRY_NOTES_RECOVERY_ACTOR,
  REENTRY_NOTES_RECOVERY_REASON,
} from "../src/lib/reentry-notes-recovery.ts";

class RecoveryScriptError extends Error {}
const EXPECTED_COUNT = 51;
const auditSelect = {
  id: true, entityType: true, entityId: true, action: true,
  recordSequence: true, before: true, after: true, reason: true,
};

function parseArguments(args) {
  const options = { apply: false, expectedCount: undefined, expectedDigest: undefined, backup: undefined, help: false };
  const names = { "--expected-count": "expectedCount", "--expected-digest": "expectedDigest", "--backup": "backup" };
  for (let index = 0; index < args.length; index++) {
    const [flag, ...valueParts] = args[index].split("=");
    if (flag === "--apply" || flag === "--help") {
      if (valueParts.length) throw new RecoveryScriptError("布尔参数不能带值。");
      options[flag === "--apply" ? "apply" : "help"] = true;
      continue;
    }
    const name = names[flag];
    if (!name || options[name] !== undefined) throw new RecoveryScriptError("存在未知或重复参数。");
    const value = valueParts.length ? valueParts.join("=") : args[++index];
    if (!value || value.startsWith("--")) throw new RecoveryScriptError("参数缺少取值。");
    options[name] = name === "expectedCount" ? Number(value) : value;
  }
  if (options.expectedCount !== undefined && options.expectedCount !== EXPECTED_COUNT) throw new RecoveryScriptError("本次恢复只允许 --expected-count 51。");
  if (options.expectedDigest !== undefined && !/^[a-f\d]{64}$/i.test(options.expectedDigest)) throw new RecoveryScriptError("--expected-digest 必须为 dry-run 输出的 SHA256。");
  if (options.expectedDigest) options.expectedDigest = options.expectedDigest.toLowerCase();
  if (options.apply && (options.expectedCount !== EXPECTED_COUNT || !options.expectedDigest || !options.backup)) {
    throw new RecoveryScriptError("应用恢复必须同时提供 --expected-count 51、--expected-digest 和 --backup。");
  }
  return options;
}

async function candidateIds(db) {
  const audits = await db.auditLog.findMany({
    where: { entityType: "Vehicle", action: "VEHICLE_REENTERED" },
    select: { entityId: true }, distinct: ["entityId"],
  });
  return audits.map(audit => audit.entityId).sort();
}

async function loadPlan(db, ids) {
  if (!ids.length) return planReentryNotesRecovery([], [], MAX_VEHICLE_NOTES_LENGTH, appendReentryNotes);
  const [rows, audits] = await Promise.all([
    db.vehicle.findMany({ where: { id: { in: ids } }, select: { id: true, version: true, currentCycle: true, notes: true, inboundAt: true } }),
    db.auditLog.findMany({ where: { entityType: "Vehicle", entityId: { in: ids } }, orderBy: { recordSequence: "asc" }, select: auditSelect }),
  ]);
  const vehicles = rows.map(row => ({ ...row, inboundAt: row.inboundAt?.toISOString().slice(0, 10) ?? null }));
  return planReentryNotesRecovery(vehicles, audits, MAX_VEHICLE_NOTES_LENGTH, appendReentryNotes);
}

function digest(plan) {
  return createHash("sha256").update(JSON.stringify({ reason: REENTRY_NOTES_RECOVERY_REASON, plan })).digest("hex");
}

function assertApplicable(plan) {
  if (plan.candidateCount !== EXPECTED_COUNT || plan.items.length !== EXPECTED_COUNT || plan.conflictCount || plan.skipped.length) {
    throw new RecoveryScriptError("候选、可恢复数量必须均为 51，且不能有冲突或需跳过的车辆；未执行恢复。");
  }
}

async function savePrivateBackup(filename, plan, planDigest) {
  const resolvedFilename = path.resolve(filename);
  if (!path.isAbsolute(filename) || !resolvedFilename.startsWith("/root/")) throw new RecoveryScriptError("备份必须位于 /root 下的私有目录。");
  const directory = path.dirname(resolvedFilename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actualDirectory = await realpath(directory);
  const directoryStat = await stat(actualDirectory);
  if (!(actualDirectory === "/root" || actualDirectory.startsWith("/root/")) || (directoryStat.mode & 0o077)) {
    throw new RecoveryScriptError("备份目录必须位于 /root 内且禁止组或其他用户访问。");
  }
  const handle = await open(path.join(actualDirectory, path.basename(resolvedFilename)), "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({
      format: "cargo-reentry-notes-recovery/v1", createdAtUTC: new Date().toISOString(),
      reason: REENTRY_NOTES_RECOVERY_REASON, planDigest, plan,
    }, null, 2), "utf8");
    await handle.sync();
    if (((await handle.stat()).mode & 0o777) !== 0o600) throw new RecoveryScriptError("备份文件权限必须为 600。");
  } finally {
    await handle.close();
  }
}

async function run() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log("默认只读 dry-run。应用：node --env-file=.env scripts/restore-reentry-notes.mjs --apply --expected-count 51 --expected-digest <dry-run SHA256> --backup /root/<私有目录>/<新备份文件>.json");
    return;
  }
  if (Number(process.versions.node.split(".")[0]) !== 24) throw new RecoveryScriptError("请使用生产 Node.js 24 执行本脚本。");
  const db = new PrismaClient({ datasourceUrl: databaseUrlFromEnv(), log: [] });
  try {
    const ids = await candidateIds(db);
    const initial = await loadPlan(db, ids);
    const initialDigest = digest(initial);
    console.log(JSON.stringify({
      mode: options.apply ? "apply-preflight" : "dry-run", candidates: initial.candidateCount,
      recoverable: initial.items.length, skipped: initial.skipped.length,
      conflicts: initial.conflictCount, categories: initial.counts, planDigest: initialDigest,
    }));
    if (options.expectedDigest && options.expectedDigest !== initialDigest) throw new RecoveryScriptError("当前计划与指定 dry-run 指纹不一致；未执行恢复。");
    if (!options.apply) return;
    assertApplicable(initial);
    await savePrivateBackup(options.backup, initial, initialDigest);
    await db.$transaction(async tx => {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "Vehicle" WHERE "id" IN (${Prisma.join(ids)})
        ORDER BY "id" FOR UPDATE
      `);
      if (JSON.stringify(await candidateIds(tx)) !== JSON.stringify(ids)) throw new RecoveryScriptError("候选车辆发生变化；事务已取消。");
      const locked = await loadPlan(tx, ids);
      assertApplicable(locked);
      if (digest(locked) !== initialDigest) throw new RecoveryScriptError("锁行后恢复计划发生变化；事务已取消。");
      for (const item of locked.items) {
        const result = await tx.vehicle.updateMany({
          where: { id: item.vehicleId, version: item.expectedVersion, currentCycle: item.currentCycle, notes: item.currentNotes },
          data: { notes: item.restoredNotes, version: { increment: 1 } },
        });
        if (result.count !== 1) throw new RecoveryScriptError("车辆版本发生冲突；整批恢复已取消。");
      }
      const written = await tx.vehicle.findMany({
        where: { id: { in: ids } }, select: { id: true, notes: true, version: true, currentCycle: true, updatedAt: true },
      });
      const byId = new Map(written.map(vehicle => [vehicle.id, vehicle]));
      await tx.auditLog.createMany({ data: locked.items.map(item => {
        const actual = byId.get(item.vehicleId);
        if (!actual || actual.notes !== item.restoredNotes || actual.version !== item.expectedVersion + 1 || actual.currentCycle !== item.currentCycle) {
          throw new RecoveryScriptError("写入回读结果不一致；整批恢复已取消。");
        }
        return {
          entityType: "Vehicle", entityId: item.vehicleId, action: "VEHICLE_UPDATED",
          actorLabel: REENTRY_NOTES_RECOVERY_ACTOR, reason: REENTRY_NOTES_RECOVERY_REASON,
          before: item.before, after: { ...item.after, updatedAt: actual.updatedAt.toISOString().slice(0, 10) },
        };
      }) });
    }, { isolationLevel: "Serializable", timeout: 30_000 });
    console.log(JSON.stringify({ mode: "applied", restored: initial.items.length, auditRecords: initial.items.length }));
  } finally {
    await db.$disconnect();
  }
}

run().catch(error => {
  console.error(error instanceof RecoveryScriptError ? error.message : "执行结果未确认。未输出数据库错误详情，请检查私有备份并重新 dry-run 核对；事务内部失败会整批回滚。");
  process.exitCode = 1;
});
