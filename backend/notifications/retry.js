export const calculateRetryDelay = ({ attemptNumber, baseDelayMs, maxDelayMs, random = Math.random }) => {
  const exponent = Math.max(0, Math.min(30, Number(attemptNumber) - 1));
  const base = Math.min(maxDelayMs, baseDelayMs * (2 ** exponent));
  const jitter = Math.floor(random() * Math.max(1, Math.floor(base * 0.2)));
  return Math.min(maxDelayMs, base + jitter);
};

export const nextRetryAt = (options, now = new Date()) =>
  new Date(now.getTime() + calculateRetryDelay(options));
