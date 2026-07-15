type OriginRequest = {
  headers: { get(name: string): string | null };
  nextUrl: { protocol: string };
};

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim() || undefined;
}

function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function isSameOriginRequest(req: OriginRequest) {
  const originHeader = req.headers.get("origin");
  if (!originHeader) return true;

  const host = firstHeaderValue(req.headers.get("x-forwarded-host")) ?? req.headers.get("host")?.trim();
  const protocol = firstHeaderValue(req.headers.get("x-forwarded-proto")) ?? req.nextUrl.protocol;
  if (!host || !protocol) return false;

  const requestOrigin = normalizedOrigin(`${protocol.replace(/:$/, "")}://${host}`);
  return requestOrigin !== undefined && normalizedOrigin(originHeader) === requestOrigin;
}
