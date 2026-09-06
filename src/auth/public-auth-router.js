'use strict';

const express = require('express');

const REGISTRATION_LIMIT = Object.freeze({ maxAttempts: 10, windowMs: 10 * 60 * 1000 });
const RESET_LIMIT = Object.freeze({ maxAttempts: 10, windowMs: 15 * 60 * 1000 });

const registrationStatusByCode = Object.freeze({
  ACCOUNT_USERNAME_REQUIRED: 400,
  ACCOUNT_PASSWORD_INVALID: 400,
  ACCOUNT_RECOVERY_EMAIL_INVALID: 400,
  ACCOUNT_USERNAME_TAKEN: 409,
  ACCOUNT_USERNAME_PROTECTED: 409,
});

const requestIp = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown');

const createRateLimiter = ({ maxAttempts, windowMs, now }) => {
  const entries = new Map();

  return (req, res, next) => {
    const timestamp = Number(now());
    const key = requestIp(req);
    let entry = entries.get(key);

    if (!entry || timestamp - entry.startedAt >= windowMs) {
      entry = { startedAt: timestamp, attempts: 0 };
      entries.set(key, entry);
    }

    if (entry.attempts >= maxAttempts) {
      return res.status(429).json({ ok: false, code: 'RATE_LIMITED' });
    }

    entry.attempts += 1;
    return next();
  };
};

const createPublicAuthRouter = ({
  accountService,
  passwordResetService,
  now = Date.now,
  logger = console,
} = {}) => {
  if (!accountService || typeof accountService.registerPublicUser !== 'function') {
    throw new TypeError('accountService.registerPublicUser is required');
  }
  if (
    !passwordResetService
    || typeof passwordResetService.requestReset !== 'function'
    || typeof passwordResetService.confirmReset !== 'function'
  ) {
    throw new TypeError('passwordResetService request/confirm methods are required');
  }
  if (typeof now !== 'function') throw new TypeError('public auth clock must be a function');

  const router = express.Router();
  router.use(express.json({ limit: '16kb' }));

  const registrationLimiter = createRateLimiter({ ...REGISTRATION_LIMIT, now });
  const resetRequestLimiter = createRateLimiter({ ...RESET_LIMIT, now });
  const resetConfirmLimiter = createRateLimiter({ ...RESET_LIMIT, now });

  router.post('/register', registrationLimiter, async (req, res) => {
    try {
      await accountService.registerPublicUser({
        username: req.body?.username,
        password: req.body?.password,
        recoveryEmail: req.body?.recoveryEmail,
      });
      return res.status(201).json({ ok: true });
    } catch (error) {
      const code = String(error?.code || '');
      const status = registrationStatusByCode[code];
      if (status) return res.status(status).json({ ok: false, code });
      logger?.warn?.('[Auth] public registration failed', { code: code || 'unexpected' });
      return res.status(500).json({ ok: false, code: 'AUTH_UNAVAILABLE' });
    }
  });

  router.post('/password-reset/request', resetRequestLimiter, async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    if (!username) {
      return res.status(400).json({ ok: false, code: 'PASSWORD_RESET_REQUEST_INVALID' });
    }

    try {
      await passwordResetService.requestReset(username);
    } catch (error) {
      logger?.warn?.('[Auth] password reset request unavailable', {
        code: String(error?.code || 'unexpected'),
      });
    }
    return res.json({ ok: true });
  });

  router.post('/password-reset/confirm', resetConfirmLimiter, async (req, res) => {
    try {
      await passwordResetService.confirmReset({
        token: req.body?.token,
        password: req.body?.password,
      });
      return res.json({ ok: true });
    } catch (error) {
      const code = String(error?.code || '');
      if (code === 'PASSWORD_RESET_INVALID' || code === 'ACCOUNT_PASSWORD_INVALID') {
        return res.status(400).json({ ok: false, code });
      }
      logger?.warn?.('[Auth] password reset confirmation failed', { code: code || 'unexpected' });
      return res.status(500).json({ ok: false, code: 'AUTH_UNAVAILABLE' });
    }
  });

  return router;
};

module.exports = {
  REGISTRATION_LIMIT,
  RESET_LIMIT,
  createPublicAuthRouter,
  createRateLimiter,
};
