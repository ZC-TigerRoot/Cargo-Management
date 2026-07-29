import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => {
  class AuthorizationError extends Error {
    constructor(public status: 401 | 403, message: string) {
      super(message);
    }
  }
  return {
    AuthorizationError,
    assertSameOrigin: vi.fn(),
    requestIp: vi.fn(() => "203.0.113.8"),
    requirePayloadWarehouseInScope: vi.fn(),
    requireUser: vi.fn(),
    requireVehicleInScope: vi.fn(),
  };
});

const excel = vi.hoisted(() => {
  class ImportWorkbookError extends Error {
    constructor(public code: string, message: string, public status: number) {
      super(message);
    }
  }
  return {
    ImportWorkbookError,
    assertImportFile: vi.fn(),
    checkWorkbook: vi.fn(),
  };
});

const repository = vi.hoisted(() => {
  class VersionConflictError extends Error {
    constructor() {
      super("车辆记录已被其他用户更新，请刷新后重试");
    }
  }
  return {
    VersionConflictError,
    businessBatchSnapshot: vi.fn((batch: { snapshot?: string } | null | undefined) => batch?.snapshot ?? null),
    createVehicle: vi.fn(),
    updateVehicleFromImport: vi.fn(),
  };
});

const preview = vi.hoisted(() => ({
  verifyImportPreview: vi.fn(),
  workbookSnapshot: vi.fn(),
}));

vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/domain", () => ({ can: () => true }));
vi.mock("@/lib/excel-import", () => ({
  ...excel,
  MAX_IMPORT_FILE_SIZE: 10 * 1024 * 1024,
  publicCheckResult: ({ rows, ...result }: { rows: unknown[]; [key: string]: unknown }) => {
    void rows;
    return result;
  },
}));
vi.mock("@/lib/import-preview", () => preview);
vi.mock("@/lib/vehicle-repository", () => repository);

import { POST } from "../src/app/api/v1/import/route";

const newPayload = {
  type: "domestic" as const,
  vin: "VIN-NEW",
  warehouse: "测试仓",
  warehouseLocation: "上海",
  warehouseTimezone: "Asia/Shanghai" as const,
};
const updatePayload = {
  type: "domestic" as const,
  vin: "VIN-OLD",
  outboundBoeNo: "BOE-NEW",
  warehouseTimezone: "Asia/Shanghai" as const,
};

function checkedWorkbook() {
  return {
    fileName: "vehicles.xlsx",
    businessType: "国内仓" as const,
    totalRows: 2,
    validRows: 2,
    invalidRows: 0,
    createRows: 1,
    updateRows: 1,
    missingHeaders: [],
    ignoredColumns: ["库存天数"],
    errors: [],
    rows: [
      { row: 2, vin: "VIN-OLD", errors: [], payload: updatePayload, destinationBatchSnapshot: null, existing: { id: "vehicle-1", version: 4 } },
      { row: 3, vin: "VIN-NEW", errors: [], payload: newPayload, destinationBatchSnapshot: null },
    ],
  };
}

function request() {
  const form = new FormData();
  form.set("file", "workbook");
  form.set("previewToken", "signed-preview");
  return {
    headers: new Headers({ "content-length": "1024" }),
    formData: vi.fn().mockResolvedValue(form),
  } as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireUser.mockResolvedValue({ id: "user-1", name: "管理员", roleName: "admin", customerId: null, warehouseScopes: [] });
  excel.checkWorkbook.mockResolvedValue(checkedWorkbook());
  preview.verifyImportPreview.mockResolvedValue("preview-state");
  preview.workbookSnapshot.mockReturnValue("preview-state");
  repository.createVehicle.mockResolvedValue({ batch: null });
  repository.updateVehicleFromImport.mockResolvedValue({ batch: null });
});

describe("Excel 导入写入", () => {
  it("同一文件分别新增和增量更新车辆", async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(auth.requireVehicleInScope).toHaveBeenCalledWith(expect.objectContaining({ id: "user-1" }), "vehicle-1");
    expect(repository.updateVehicleFromImport).toHaveBeenCalledWith("vehicle-1", 4, updatePayload, { actorId: "user-1", ip: "203.0.113.8" }, null);
    expect(repository.createVehicle).toHaveBeenCalledWith(newPayload, expect.stringMatching(/^excel:/), { actorId: "user-1", ip: "203.0.113.8" }, null);
    expect(body.data).toMatchObject({ importedRows: 2, createdRows: 1, updatedRows: 1, failedRows: 0 });
  });

  it("逐行报告 Excel 更新期间发生的版本冲突", async () => {
    const checked = checkedWorkbook();
    const workbook = { ...checked, rows: [checked.rows[0]], totalRows: 1, validRows: 1, createRows: 0 };
    excel.checkWorkbook.mockResolvedValueOnce(workbook);
    repository.updateVehicleFromImport.mockRejectedValueOnce(new repository.VersionConflictError());

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.data).toMatchObject({ importedRows: 0, createdRows: 0, updatedRows: 0, failedRows: 1 });
    expect(body.data.errors[0]).toMatchObject({ row: 2, vin: "VIN-OLD", errors: ["车辆记录已被其他用户更新，请刷新后重试"] });
  });

  it("同批次前一行更新主数据后使用最新快照处理后续行", async () => {
    const checked = checkedWorkbook();
    const batchKey = '["DOMESTIC","PO-001"]';
    const secondPayload = { ...updatePayload, vin: "VIN-SECOND", referenceNo: "PO-001" };
    const workbook = {
      ...checked,
      createRows: 0,
      updateRows: 2,
      rows: [
        { ...checked.rows[0], destinationBatchKey: batchKey, destinationBatchSnapshot: "before-batch" },
        { row: 3, vin: "VIN-SECOND", errors: [], payload: secondPayload, destinationBatchKey: batchKey, destinationBatchSnapshot: "before-batch", existing: { id: "vehicle-2", version: 2 } },
      ],
    };
    excel.checkWorkbook.mockResolvedValueOnce(workbook);
    repository.updateVehicleFromImport
      .mockResolvedValueOnce({ batch: { snapshot: "after-batch" } })
      .mockResolvedValueOnce({ batch: { snapshot: "after-batch" } });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(repository.updateVehicleFromImport).toHaveBeenNthCalledWith(1, "vehicle-1", 4, updatePayload, expect.any(Object), "before-batch");
    expect(repository.updateVehicleFromImport).toHaveBeenNthCalledWith(2, "vehicle-2", 2, secondPayload, expect.any(Object), "after-batch");
  });

  it("拒绝覆盖预校验后已变化的车辆", async () => {
    preview.workbookSnapshot.mockReturnValueOnce("changed-state");

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(repository.updateVehicleFromImport).not.toHaveBeenCalled();
    expect(body.error).toBe("VERSION_CONFLICT");
    expect(body).not.toHaveProperty("data");
  });
});
