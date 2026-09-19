import { appError } from '../utils/errors.js';

/**
 * Fixed-window in-process rate limiter.
 *
 * Sized for a single-owner deployment: it protects the login route and the
 * reasoning provider from runaway loops without adding infrastructure.
 */
export function createRateLimiter({ windowMs = 60000, max = 600, now = () => Date.now(), key } = {}) {
  const buckets = new Map();

  const resolveKey = key ?? ((req) => req.ip ?? 'unknown');

  return (req, res, next) => {
    const bucketKey = resolveKey(req);
    const timestamp = now();
    const bucket = buckets.get(bucketKey);

    if (!bucket || timestamp - bucket.startedAt >= windowMs) {
      buckets.set(bucketKey, { startedAt: timestamp, count: 1 });
      return next();
    }

    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfterSeconds = Math.ceil((bucket.startedAt + windowMs - timestamp) / 1000);
      res.set('retry-after', String(Math.max(retryAfterSeconds, 1)));
      return next(appError('RATE_LIMITED', 'Too many requests. Try again shortly.'));
    }

    // Opportunistic cleanup keeps the map bounded without a timer.
    if (buckets.size > 5000) {
      for (const [candidate, entry] of buckets) {
        if (timestamp - entry.startedAt >= windowMs) buckets.delete(candidate);
      }
    }

    return next();
  };
}
