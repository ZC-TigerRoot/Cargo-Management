import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { signImportPreview, verifyImportPreview, workbookSnapshot } from "../src/lib/import-preview";
import type { CheckedImportRow } from "../src/lib/excel-import";

const previousSecret = process.env.AUTH_SECRET;
const payload = { type: "domestic", vin: "VIN-001", warehouseTimezone: "Asia/Shanghai" } as CheckedImportRow["payload"];
const rows: CheckedImportRow[] = [{
  row: 2,
  vin: "VIN-001",
  errors: [],
  payload,
  destinationBatchKey: '["DOMESTIC","PO-001"]',
  destinationBatchSnapshot: "batch-state",
  existing: { id: "vehicle-1", version: 3 },
}];

describe("Excel 预校验令牌", () => {
  beforeAll(() => {
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
  });

  afterAll(() => {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  });

  it("绑定预校验车辆快照和当前用户", async () => {
    const token = await signImportPreview(rows, "user-1");

    await expect(verifyImportPreview(token, "user-1")).resolves.toBe(workbookSnapshot(rows));
    await expect(verifyImportPreview(token, "user-2")).resolves.toBeUndefined();
  });

  it("车辆版本、身份或共享批次变化时生成不同快照", () => {
    expect(workbookSnapshot([{ ...rows[0], existing: { ...rows[0].existing!, version: 4 } }])).not.toBe(workbookSnapshot(rows));
    expect(workbookSnapshot([{ ...rows[0], existing: { ...rows[0].existing!, id: "vehicle-2" } }])).not.toBe(workbookSnapshot(rows));
    expect(workbookSnapshot([{ ...rows[0], destinationBatchSnapshot: "changed-batch" }])).not.toBe(workbookSnapshot(rows));
  });
});
