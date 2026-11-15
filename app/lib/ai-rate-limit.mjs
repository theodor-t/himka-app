const requestsByKey = new Map();

export function consumeRateLimit(key, limit = 12, windowMs = 60_000, now = Date.now()) {
  const normalizedKey = String(key || "");
  if (!normalizedKey) return { allowed: false, retryAfterSeconds: windowMs / 1000 };

  const cutoff = now - windowMs;
  const requests = (requestsByKey.get(normalizedKey) || []).filter((time) => time > cutoff);
  if (requests.length >= limit) {
    requestsByKey.set(normalizedKey, requests);
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((requests[0] + windowMs - now) / 1000)),
    };
  }
  requests.push(now);
  requestsByKey.set(normalizedKey, requests);

  if (requestsByKey.size > 1000) {
    for (const [storedKey, storedRequests] of requestsByKey) {
      if (!storedRequests.some((time) => time > cutoff)) requestsByKey.delete(storedKey);
    }
  }
  return { allowed: true, retryAfterSeconds: 0 };
}
