'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const MOBILE_WEB_SCHEMA_VERSION = 1;
const MOBILE_WEB_ENTRY_PATH = 'login.html';
const MOBILE_WEB_CORE_PATHS = Object.freeze([
  'app-config.js',
  'auth-v2-client.js',
  'chat.css',
  'chat.js',
  'emojis.json',
  'index.html',
  'login.html',
  'logo-light.svg',
  'logo.svg',
  'mobile-bootstrap.js',
  'mobile-push-runtime.js',
  'mobile-runtime.js',
  'mobile-toolbar.css',
  'public-auth-ui.js',
  'public-auth.css',
].sort());

const sha256Hex = (value) =>
  crypto.createHash('sha256').update(value).digest('hex');

const decodePath = (value) => {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return '';
  }
};

const isSafeBundlePath = (value) => {
  if (typeof value !== 'string' || !value || value.startsWith('/') || value.includes('\\')) return false;
  if (!/^[A-Za-z0-9._%\-/]+$/.test(value)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) return false;

  const decoded = decodePath(value);
  if (!decoded || decoded.startsWith('/') || decoded.includes('\\')) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(decoded)) return false;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded)) return false;

  const parts = decoded.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) return false;
  return true;
};

const createBundleVersion = (files = []) => {
  const canonical = [...files]
    .map((file) => ({
      path: String(file?.path || ''),
      size: Number(file?.size || 0),
      sha256: String(file?.sha256 || ''),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return sha256Hex(Buffer.from(JSON.stringify(canonical), 'utf8'));
};

const resolveInside = (root, relativePath) => {
  if (!isSafeBundlePath(relativePath)) {
    throw new Error(`Unsafe mobile web bundle path: ${relativePath}`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Mobile web bundle path escaped public root: ${relativePath}`);
  }
  return resolved;
};

const buildMobileWebManifest = async ({ publicDir } = {}) => {
  if (typeof publicDir !== 'string' || !publicDir.trim()) {
    throw new TypeError('publicDir is required');
  }

  const files = [];
  for (const relativePath of MOBILE_WEB_CORE_PATHS) {
    const absolutePath = resolveInside(publicDir, relativePath);
    const bytes = await fs.readFile(absolutePath);
    files.push({
      path: relativePath,
      size: bytes.length,
      sha256: sha256Hex(bytes),
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  if (!files.some((file) => file.path === MOBILE_WEB_ENTRY_PATH)) {
    throw new Error(`Mobile web entry ${MOBILE_WEB_ENTRY_PATH} is missing`);
  }

  return {
    schemaVersion: MOBILE_WEB_SCHEMA_VERSION,
    entryPath: MOBILE_WEB_ENTRY_PATH,
    bundleVersion: createBundleVersion(files),
    files,
  };
};

module.exports = {
  MOBILE_WEB_CORE_PATHS,
  MOBILE_WEB_ENTRY_PATH,
  MOBILE_WEB_SCHEMA_VERSION,
  buildMobileWebManifest,
  createBundleVersion,
  isSafeBundlePath,
  resolveInside,
  sha256Hex,
};
