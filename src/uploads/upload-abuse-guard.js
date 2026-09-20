'use strict';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_STARTS = 20;
const DEFAULT_MAX_CONCURRENT = 3;

const clampPositiveInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const createUploadAdmissionController = ({
  windowMs = DEFAULT_WINDOW_MS,
  maxStarts = DEFAULT_MAX_STARTS,
  maxConcurrent = DEFAULT_MAX_CONCURRENT,
  now = Date.now,
} = {}) => {
  const states = new Map();
  const sweepIntervalMs = Math.min(windowMs, 60_000);
  let lastSweepAt = Number(now());

  const cleanState = (key, timestamp = Number(now())) => {
    const existing = states.get(key) || { active: 0, starts: [] };
    const starts = existing.starts.filter((startedAt) => startedAt + windowMs > timestamp);
    const state = { active: Math.max(0, existing.active || 0), starts };
    if (!state.active && !state.starts.length) states.delete(key);
    else states.set(key, state);
    return state;
  };

  const sweepExpiredStates = (timestamp = Number(now())) => {
    for (const key of states.keys()) cleanState(key, timestamp);
    lastSweepAt = timestamp;
  };

  const maybeSweepExpiredStates = (timestamp) => {
    if (timestamp - lastSweepAt >= sweepIntervalMs) sweepExpiredStates(timestamp);
  };

  const acquire = (key) => {
    const normalizedKey = String(key || 'unknown').trim() || 'unknown';
    const timestamp = Number(now());
    maybeSweepExpiredStates(timestamp);
    const state = cleanState(normalizedKey, timestamp);

    if (state.active >= maxConcurrent) {
      return {
        ok: false,
        code: 'UPLOAD_CONCURRENCY_LIMIT',
        retryAfterMs: 1000,
      };
    }

    if (state.starts.length >= maxStarts) {
      return {
        ok: false,
        code: 'UPLOAD_RATE_LIMIT',
        retryAfterMs: Math.max(1000, (state.starts[0] + windowMs) - timestamp),
      };
    }

    state.active += 1;
    state.starts.push(timestamp);
    states.set(normalizedKey, state);

    let released = false;
    return {
      ok: true,
      release() {
        if (released) return;
        released = true;
        const current = cleanState(normalizedKey, Number(now()));
        current.active = Math.max(0, current.active - 1);
        if (!current.active && !current.starts.length) states.delete(normalizedKey);
        else states.set(normalizedKey, current);
      },
    };
  };

  return { acquire, getTrackedClientCount: () => states.size };
};

const readUploadAbuseLimits = (env = process.env) => ({
  maxStarts: clampPositiveInteger(
    env.UPLOAD_MAX_STARTS_PER_WINDOW,
    DEFAULT_MAX_STARTS,
    5,
    500,
  ),
  maxConcurrent: clampPositiveInteger(
    env.UPLOAD_MAX_CONCURRENT_PER_IP,
    DEFAULT_MAX_CONCURRENT,
    1,
    20,
  ),
  windowMs: clampPositiveInteger(
    env.UPLOAD_RATE_WINDOW_SECONDS,
    DEFAULT_WINDOW_MS / 1000,
    60,
    24 * 60 * 60,
  ) * 1000,
});

module.exports = {
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_STARTS,
  DEFAULT_WINDOW_MS,
  createUploadAdmissionController,
  readUploadAbuseLimits,
};
