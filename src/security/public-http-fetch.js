'use strict';

const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 4;
const MAX_URL_LENGTH = 4096;

const blockedHostnameSuffixes = [
  '.localhost',
  '.local',
  '.internal',
  '.lan',
  '.home',
  '.home.arpa',
];

const ipv4ToNumber = (address) => {
  const parts = String(address || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (
    ((parts[0] << 24) >>> 0)
    + (parts[1] << 16)
    + (parts[2] << 8)
    + parts[3]
  ) >>> 0;
};

const ipv4InCidr = (address, base, prefix) => {
  const value = ipv4ToNumber(address);
  const baseValue = ipv4ToNumber(base);
  if (value === null || baseValue === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (baseValue & mask);
};

const BLOCKED_IPV4_CIDRS = Object.freeze([
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]);

const isPublicIpAddress = (rawAddress) => {
  const address = String(rawAddress || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  const family = net.isIP(address);

  if (family === 4) {
    return !BLOCKED_IPV4_CIDRS.some(([base, prefix]) => ipv4InCidr(address, base, prefix));
  }

  if (family === 6) {
    const lower = address.toLowerCase();
    const firstHextet = Number.parseInt(lower.split(':')[0] || '0', 16);

    // Keep link previews on globally routable IPv6 only. This excludes loopback,
    // link-local, unique-local, multicast and IPv4-mapped addresses.
    if (!Number.isFinite(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) {
      return false;
    }

    // Documentation, Teredo and 6to4 are unnecessary for a public preview fetch
    // and can encode special-purpose destinations.
    if (lower.startsWith('2001:db8:') || lower === '2001:db8::') return false;
    if (lower.startsWith('2001:0000:') || lower.startsWith('2001:0:')) return false;
    if (lower.startsWith('2002:')) return false;

    return true;
  }

  return false;
};

const isBlockedHostname = (hostname) => {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');

  if (!normalized) return true;
  if (normalized === 'localhost') return true;
  if (!normalized.includes('.') && net.isIP(normalized) === 0) return true;
  return blockedHostnameSuffixes.some((suffix) => normalized.endsWith(suffix));
};

const createPreviewError = (code, message) => {
  const error = new Error(message || code);
  error.code = code;
  return error;
};

const normalizePublicPreviewUrl = (value, baseUrl = '') => {
  let raw = String(value || '').trim();
  if (!raw || raw.length > MAX_URL_LENGTH) {
    throw createPreviewError('LINK_PREVIEW_URL_INVALID', 'Link preview URL is invalid.');
  }

  if (baseUrl) {
    try {
      raw = new URL(raw, baseUrl).toString();
    } catch {
      throw createPreviewError('LINK_PREVIEW_URL_INVALID', 'Link preview URL is invalid.');
    }
  } else if (!/^https?:\/\//i.test(raw)) {
    raw = `http://${raw}`;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw createPreviewError('LINK_PREVIEW_URL_INVALID', 'Link preview URL is invalid.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw createPreviewError('LINK_PREVIEW_PROTOCOL_BLOCKED', 'Link preview protocol is not allowed.');
  }
  if (parsed.username || parsed.password) {
    throw createPreviewError('LINK_PREVIEW_CREDENTIALS_BLOCKED', 'Credential-bearing preview URLs are not allowed.');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw createPreviewError('LINK_PREVIEW_HOST_BLOCKED', 'Local or private link preview hosts are not allowed.');
  }

  const allowedPort = parsed.protocol === 'https:' ? '443' : '80';
  if (parsed.port && parsed.port !== allowedPort) {
    throw createPreviewError('LINK_PREVIEW_PORT_BLOCKED', 'Non-standard link preview ports are not allowed.');
  }

  parsed.hash = '';
  return parsed;
};

const normalizeLookupResults = (result) => {
  if (Array.isArray(result)) return result;
  if (result && typeof result === 'object' && result.address) return [result];
  return [];
};

const assertPublicHost = async (urlObject, lookupImpl = dns.promises.lookup) => {
  const hostname = urlObject.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    if (!isPublicIpAddress(hostname)) {
      throw createPreviewError('LINK_PREVIEW_ADDRESS_BLOCKED', 'Private or special-purpose preview address is not allowed.');
    }
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  let results;
  try {
    results = normalizeLookupResults(await lookupImpl(hostname, { all: true, verbatim: true }));
  } catch {
    throw createPreviewError('LINK_PREVIEW_DNS_FAILED', 'Link preview hostname could not be resolved.');
  }

  if (!results.length || results.some((entry) => !isPublicIpAddress(entry.address))) {
    throw createPreviewError('LINK_PREVIEW_ADDRESS_BLOCKED', 'Private or special-purpose preview address is not allowed.');
  }

  return results;
};

const createValidatingLookup = (lookupCallback = dns.lookup) =>
  (hostname, options, callback) => {
    const family = typeof options === 'number' ? options : Number(options?.family || 0);
    const lookupOptions = { all: true, verbatim: true };
    if (family === 4 || family === 6) lookupOptions.family = family;

    lookupCallback(hostname, lookupOptions, (error, rawResults) => {
      if (error) {
        callback(error);
        return;
      }

      const results = normalizeLookupResults(rawResults);
      if (!results.length || results.some((entry) => !isPublicIpAddress(entry.address))) {
        callback(createPreviewError(
          'LINK_PREVIEW_ADDRESS_BLOCKED',
          'Private or special-purpose preview address is not allowed.',
        ));
        return;
      }

      const selected = results[0];
      callback(null, selected.address, selected.family || net.isIP(selected.address));
    });
  };

const createPublicAgent = (urlObject, lookupCallback) => {
  const options = { lookup: createValidatingLookup(lookupCallback) };
  return urlObject.protocol === 'https:' ? new https.Agent(options) : new http.Agent(options);
};

const readBodyWithLimit = async (response, maxBytes) => {
  const declared = Number(response?.headers?.get?.('content-length') || 0);
  if (declared && declared > maxBytes) {
    throw createPreviewError('LINK_PREVIEW_TOO_LARGE', 'Link preview response is too large.');
  }

  if (response?.body && typeof response.body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        throw createPreviewError('LINK_PREVIEW_TOO_LARGE', 'Link preview response is too large.');
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  if (typeof response?.arrayBuffer === 'function') {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw createPreviewError('LINK_PREVIEW_TOO_LARGE', 'Link preview response is too large.');
    }
    return buffer.toString('utf8');
  }

  const text = typeof response?.text === 'function' ? await response.text() : '';
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw createPreviewError('LINK_PREVIEW_TOO_LARGE', 'Link preview response is too large.');
  }
  return text;
};

const fetchPublicHtmlPreview = async ({
  fetchImpl,
  url,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  lookupImpl = dns.promises.lookup,
  lookupCallback = dns.lookup,
} = {}) => {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');

  let current = normalizePublicPreviewUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();

  try {
    for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
      await assertPublicHost(current, lookupImpl);

      const response = await fetchImpl(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        agent: createPublicAgent(current, lookupCallback),
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (response?.status >= 300 && response?.status < 400) {
        const location = response.headers?.get?.('location');
        if (!location) {
          throw createPreviewError('LINK_PREVIEW_REDIRECT_INVALID', 'Link preview redirect is missing a location.');
        }
        if (redirects === maxRedirects) {
          throw createPreviewError('LINK_PREVIEW_REDIRECT_LIMIT', 'Link preview returned too many redirects.');
        }
        current = normalizePublicPreviewUrl(location, current.toString());
        continue;
      }

      const contentType = String(response?.headers?.get?.('content-type') || '');
      if (!/text\/html/i.test(contentType)) {
        return {
          url: current.toString(),
          contentType,
          html: '',
          isHtml: false,
          status: Number(response?.status || 0),
        };
      }

      const html = await readBodyWithLimit(response, maxBytes);
      return {
        url: current.toString(),
        contentType,
        html,
        isHtml: true,
        status: Number(response?.status || 0),
      };
    }

    throw createPreviewError('LINK_PREVIEW_REDIRECT_LIMIT', 'Link preview returned too many redirects.');
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw createPreviewError('LINK_PREVIEW_TIMEOUT', 'Link preview request timed out.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  assertPublicHost,
  fetchPublicHtmlPreview,
  isBlockedHostname,
  isPublicIpAddress,
  normalizePublicPreviewUrl,
  readBodyWithLimit,
};
