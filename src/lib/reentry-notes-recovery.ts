import type { appendReentryNotes } from "./vehicle-notes";

export const REENTRY_NOTES_RECOVERY_REASON = "cargo:restore-reentry-notes:v1";
export const REENTRY_NOTES_RECOVERY_ACTOR = "系统维护 · 历次入库备注补录";

export type RecoveryVehicle = {
  id: string;
  version: number;
  currentCycle: number;
  notes: string | null;
  inboundAt: string | null;
};

export type RecoveryAudit = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  recordSequence: bigint | string | number;
  before: unknown;
  after: unknown;
  reason: string | null;
};

export type ReentryNotesRecoveryItem = {
  vehicleId: string;
  expectedVersion: number;
  currentCycle: number;
  currentNotes: string;
  restoredNotes: string;
  inboundAt: string;
  reentryAuditId: string;
  reentryAuditSequence: string;
  latestAuditId: string;
  latestAuditSequence: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type ReentryNotesRecoverySkip = { vehicleId: string; code: string; conflict: boolean };
export type ReentryNotesRecoveryPlan = {
  candidateCount: number;
  items: ReentryNotesRecoveryItem[];
  skipped: ReentryNotesRecoverySkip[];
  counts: Record<string, number>;
  conflictCount: number;
};

function snapshot(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function sequence(value: RecoveryAudit["recordSequence"]): bigint | undefined {
  if (typeof value === "bigint") return value > BigInt(0) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return BigInt(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return BigInt(value);
  return undefined;
}

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Plan only the simple, audited overwrite: unchanged notes at reentry, then a
 * later VEHICLE_UPDATED audit that replaced those same old notes with today's
 * exact value. More complicated histories require separate review.
 * Runtime dependencies are injected so Node 24 can import this file directly.
 */
export function planReentryNotesRecovery(
  vehicles: readonly RecoveryVehicle[],
  audits: readonly RecoveryAudit[],
  maxNotesLength: number,
  appendNotes: typeof appendReentryNotes,
): ReentryNotesRecoveryPlan {
  const vehicleAudits = audits.filter(audit => audit.entityType === "Vehicle");
  const candidates = [...new Set([
    ...vehicles.map(vehicle => vehicle.id),
    ...vehicleAudits.filter(audit => audit.action === "VEHICLE_REENTERED").map(audit => audit.entityId),
  ])].sort();
  const byId = new Map(vehicles.map(vehicle => [vehicle.id, vehicle]));
  const currentCounts = new Map<string, number>();
  for (const vehicle of vehicles) currentCounts.set(vehicle.id, (currentCounts.get(vehicle.id) ?? 0) + 1);
  const grouped = new Map<string, RecoveryAudit[]>();
  for (const audit of vehicleAudits) grouped.set(audit.entityId, [...(grouped.get(audit.entityId) ?? []), audit]);
  const items: ReentryNotesRecoveryItem[] = [];
  const skipped: ReentryNotesRecoverySkip[] = [];
  const counts: Record<string, number> = {};
  const skip = (vehicleId: string, code: string, conflict = false) => {
    skipped.push({ vehicleId, code, conflict });
    counts[code] = (counts[code] ?? 0) + 1;
  };

  for (const id of candidates) {
    const vehicle = byId.get(id);
    const history = grouped.get(id) ?? [];
    if (!vehicle) { skip(id, "CURRENT_VEHICLE_MISSING", true); continue; }
    if (currentCounts.get(id) !== 1) { skip(id, "DUPLICATE_CURRENT_VEHICLE", true); continue; }
    if (history.some(audit => audit.reason === REENTRY_NOTES_RECOVERY_REASON)) { skip(id, "ALREADY_RECOVERED"); continue; }
    if (typeof vehicle.notes === "string" && /【第 \d+ 轮入库 · \d{4}-\d{2}-\d{2}】/.test(vehicle.notes)) { skip(id, "CYCLE_NOTES_ALREADY_PRESENT"); continue; }
    const sequences = history.map(audit => sequence(audit.recordSequence));
    if (sequences.some(value => value === undefined) || new Set(sequences).size !== sequences.length) { skip(id, "INVALID_AUDIT_SEQUENCE", true); continue; }
    const sorted = [...history].sort((left, right) => {
      const a = sequence(left.recordSequence)!;
      const b = sequence(right.recordSequence)!;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    const reentries = sorted.filter(audit => audit.action === "VEHICLE_REENTERED");
    if (reentries.length > 1) { skip(id, "MULTIPLE_REENTRY_AUDITS", true); continue; }
    const reentry = reentries[0];
    const latest = sorted.at(-1);
    if (!reentry || !latest) { skip(id, "NO_REENTRY_AUDIT"); continue; }
    if (latest.action !== "VEHICLE_UPDATED") { skip(id, "LATEST_ACTION_NOT_VEHICLE_UPDATED"); continue; }
    if (sequence(latest.recordSequence)! <= sequence(reentry.recordSequence)!) { skip(id, "LATEST_EDIT_NOT_AFTER_REENTRY", true); continue; }
    const reentryBefore = snapshot(reentry.before);
    const reentryAfter = snapshot(reentry.after);
    const latestBefore = snapshot(latest.before);
    const latestAfter = snapshot(latest.after);
    if (!reentryBefore || !reentryAfter || !latestBefore || !latestAfter) { skip(id, "AUDIT_SNAPSHOT_MISSING", true); continue; }
    if (!Number.isSafeInteger(vehicle.version) || vehicle.version < 1 || vehicle.version >= 2_147_483_647
      || latestAfter.version !== vehicle.version || latestAfter.currentCycle !== vehicle.currentCycle || latestAfter.notes !== vehicle.notes
      || latestAfter.id !== id || latestAfter.inboundAt !== vehicle.inboundAt) { skip(id, "CURRENT_AUDIT_MISMATCH", true); continue; }
    if (vehicle.currentCycle !== 2 || reentryBefore.currentCycle !== 1 || reentryAfter.currentCycle !== 2
      || latestBefore.currentCycle !== vehicle.currentCycle) { skip(id, "REENTRY_CYCLE_MISMATCH", true); continue; }
    if (reentryBefore.id !== id || reentryAfter.id !== id || latestBefore.id !== id
      || latestBefore.version !== vehicle.version - 1) { skip(id, "AUDIT_SNAPSHOT_IDENTITY_MISMATCH", true); continue; }
    if (!Number.isSafeInteger(reentryBefore.version) || Number(reentryBefore.version) < 1
      || reentryAfter.version !== Number(reentryBefore.version) + 1
      || Number(reentryAfter.version) > Number(latestBefore.version)) { skip(id, "REENTRY_VERSION_CHAIN_MISMATCH", true); continue; }
    const oldNotes = reentryBefore.notes;
    if (typeof oldNotes !== "string" || !oldNotes.trim() || reentryAfter.notes !== oldNotes) { skip(id, "REENTRY_NOTES_NOT_UNCHANGED", true); continue; }
    if (latestBefore.notes !== oldNotes) { skip(id, "LATEST_EDIT_DID_NOT_REPLACE_OLD_NOTES", true); continue; }
    if (typeof vehicle.notes !== "string" || !vehicle.notes.trim()) { skip(id, "CURRENT_NOTES_EMPTY", true); continue; }
    if (vehicle.notes === oldNotes) { skip(id, "NOTES_UNCHANGED"); continue; }
    if (vehicle.notes.includes(oldNotes)) { skip(id, "OLD_NOTES_ALREADY_PRESENT"); continue; }
    if (!isDate(reentryAfter.inboundAt) || reentryAfter.inboundAt !== vehicle.inboundAt) { skip(id, "INVALID_REENTRY_DATE", true); continue; }
    const restoredNotes = appendNotes(oldNotes, vehicle.notes, vehicle.currentCycle, reentryAfter.inboundAt);
    if (typeof restoredNotes !== "string" || restoredNotes.length > maxNotesLength) { skip(id, "NOTES_TOO_LONG", true); continue; }
    const before = structuredClone(latestAfter);
    const after = { ...structuredClone(before), notes: restoredNotes, version: vehicle.version + 1 };
    items.push({
      vehicleId: id, expectedVersion: vehicle.version, currentCycle: vehicle.currentCycle,
      currentNotes: vehicle.notes, restoredNotes, inboundAt: reentryAfter.inboundAt,
      reentryAuditId: reentry.id, reentryAuditSequence: String(reentry.recordSequence),
      latestAuditId: latest.id, latestAuditSequence: String(latest.recordSequence),
      before, after,
    });
  }
  return { candidateCount: candidates.length, items, skipped, counts, conflictCount: skipped.filter(item => item.conflict).length };
}
