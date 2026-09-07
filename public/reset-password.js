(() => {
  'use strict';

  const form = document.getElementById('reset-password-form');
  const passwordInput = document.getElementById('reset-password');
  const confirmInput = document.getElementById('reset-password-confirm');
  const submitButton = document.getElementById('reset-password-submit');
  const status = document.getElementById('reset-password-status');

  const runtime = window.dizychatMobileRuntime;
  const backend = runtime?.resolveBackendOrigin?.(window, window.dizychatConfig || {}) || '';
  runtime?.installBackendFetchRouting?.(window, backend);

  const token = String(new URLSearchParams(window.location.search).get('token') || '').trim();

  const setStatus = (text, kind = '') => {
    if (!status) return;
    status.textContent = text;
    if (kind) status.dataset.kind = kind;
    else delete status.dataset.kind;
  };

  if (!token) {
    setStatus('This password reset link is invalid or incomplete. Request a new reset link from DizyChat.', 'error');
    if (submitButton) submitButton.disabled = true;
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!token) return;

    const password = String(passwordInput?.value || '');
    const confirmation = String(confirmInput?.value || '');
    if (password.length < 8 || password.length > 256) {
      setStatus('Password must be between 8 and 256 characters.', 'error');
      passwordInput?.focus();
      return;
    }
    if (password !== confirmation) {
      setStatus('Passwords do not match.', 'error');
      confirmInput?.focus();
      return;
    }

    submitButton.disabled = true;
    setStatus('Resetting password…');
    try {
      const response = await window.fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload?.code === 'PASSWORD_RESET_INVALID') {
          setStatus('This reset link is invalid, expired, or already used. Request a new reset link.', 'error');
          return;
        }
        if (payload?.code === 'ACCOUNT_PASSWORD_INVALID') {
          setStatus('Password must be between 8 and 256 characters.', 'error');
          return;
        }
        if (payload?.code === 'RATE_LIMITED') {
          setStatus('Too many reset attempts. Try again later.', 'error');
          return;
        }
        setStatus('DizyChat could not reset the password. Try again.', 'error');
        return;
      }

      passwordInput.value = '';
      confirmInput.value = '';
      setStatus('Password changed. Existing signed-in sessions have been revoked; you can now sign in with the new password.', 'success');
      submitButton.hidden = true;
    } catch (_error) {
      setStatus('DizyChat could not reset the password. Try again.', 'error');
    } finally {
      if (!submitButton.hidden) submitButton.disabled = false;
    }
  });
})();
