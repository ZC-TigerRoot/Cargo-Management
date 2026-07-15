import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("server-only", () => ({}));

describe("local driver photo storage", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "cargo-uploads-"));
    process.env.UPLOAD_DIR = directory;
  });

  afterEach(async () => {
    delete process.env.UPLOAD_DIR;
    await rm(directory, { recursive: true, force: true });
  });

  it("stores an image as a relative object key and can remove it", async () => {
    const { readLocalUpload, removeLocalUpload, storeDriverPhoto } = await import("../src/lib/local-upload");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const file = new File([bytes], "现场照片.jpg", { type: "image/jpeg" });

    const stored = await storeDriverPhoto(file, new Date("2026-07-15T00:00:00.000Z"));

    expect(stored.objectKey).toMatch(/^driver\/2026\/07\/[\w-]+\.jpg$/);
    expect(path.isAbsolute(stored.objectKey)).toBe(false);
    expect(stored.mimeType).toBe("image/jpeg");
    expect(new Uint8Array(await readLocalUpload(stored.objectKey))).toEqual(bytes);

    await removeLocalUpload(stored.objectKey);
    await expect(readLocalUpload(stored.objectKey)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects files whose contents are not a supported image", async () => {
    const { storeDriverPhoto } = await import("../src/lib/local-upload");
    const file = new File(["not-an-image"], "fake.jpg", { type: "image/jpeg" });

    await expect(storeDriverPhoto(file)).rejects.toThrow("UNSUPPORTED_IMAGE");
  });
});
