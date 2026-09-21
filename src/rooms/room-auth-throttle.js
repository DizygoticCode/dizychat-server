'use strict';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 8;
const DEFAULT_LOCK_MS = 5 * 60 * 1000;
const DEFAULT_MIN_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 4000;
const DEFAULT_MAX_TRACKED_KEYS = 5000;

const createRoomAuthThrottle = ({
  windowMs = DEFAULT_WINDOW_MS,
  maxFailures = DEFAULT_MAX_FAILURES,
  lockMs = DEFAULT_LOCK_MS,
  minRetryDelayMs = DEFAULT_MIN_RETRY_DELAY_MS,
  maxRetryDelayMs = DEFAULT_MAX_RETRY_DELAY_MS,
  maxTrackedKeys = DEFAULT_MAX_TRACKED_KEYS,
  now = Date.now,
} = {}) => {
  const states = new Map();
  const sweepIntervalMs = Math.min(windowMs, lockMs, 60_000);
  let lastSweepAt = Number(now());

  const isExpired = (state, timestamp) =>
    Boolean(state) &&
    !(state.lockUntil > timestamp) &&
    state.windowStart + windowMs <= timestamp;

  const maybeSweepExpiredStates = (timestamp) => {
    if (timestamp - lastSweepAt < sweepIntervalMs) return;
    for (const [key, state] of states.entries()) {
      if (isExpired(state, timestamp)) states.delete(key);
    }
    lastSweepAt = timestamp;
  };

  const emptyState = (timestamp) => ({
    count: 0,
    windowStart: timestamp,
    lockUntil: 0,
    lastFailedAt: 0,
  });

  const capacityState = (timestamp) => ({
    count: maxFailures,
    windowStart: timestamp,
    lockUntil: timestamp + sweepIntervalMs,
    lastFailedAt: timestamp,
    capacityBlocked: true,
  });

  const readState = (key) => {
    const timestamp = Number(now());
    maybeSweepExpiredStates(timestamp);

    const existing = states.get(key);
    if (!existing) {
      if (states.size >= maxTrackedKeys) return capacityState(timestamp);
      return emptyState(timestamp);
    }

    if (existing.lockUntil > timestamp) return existing;

    if (isExpired(existing, timestamp)) {
      states.delete(key);
      return emptyState(timestamp);
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

    if (state.capacityBlocked) {
      return { blocked: true, retryAfterMs: Math.max(1000, state.lockUntil - timestamp), reason: 'capacity' };
    }

    if (state.lockUntil > timestamp) {
      return { blocked: true, retryAfterMs: state.lockUntil - timestamp, reason: 'lock' };
    }

    const delay = retryDelayMs(state);
    if (state.lastFailedAt && state.lastFailedAt + delay > timestamp) {
      return {
        blocked: true,
        retryAfterMs: (state.lastFailedAt + delay) - timestamp,
        reason: 'delay',
      };
    }

    return { blocked: false, retryAfterMs: 0 };
  };

  const registerFailure = (key) => {
    const timestamp = Number(now());
    const state = readState(key);
    if (state.capacityBlocked) {
      return {
        ...state,
        retryAfterMs: Math.max(1000, state.lockUntil - timestamp),
      };
    }

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
    getTrackedKeyCount: () => states.size,
  };
};

module.exports = {
  DEFAULT_LOCK_MS,
  DEFAULT_MAX_FAILURES,
  DEFAULT_MAX_RETRY_DELAY_MS,
  DEFAULT_MIN_RETRY_DELAY_MS,
  DEFAULT_MAX_TRACKED_KEYS,
  DEFAULT_WINDOW_MS,
  createRoomAuthThrottle,
};
