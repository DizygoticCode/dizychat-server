'use strict';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_STARTS = 12;

const createJamSessionRateLimiter = ({
  windowMs = DEFAULT_WINDOW_MS,
  maxStarts = DEFAULT_MAX_STARTS,
  now = Date.now,
} = {}) => {
  const states = new Map();
  const sweepIntervalMs = Math.min(windowMs, 60_000);
  let lastSweepAt = Number(now());

  const normaliseKey = (key) => String(key || 'unknown').trim() || 'unknown';

  const cleanKey = (key, timestamp = Number(now())) => {
    const existing = states.get(key) || [];
    const starts = existing.filter((startedAt) => startedAt + windowMs > timestamp);
    if (starts.length) states.set(key, starts);
    else states.delete(key);
    return starts;
  };

  const maybeSweepExpiredStates = (timestamp) => {
    if (timestamp - lastSweepAt < sweepIntervalMs) return;
    for (const key of states.keys()) cleanKey(key, timestamp);
    lastSweepAt = timestamp;
  };

  const check = (key) => {
    const normalizedKey = normaliseKey(key);
    const timestamp = Number(now());
    maybeSweepExpiredStates(timestamp);

    const starts = cleanKey(normalizedKey, timestamp);
    if (starts.length >= maxStarts) {
      states.set(normalizedKey, starts);
      return false;
    }

    starts.push(timestamp);
    states.set(normalizedKey, starts);
    return true;
  };

  const clear = (key) => {
    states.delete(normaliseKey(key));
  };

  return {
    check,
    clear,
    getTrackedKeyCount: () => states.size,
  };
};

module.exports = {
  DEFAULT_MAX_STARTS,
  DEFAULT_WINDOW_MS,
  createJamSessionRateLimiter,
};
