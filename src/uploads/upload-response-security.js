'use strict';

const path = require('node:path');

const ACTIVE_UPLOAD_EXTENSIONS = new Set([
  '.cjs',
  '.htm',
  '.html',
  '.js',
  '.mjs',
  '.svg',
  '.svgz',
  '.xhtml',
  '.xml',
  '.xsl',
  '.xslt',
]);

const isActiveUploadDocument = (filePath) => {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return ACTIVE_UPLOAD_EXTENSIONS.has(ext);
};

const applyUploadResponseHeaders = (res, filePath) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (isActiveUploadDocument(filePath)) {
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    return;
  }

  res.setHeader('Content-Disposition', 'inline');
};

module.exports = {
  ACTIVE_UPLOAD_EXTENSIONS,
  applyUploadResponseHeaders,
  isActiveUploadDocument,
};
