import "server-only";

import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { CheckedImportRow } from "./excel-import";

const PREVIEW_AGE = "30m";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  return new TextEncoder().encode(value);
}

export function workbookSnapshot(rows: readonly CheckedImportRow[]) {
  const state = rows.map(row => [
    row.row,
    row.vin ?? null,
    row.existing ? [row.existing.id, row.existing.version] : null,
    row.destinationBatchKey ?? null,
    row.destinationBatchSnapshot ?? null,
  ]);
  return createHash("sha256").update(JSON.stringify(state)).digest("base64url");
}

export function signImportPreview(rows: readonly CheckedImportRow[], userId: string) {
  return new SignJWT({ snapshot: workbookSnapshot(rows) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("cargo-management")
    .setAudience("cargo-import-preview")
    .setIssuedAt()
    .setExpirationTime(PREVIEW_AGE)
    .sign(secret());
}

export async function verifyImportPreview(token: string, userId: string) {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: "cargo-management",
      audience: "cargo-import-preview",
      subject: userId,
    });
    return typeof payload.snapshot === "string" ? payload.snapshot : undefined;
  } catch {
    return undefined;
  }
}
