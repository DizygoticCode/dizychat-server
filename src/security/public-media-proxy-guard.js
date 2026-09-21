'use strict';

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_STARTS = 60;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const clampPositiveInteger = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

const createPublicMediaAdmissionController = ({
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

  const maybeSweepExpiredStates = (timestamp) => {
    if (timestamp - lastSweepAt < sweepIntervalMs) return;
    for (const key of states.keys()) cleanState(key, timestamp);
    lastSweepAt = timestamp;
  };

  const acquire = (key) => {
    const normalizedKey = String(key || 'unknown').trim() || 'unknown';
    const timestamp = Number(now());
    maybeSweepExpiredStates(timestamp);
    const state = cleanState(normalizedKey, timestamp);

    if (state.active >= maxConcurrent) {
      return {
        ok: false,
        code: 'PUBLIC_MEDIA_CONCURRENCY_LIMIT',
        retryAfterMs: 1000,
      };
    }

    if (state.starts.length >= maxStarts) {
      return {
        ok: false,
        code: 'PUBLIC_MEDIA_RATE_LIMIT',
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

const readPublicMediaProxyLimits = (env = process.env) => ({
  maxStarts: clampPositiveInteger(
    env.PUBLIC_MEDIA_MAX_STARTS_PER_WINDOW,
    DEFAULT_MAX_STARTS,
    10,
    600,
  ),
  maxConcurrent: clampPositiveInteger(
    env.PUBLIC_MEDIA_MAX_CONCURRENT_PER_IP,
    DEFAULT_MAX_CONCURRENT,
    1,
    20,
  ),
  windowMs: clampPositiveInteger(
    env.PUBLIC_MEDIA_RATE_WINDOW_SECONDS,
    DEFAULT_WINDOW_MS / 1000,
    10,
    60 * 60,
  ) * 1000,
  fetchTimeoutMs: clampPositiveInteger(
    env.PUBLIC_MEDIA_FETCH_TIMEOUT_MS,
    DEFAULT_FETCH_TIMEOUT_MS,
    1000,
    30_000,
  ),
});

const responseTooLarge = () => {
  const error = new Error('Upstream media response exceeded the size limit.');
  error.code = 'UPSTREAM_RESPONSE_TOO_LARGE';
  return error;
};

const readBoundedBody = async (response, maxBytes) => {
  const declared = Number(response?.headers?.get?.('content-length') || 0);
  if (declared && declared > maxBytes) throw responseTooLarge();

  const body = response?.body;
  if (body && typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of body) {
      const buffer = Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) throw responseTooLarge();
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw responseTooLarge();
  return buffer;
};

const createBoundedJsonFetcher = ({
  fetchImpl,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new Error('fetchImpl is required');

  return async (url, options = {}) => {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await fetchImpl(url, controller
        ? { ...options, signal: controller.signal }
        : options);
      const buffer = await readBoundedBody(response, maxBytes);
      const data = JSON.parse(buffer.toString('utf8'));
      return { response, data };
    } catch (error) {
      if (controller?.signal.aborted) {
        const timeoutError = new Error('Upstream media request timed out.');
        timeoutError.code = 'UPSTREAM_TIMEOUT';
        throw timeoutError;
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
};

module.exports = {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MAX_STARTS,
  DEFAULT_WINDOW_MS,
  createBoundedJsonFetcher,
  createPublicMediaAdmissionController,
  readBoundedBody,
  readPublicMediaProxyLimits,
};
