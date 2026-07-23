type AttemptBucket = { failures: number; resetAt: number };

const WINDOW_MS = 15 * 60 * 1_000;
const MAX_IP_FAILURES = 20;
const MAX_ACCOUNT_FAILURES = 10;
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, AttemptBucket>();

function bucketKey(type: "ip" | "account", value: string) {
  return `${type}:${value}`;
}

function activeBucket(key: string, now: number) {
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (bucket) buckets.delete(key);
    return undefined;
  }
  return bucket;
}

function keys(ip: string | undefined, email: string) {
  return [ip ? bucketKey("ip", ip) : undefined, bucketKey("account", email)].filter((key): key is string => Boolean(key));
}

function limitFor(key: string) {
  return key.startsWith("ip:") ? MAX_IP_FAILURES : MAX_ACCOUNT_FAILURES;
}

export function loginRetryAfter(ip: string | undefined, email: string, now = Date.now()) {
  let retryAfter = 0;
  for (const key of keys(ip, email)) {
    const bucket = activeBucket(key, now);
    if (bucket && bucket.failures >= limitFor(key)) {
      retryAfter = Math.max(retryAfter, Math.ceil((bucket.resetAt - now) / 1_000));
    }
  }
  return retryAfter || undefined;
}

export function recordFailedLogin(ip: string | undefined, email: string, now = Date.now()) {
  if (buckets.size >= MAX_BUCKETS) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
    if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value!);
  }
  for (const key of keys(ip, email)) {
    const bucket = activeBucket(key, now);
    if (bucket) bucket.failures += 1;
    else buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
  }
}

export function clearAccountLoginFailures(email: string) {
  buckets.delete(bucketKey("account", email));
}
