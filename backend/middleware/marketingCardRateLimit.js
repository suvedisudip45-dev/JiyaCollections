const windows = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const LIMITS = { link: 10, scan: 20, redeem: 20 };

const cleanupExpired = (now) => {
  for (const [key, entry] of windows) {
    if (entry.resetAt <= now) windows.delete(key);
  }
};

const marketingCardRateLimit = (operation) => (req, res, next) => {
  const limit = LIMITS[operation] || 20;
  const now = Date.now();
  cleanupExpired(now);
  const identity = req.userId || req.ip || "anonymous";
  const key = `marketing-card:${operation}:${identity}`;
  const current = windows.get(key) || { count: 0, resetAt: now + WINDOW_MS };

  if (current.count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ success: false, message: "Too many marketing card requests. Please try again later.", code: "MARKETING_CARD_RATE_LIMITED" });
  }

  current.count += 1;
  windows.set(key, current);
  return next();
};

export default marketingCardRateLimit;
