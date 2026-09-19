'use strict';
const { createHash } = require('node:crypto');

const tokenFingerprint = (value) => {
  const token = String(value || '').trim();
  return token ? createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 12) : '';
};

// Diagnostics must never affect registration or delivery. Callers supply only allowlisted fields.
const trace = (logger, event, fields) => {
  try { logger?.info?.(`[PushTrace] ${event}`, fields); } catch { /* best effort */ }
};

module.exports = { tokenFingerprint, trace };
