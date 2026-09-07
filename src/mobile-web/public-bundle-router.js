'use strict';

const express = require('express');
const path = require('node:path');
const {
  buildMobileWebManifest,
  isSafeBundlePath,
  resolveInside,
} = require('./bundle-manifest');

const createMobileWebBundleRouter = ({ publicDir } = {}) => {
  if (typeof publicDir !== 'string' || !publicDir.trim()) {
    throw new TypeError('publicDir is required');
  }

  const router = express.Router();
  let manifestPromise = null;
  const getManifest = () => {
    if (!manifestPromise) {
      manifestPromise = buildMobileWebManifest({ publicDir }).catch((error) => {
        manifestPromise = null;
        throw error;
      });
    }
    return manifestPromise;
  };

  router.get('/manifest', async (_req, res) => {
    try {
      const manifest = await getManifest();
      res.set('Cache-Control', 'no-store');
      res.json(manifest);
    } catch (_error) {
      res.status(503).json({ ok: false, code: 'MOBILE_WEB_BUNDLE_UNAVAILABLE' });
    }
  });

  router.get('/assets/*', async (req, res) => {
    let relativePath = String(req.params?.[0] || '').trim();
    try {
      relativePath = decodeURIComponent(relativePath);
    } catch (_error) {
      return res.status(400).end();
    }

    if (!isSafeBundlePath(relativePath)) return res.status(400).end();

    try {
      const manifest = await getManifest();
      const entry = manifest.files.find((file) => file.path === relativePath);
      if (!entry) return res.status(404).end();

      const absolutePath = resolveInside(publicDir, relativePath);
      res.set('Cache-Control', 'no-cache, must-revalidate');
      return res.sendFile(path.basename(absolutePath), { root: path.dirname(absolutePath) });
    } catch (_error) {
      return res.status(503).end();
    }
  });

  return router;
};

module.exports = {
  createMobileWebBundleRouter,
};
