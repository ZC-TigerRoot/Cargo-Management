import { describe, expect, it } from "vitest";
import { appendReentryNotes, MAX_REENTRY_NOTES_LENGTH, MAX_VEHICLE_NOTES_LENGTH } from "../src/lib/vehicle-notes";
import { vehiclePayload, vehicleReentryInput, vehicleUpdateInput } from "../src/lib/validators";

describe("按入库轮次累计备注", () => {
  it("原备注逐字保留，新备注去除首尾空白并标注轮次和入库日期", () => {
    expect(appendReentryNotes("  第一轮原文\n第二行  ", " \n 新备注\n新备注第二行 \n", 2, "2026-10-21"))
      .toBe("  第一轮原文\n第二行  \n\n【第 2 轮入库 · 2026-10-21】\n新备注\n新备注第二行");
  });

  it.each([undefined, null, ""])("没有旧备注（%j）时只写本轮备注段", previous => {
    expect(appendReentryNotes(previous, "新备注", 2, "2026-10-21"))
      .toBe("【第 2 轮入库 · 2026-10-21】\n新备注");
  });

  it.each([undefined, "", " \n \t "])("空白新备注（%j）保持旧值及其空值类型", notes => {
    expect(appendReentryNotes(" 原文 \n", notes, 2, "2026-10-21")).toBe(" 原文 \n");
    expect(appendReentryNotes(null, notes, 2, "2026-10-21")).toBeNull();
    expect(appendReentryNotes(undefined, notes, 2, "2026-10-21")).toBeUndefined();
  });

  it("第三轮继续追加，相同内容在不同轮次仍分别保留", () => {
    const second = appendReentryNotes("相同备注", "相同备注", 2, "2026-10-20");
    const third = appendReentryNotes(second, "相同备注", 3, "2026-10-21");

    expect(third).toBe("相同备注\n\n【第 2 轮入库 · 2026-10-20】\n相同备注\n\n【第 3 轮入库 · 2026-10-21】\n相同备注");
  });

  it("拼接不截断原文或新备注，由写入前的累计长度校验拒绝超限", () => {
    const previous = "原".repeat(MAX_VEHICLE_NOTES_LENGTH);
    const fragment = "新".repeat(MAX_REENTRY_NOTES_LENGTH);
    const combined = appendReentryNotes(previous, fragment, 2, "2026-10-21");

    expect(combined).toBe(`${previous}\n\n【第 2 轮入库 · 2026-10-21】\n${fragment}`);
  });
});

describe("单次和累计备注的长度校验", () => {
  const payload = { type: "domestic", warehouseTimezone: "Asia/Shanghai" };

  it("普通编辑允许保存超过 5000 字符、最多 32767 字符的累计备注", () => {
    const notes = "备".repeat(MAX_VEHICLE_NOTES_LENGTH);

    expect(vehicleUpdateInput.parse({ ...payload, id: "v1", version: 1, notes }).notes).toBe(notes);
    expect(vehiclePayload.safeParse({ ...payload, notes: `${notes}备` }).success).toBe(false);
  });

  it("累计备注上限不扩大提货明细的 5000 字符限制", () => {
    expect(vehiclePayload.safeParse({ ...payload, pickupDetails: "明".repeat(5_001) }).success).toBe(false);
  });

  it("再次入库单次备注仍最多 5000 字符", () => {
    const reentry = { vehicles: [{ id: "v1", version: 1, notes: "备".repeat(MAX_REENTRY_NOTES_LENGTH) }], inboundAt: "2020-01-01", reason: "返库" };

    expect(vehicleReentryInput.parse(reentry).vehicles[0].notes).toHaveLength(MAX_REENTRY_NOTES_LENGTH);
    expect(vehicleReentryInput.safeParse({ ...reentry, vehicles: [{ ...reentry.vehicles[0], notes: "备".repeat(MAX_REENTRY_NOTES_LENGTH + 1) }] }).success).toBe(false);
  });
});
