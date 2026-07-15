import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_DRIVER_PHOTO_BYTES = 5_000_000;

type ImageType = { extension: string; mimeType: string };

export type StoredUpload = {
  objectKey: string;
  fileName: string;
  mimeType: string;
  size: number;
};

function uploadRoot() {
  const configured = process.env.UPLOAD_DIR;
  return configured
    ? path.resolve(/* turbopackIgnore: true */ configured)
    : path.join(/* turbopackIgnore: true */ process.cwd(), "data", "uploads");
}

function detectedImageType(bytes: Uint8Array): ImageType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: "jpg", mimeType: "image/jpeg" };
  }
  if (bytes.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", mimeType: "image/png" };
  }
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return { extension: "webp", mimeType: "image/webp" };
  }
  const gifHeader = bytes.length >= 6 ? Buffer.from(bytes.subarray(0, 6)).toString("ascii") : "";
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return { extension: "gif", mimeType: "image/gif" };
  }
}

function safeOriginalName(value: string) {
  const name = path.basename(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (name || "driver-photo").slice(0, 255);
}

function localPath(objectKey: string) {
  if (!objectKey || path.isAbsolute(objectKey) || objectKey.includes("\0")) throw new Error("INVALID_UPLOAD_PATH");
  const fullPath = path.resolve(/* turbopackIgnore: true */ uploadRoot(), ...objectKey.split("/"));
  const relative = path.relative(uploadRoot(), fullPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("INVALID_UPLOAD_PATH");
  return fullPath;
}

export async function storeDriverPhoto(file: File, now = new Date()): Promise<StoredUpload> {
  if (!file.size) throw new Error("EMPTY_IMAGE");
  if (file.size > MAX_DRIVER_PHOTO_BYTES) throw new Error("IMAGE_TOO_LARGE");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageType = detectedImageType(bytes);
  if (!imageType) throw new Error("UNSUPPORTED_IMAGE");

  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const objectKey = `driver/${year}/${month}/${randomUUID()}.${imageType.extension}`;
  const target = localPath(objectKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx", mode: 0o640 });

  return {
    objectKey,
    fileName: safeOriginalName(file.name),
    mimeType: imageType.mimeType,
    size: bytes.byteLength,
  };
}

export async function readLocalUpload(objectKey: string) {
  return readFile(localPath(objectKey));
}

export async function removeLocalUpload(objectKey: string) {
  try {
    await unlink(localPath(objectKey));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}
