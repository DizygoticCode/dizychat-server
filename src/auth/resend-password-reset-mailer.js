'use strict';

const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
const DEFAULT_MAIL_FROM = 'DizyChat <no-reply@dizychat.com>';
const DEFAULT_MAIL_REPLY_TO = 'dizychat@proton.me';

const createMailError = (message) => {
  const error = new Error(message || 'password reset mail delivery failed');
  error.code = 'PASSWORD_RESET_MAIL_FAILED';
  return error;
};

const escapeHtml = (value) => String(value || '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');

const createResendPasswordResetMailer = ({
  fetchImpl,
  apiKey,
  from = DEFAULT_MAIL_FROM,
  replyTo = DEFAULT_MAIL_REPLY_TO,
  publicBaseUrl,
} = {}) => {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetch implementation is required');
  }

  const normalizedApiKey = String(apiKey || '').trim();
  if (!normalizedApiKey) throw new TypeError('Resend API key is required');

  const normalizedFrom = String(from || '').trim();
  if (!normalizedFrom) throw new TypeError('mail sender is required');

  const normalizedReplyTo = String(replyTo || '').trim();
  if (!normalizedReplyTo) throw new TypeError('mail Reply-To is required');

  const normalizedBaseUrl = normalizeBaseUrl(publicBaseUrl);
  if (!/^https?:\/\//i.test(normalizedBaseUrl)) {
    throw new TypeError('public base URL is required');
  }

  const sendPasswordReset = async ({ to, username, token } = {}) => {
    const recipient = String(to || '').trim();
    const accountName = String(username || '').trim();
    const publicToken = String(token || '').trim();
    if (!recipient || !accountName || !publicToken) {
      throw createMailError('password reset mail input is invalid');
    }

    const resetUrl = `${normalizedBaseUrl}/reset-password.html?token=${encodeURIComponent(publicToken)}`;
    const safeUsername = escapeHtml(accountName);
    const safeResetUrl = escapeHtml(resetUrl);
    const text = [
      `Hi ${accountName},`,
      '',
      'A password reset was requested for your DizyChat account.',
      `Reset your password: ${resetUrl}`,
      '',
      'This link expires in 30 minutes. If you did not request this, you can ignore this email.',
    ].join('\n');
    const html = [
      `<p>Hi ${safeUsername},</p>`,
      '<p>A password reset was requested for your DizyChat account.</p>',
      `<p><a href="${safeResetUrl}">Reset your DizyChat password</a></p>`,
      '<p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>',
    ].join('');

    let response;
    try {
      response = await fetchImpl(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${normalizedApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: normalizedFrom,
          to: [recipient],
          reply_to: normalizedReplyTo,
          subject: 'Reset your DizyChat password',
          text,
          html,
        }),
      });
    } catch (_error) {
      throw createMailError();
    }

    if (!response?.ok) {
      throw createMailError(`password reset mail delivery failed (${Number(response?.status || 0) || 'unknown'})`);
    }
  };

  return { sendPasswordReset };
};

module.exports = {
  DEFAULT_MAIL_FROM,
  DEFAULT_MAIL_REPLY_TO,
  RESEND_EMAILS_URL,
  createResendPasswordResetMailer,
};
