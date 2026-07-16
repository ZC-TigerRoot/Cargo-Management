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

function requestOriginCandidates(req: OriginRequest, configuredOrigin?: string) {
  const hosts = [
    firstHeaderValue(req.headers.get("x-forwarded-host")),
    req.headers.get("host")?.trim() || undefined,
  ];
  const protocols = [
    firstHeaderValue(req.headers.get("x-forwarded-proto")),
    req.nextUrl.protocol,
  ];
  const origins = new Set<string>();

  if (configuredOrigin) {
    const origin = normalizedOrigin(configuredOrigin);
    if (origin) origins.add(origin);
  }
  for (const host of hosts) {
    for (const protocol of protocols) {
      if (!host || !protocol) continue;
      const origin = normalizedOrigin(`${protocol.replace(/:$/, "")}://${host}`);
      if (origin) origins.add(origin);
    }
  }
  return origins;
}

export function isSameOriginRequest(req: OriginRequest, configuredOrigin = process.env.APP_URL) {
  const originHeader = req.headers.get("origin");
  if (!originHeader) return true;

  const origin = normalizedOrigin(originHeader);
  if (!origin) return false;

  if (requestOriginCandidates(req, configuredOrigin).has(origin)) return true;

  // Reverse proxies sometimes replace Host/protocol without forwarding the
  // public values. Browsers still provide this forbidden request header for a
  // relative same-origin fetch, while a cross-site form/fetch cannot set it.
  return req.headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin";
}
