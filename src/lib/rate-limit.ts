type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Rate limit in-memory por processo (bom o suficiente para single-instance /
 * mitigação básica). Em multi-instância, preferir Redis/Upstash.
 */
export function takeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (current.count >= limit) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }
  current.count += 1;
  return { ok: true };
}

/** Test helper. */
export function resetRateLimitForTests() {
  buckets.clear();
}
