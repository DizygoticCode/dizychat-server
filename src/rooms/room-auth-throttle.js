'use strict';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 8;
const DEFAULT_LOCK_MS = 5 * 60 * 1000;
const DEFAULT_MIN_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 4000;

const createRoomAuthThrottle = ({
  windowMs = DEFAULT_WINDOW_MS,
  maxFailures = DEFAULT_MAX_FAILURES,
  lockMs = DEFAULT_LOCK_MS,
  minRetryDelayMs = DEFAULT_MIN_RETRY_DELAY_MS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  now = Date.now,
} = {}) => {
  const states = new Map();

  const readState = (key) => {
    const timestamp = Number(now());
    const existing = states.get(key);
    if (!existing) {
      return { count: 0, windowStart: timestamp, lockUntil: 0, lastFailedAt: 0 };
    }

    if (existing.lockUntil > timestamp) return existing;

    if (existing.windowStart + windowMs <= timestamp) {
      states.delete(key);
      return { count: 0, windowStart: timestamp, lockUntil: 0, lastFailedAt: 0 };
    }

    return existing;
  };

  const retryDelayMs = (state) => {
    const failures = Math.max(0, Number(state?.count || 0));
    if (!failures) return 0;
    const exponent = Math.max(0, failures - 1);
    return Math.min(minRetryDelayMs * (2 ** exponent), maxRetryDelayMs);
  };

  const check = (key) => {
    const state = readState(key);
    const timestamp = Number(now());

    if (state.lockUntil > timestamp) {
      return { blocked: true, retryAfterMs: state.lockUntil - timestamp };
    }

    const delay = retryDelayMs(state);
    if (state.lastFailedAt && state.lastFailedAt + delay > timestamp) {
      return {
        blocked: true,
        retryAfterMs: (state.lastFailedAt + delay) - timestamp,
      };
    }

    return { blocked: false, retryAfterMs: 0 };
  };

  const registerFailure = (key) => {
    const timestamp = Number(now());
    const state = readState(key);
    const count = state.count + 1;
    const lockUntil = count >= maxFailures ? timestamp + lockMs : 0;
    const updated = {
      count,
      windowStart: state.windowStart || timestamp,
      lockUntil,
      lastFailedAt: timestamp,
    };
    states.set(key, updated);
    return {
      ...updated,
      retryAfterMs: lockUntil > timestamp
        ? lockUntil - timestamp
        : retryDelayMs(updated),
    };
  };

  const clear = (key) => states.delete(key);

  return {
    check,
    clear,
    registerFailure,
  };
};

module.exports = {
  DEFAULT_LOCK_MS,
  DEFAULT_MAX_FAILURES,
  DEFAULT_MAX_RETRY_DELAY_MS,
  DEFAULT_MIN_RETRY_DELAY_MS,
  DEFAULT_WINDOW_MS,
  createRoomAuthThrottle,
};
