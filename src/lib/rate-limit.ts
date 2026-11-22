/**
 * Einfache Begrenzung im Speicher (je Server-Prozess), wie bei der Anmeldung.
 * take(key) = true, solange im Zeitfenster noch Versuche frei sind.
 */
declare global {
  // eslint-disable-next-line no-var
  var __rateLimits: Map<string, { count: number; resetAt: number }> | undefined;
}
const buckets = globalThis.__rateLimits ?? (globalThis.__rateLimits = new Map());

export function takeRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return true;
  }
  if (entry.count >= max) return false;
  entry.count += 1;
  return true;
}

/** Nur für Tests. */
export function resetRateLimits() {
  buckets.clear();
}
