type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= limit) return false;

  bucket.count += 1;
  return true;
}

export function checkAnalysisLimits(ip: string) {
  return (
    checkRateLimit({ key: `analysis:min:${ip}`, limit: 5, windowMs: 60_000 }) &&
    checkRateLimit({ key: `analysis:day:${ip}`, limit: 30, windowMs: 86_400_000 })
  );
}

export function checkScrapeLimits(ip: string) {
  return (
    checkRateLimit({ key: `scrape:min:${ip}`, limit: 3, windowMs: 60_000 }) &&
    checkRateLimit({ key: `scrape:day:${ip}`, limit: 30, windowMs: 86_400_000 })
  );
}
