import { describe, expect, it } from "vitest";
import { appendReentryNotes, MAX_VEHICLE_NOTES_LENGTH } from "../src/lib/vehicle-notes";
import {
  planReentryNotesRecovery, REENTRY_NOTES_RECOVERY_REASON,
  type RecoveryAudit, type RecoveryVehicle,
} from "../src/lib/reentry-notes-recovery";

type State = { vehicle: RecoveryVehicle; audits: RecoveryAudit[] };

function fixture(id = "v1"): State {
  const old = { id, version: 4, currentCycle: 1, notes: "第一轮旧备注", inboundAt: "2026-10-01", status: "已完成", customer: "客人", extra: { untouched: true } };
  const reentered = { ...old, version: 5, currentCycle: 2, inboundAt: "2026-10-20", status: "在库" };
  const current = { ...reentered, version: 6, notes: "目前有效的新备注" };
  return {
    vehicle: { id, version: 6, currentCycle: 2, notes: current.notes, inboundAt: current.inboundAt },
    audits: [
      { id: `${id}-reentry`, entityType: "Vehicle", entityId: id, action: "VEHICLE_REENTERED", recordSequence: BigInt(100), before: old, after: reentered, reason: "返库" },
      { id: `${id}-updated`, entityType: "Vehicle", entityId: id, action: "VEHICLE_UPDATED", recordSequence: BigInt(101), before: structuredClone(reentered), after: current, reason: null },
    ],
  };
}

function before(state: State, index: number) { return state.audits[index].before as Record<string, unknown>; }
function after(state: State, index: number) { return state.audits[index].after as Record<string, unknown>; }
function setCurrentNotes(state: State, notes: string | null) {
  state.vehicle.notes = notes;
  after(state, 1).notes = notes;
}
function plan(state = fixture()) {
  return planReentryNotesRecovery([state.vehicle], state.audits, MAX_VEHICLE_NOTES_LENGTH, appendReentryNotes);
}

describe("历史返库备注恢复计划", () => {
  it("仅合并返库前旧备注和当前有效备注，快照只改变备注与版本", () => {
    const state = fixture();
    const original = structuredClone(state);
    const result = plan(state);
    const notes = "第一轮旧备注\n\n【第 2 轮入库 · 2026-10-20】\n目前有效的新备注";

    expect(result).toMatchObject({ candidateCount: 1, conflictCount: 0, skipped: [] });
    expect(result.items).toEqual([expect.objectContaining({
      vehicleId: "v1", expectedVersion: 6, currentCycle: 2, currentNotes: "目前有效的新备注", restoredNotes: notes,
      inboundAt: "2026-10-20", reentryAuditId: "v1-reentry", reentryAuditSequence: "100", latestAuditId: "v1-updated", latestAuditSequence: "101",
      before: after(state, 1), after: { ...after(state, 1), notes, version: 7 },
    })]);
    expect(state).toEqual(original);
    (result.items[0].before.extra as Record<string, unknown>).untouched = false;
    expect((after(state, 1).extra as Record<string, unknown>).untouched).toBe(true);
    expect((result.items[0].after.extra as Record<string, unknown>).untouched).toBe(true);
  });

  it("按每辆车的审计关联，输入乱序和大整数序号不会串车", () => {
    const first = fixture("v1");
    const second = fixture("v2");
    setCurrentNotes(second, "第二辆目前备注");
    first.audits[0].recordSequence = "9007199254740993";
    first.audits[1].recordSequence = "9007199254740994";
    const result = planReentryNotesRecovery([second.vehicle, first.vehicle], [second.audits[1], first.audits[1], second.audits[0], first.audits[0]], MAX_VEHICLE_NOTES_LENGTH, appendReentryNotes);

    expect(result.items.map(item => ({ id: item.vehicleId, notes: item.currentNotes, sequence: item.latestAuditSequence }))).toEqual([
      { id: "v1", notes: "目前有效的新备注", sequence: "9007199254740994" },
      { id: "v2", notes: "第二辆目前备注", sequence: "101" },
    ]);
  });

  const invalid: [string, string, (state: State) => void][] = [
    ["当前版本已变化", "CURRENT_AUDIT_MISMATCH", state => { state.vehicle.version++; }],
    ["当前备注已变化", "CURRENT_AUDIT_MISMATCH", state => { state.vehicle.notes = "并发修改"; }],
    ["当前入库日期已变化", "CURRENT_AUDIT_MISMATCH", state => { state.vehicle.inboundAt = "2026-10-21"; }],
    ["最新快照属于其他车辆", "CURRENT_AUDIT_MISMATCH", state => { after(state, 1).id = "other"; }],
    ["返库不属于第一至第二轮", "REENTRY_CYCLE_MISMATCH", state => { before(state, 0).currentCycle = 2; }],
    ["当前已进入第三轮", "REENTRY_CYCLE_MISMATCH", state => { state.vehicle.currentCycle = 3; before(state, 1).currentCycle = 3; after(state, 1).currentCycle = 3; }],
    ["旧入库快照车辆不匹配", "AUDIT_SNAPSHOT_IDENTITY_MISMATCH", state => { before(state, 0).id = "other"; }],
    ["最新修改的版本链不连续", "AUDIT_SNAPSHOT_IDENTITY_MISMATCH", state => { before(state, 1).version = 4; }],
    ["返库版本没有加一", "REENTRY_VERSION_CHAIN_MISMATCH", state => { before(state, 0).version = 3; }],
    ["返库版本晚于后续修改", "REENTRY_VERSION_CHAIN_MISMATCH", state => { before(state, 0).version = 6; after(state, 0).version = 7; }],
    ["返库时备注已经变化", "REENTRY_NOTES_NOT_UNCHANGED", state => { after(state, 0).notes = "入库时已写入其他内容"; }],
    ["返库前没有非空旧备注", "REENTRY_NOTES_NOT_UNCHANGED", state => { before(state, 0).notes = " "; after(state, 0).notes = " "; }],
    ["最新修改不是从旧备注覆盖而来", "LATEST_EDIT_DID_NOT_REPLACE_OLD_NOTES", state => { before(state, 1).notes = "另一份后来内容"; }],
    ["当前没有新备注", "CURRENT_NOTES_EMPTY", state => { setCurrentNotes(state, null); }],
    ["快照缺失", "AUDIT_SNAPSHOT_MISSING", state => { state.audits[1].before = null; }],
    ["入库日期不是有效日历日期", "INVALID_REENTRY_DATE", state => { state.vehicle.inboundAt = "2026-02-30"; after(state, 1).inboundAt = "2026-02-30"; after(state, 0).inboundAt = "2026-02-30"; }],
    ["入库日期已被后续更正", "INVALID_REENTRY_DATE", state => { state.vehicle.inboundAt = "2026-10-21"; after(state, 1).inboundAt = "2026-10-21"; }],
    ["审计序号重复", "INVALID_AUDIT_SEQUENCE", state => { state.audits[1].recordSequence = BigInt(100); }],
    ["审计序号精度已丢失", "INVALID_AUDIT_SEQUENCE", state => { state.audits[1].recordSequence = Number.MAX_SAFE_INTEGER + 1; }],
    ["存在多轮返库历史", "MULTIPLE_REENTRY_AUDITS", state => { state.audits.unshift({ ...state.audits[0], id: "older-reentry", recordSequence: BigInt(99) }); }],
  ];
  it.each(invalid)("%s时报告冲突，不生成可写计划", (_label, code, mutate) => {
    const state = fixture();
    mutate(state);
    const result = plan(state);
    expect(result.items).toEqual([]);
    expect(result.skipped).toEqual([{ vehicleId: "v1", code, conflict: true }]);
    expect(result.conflictCount).toBe(1);
  });

  it("最新操作不是普通修改时只报告跳过", () => {
    const state = fixture();
    state.audits[1].action = "PICKUP_SIGNED";
    expect(plan(state)).toMatchObject({ items: [], skipped: [{ code: "LATEST_ACTION_NOT_VEHICLE_UPDATED" }], conflictCount: 0 });
  });

  it("修改早于返库时不能拿旧修改恢复当前轮次", () => {
    const state = fixture();
    state.audits[1].recordSequence = BigInt(99);
    expect(plan(state)).toMatchObject({ items: [], skipped: [{ code: "LATEST_ACTION_NOT_VEHICLE_UPDATED" }] });
  });

  it.each(["NOTES_UNCHANGED", "OLD_NOTES_ALREADY_PRESENT", "CYCLE_NOTES_ALREADY_PRESENT", "ALREADY_RECOVERED"])("%s时幂等跳过，不重复追加", code => {
    const state = fixture();
    if (code === "NOTES_UNCHANGED") setCurrentNotes(state, "第一轮旧备注");
    if (code === "OLD_NOTES_ALREADY_PRESENT") setCurrentNotes(state, "第一轮旧备注 + 已经合并的内容");
    if (code === "CYCLE_NOTES_ALREADY_PRESENT") setCurrentNotes(state, "【第 2 轮入库 · 2026-10-20】\n已有本轮备注");
    if (code === "ALREADY_RECOVERED") state.audits[1].reason = REENTRY_NOTES_RECOVERY_REASON;
    expect(plan(state)).toMatchObject({ items: [], skipped: [{ code, conflict: false }], conflictCount: 0 });
  });

  it("恢复审计已存在时，即便之后备注被人工整理也不重新恢复", () => {
    const state = fixture();
    state.audits.push({ ...state.audits[1], id: "recovery-audit", recordSequence: BigInt(102), reason: REENTRY_NOTES_RECOVERY_REASON });
    state.audits.push({ ...state.audits[1], id: "later-manual-edit", recordSequence: BigInt(103) });
    expect(plan(state)).toMatchObject({ items: [], skipped: [{ code: "ALREADY_RECOVERED" }] });
  });

  it("累计长度恰好 32767 可恢复，超过一个字符则不截断并拒绝", () => {
    const state = fixture();
    const suffix = "\n\n【第 2 轮入库 · 2026-10-20】\n目前有效的新备注";
    const oldNotes = "旧".repeat(MAX_VEHICLE_NOTES_LENGTH - suffix.length);
    before(state, 0).notes = oldNotes;
    after(state, 0).notes = oldNotes;
    before(state, 1).notes = oldNotes;
    expect(plan(state).items[0].restoredNotes).toHaveLength(MAX_VEHICLE_NOTES_LENGTH);
    before(state, 0).notes = `${oldNotes}旧`;
    after(state, 0).notes = `${oldNotes}旧`;
    before(state, 1).notes = `${oldNotes}旧`;
    expect(plan(state)).toMatchObject({ items: [], skipped: [{ code: "NOTES_TOO_LONG", conflict: true }] });
  });

  it("已删除车辆和重复当前行均不能恢复", () => {
    const state = fixture();
    expect(planReentryNotesRecovery([], state.audits, MAX_VEHICLE_NOTES_LENGTH, appendReentryNotes)).toMatchObject({ items: [], skipped: [{ code: "CURRENT_VEHICLE_MISSING", conflict: true }] });
    expect(planReentryNotesRecovery([state.vehicle, state.vehicle], state.audits, MAX_VEHICLE_NOTES_LENGTH, appendReentryNotes)).toMatchObject({ items: [], skipped: [{ code: "DUPLICATE_CURRENT_VEHICLE", conflict: true }] });
  });

  it("不存在返库审计的车辆和非车辆审计不生成恢复计划", () => {
    const state = fixture();
    state.audits[0].entityType = "BusinessBatch";
    expect(plan(state)).toMatchObject({ items: [], skipped: [{ code: "NO_REENTRY_AUDIT" }] });
  });
});
