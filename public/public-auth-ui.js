(() => {
  'use strict';

  const auth = window.dizychatAuthV2;
  const byId = (id) => document.getElementById(id);

  const createAccountBtn = byId('create-account-btn');
  const createAccountPanel = byId('create-account-panel');
  const registerUsername = byId('register-username');
  const registerPassword = byId('register-password');
  const registerPasswordConfirm = byId('register-password-confirm');
  const registerRecoveryEmail = byId('register-recovery-email');
  const registerSubmitBtn = byId('register-submit-btn');
  const registerStatus = byId('register-status');

  const forgotPasswordBtn = byId('forgot-password-btn');
  const forgotPasswordPanel = byId('forgot-password-panel');
  const resetRequestUsername = byId('reset-request-username');
  const resetRequestSubmitBtn = byId('reset-request-submit-btn');
  const resetRequestStatus = byId('reset-request-status');

  const recoveryEmailManage = byId('recovery-email-manage');
  const recoveryEmailUpdate = byId('recovery-email-update');
  const recoveryEmailUpdateBtn = byId('recovery-email-update-btn');
  const recoveryEmailStatus = byId('recovery-email-status');

  const accountUsername = byId('account-username');
  const accountPassword = byId('account-password');
  const registeredJoinBtn = byId('registered-join-btn');
  const lobbyAccountLogoutBtn = byId('lobby-account-logout-btn');

  const setStatus = (node, text, kind = '') => {
    if (!node) return;
    node.textContent = text;
    if (kind) node.dataset.kind = kind;
    else delete node.dataset.kind;
  };

  const setPanelOpen = (button, panel, open) => {
    if (!button || !panel) return;
    panel.hidden = !open;
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const closeAlternatePanel = (panel) => {
    if (panel === createAccountPanel) setPanelOpen(forgotPasswordBtn, forgotPasswordPanel, false);
    if (panel === forgotPasswordPanel) setPanelOpen(createAccountBtn, createAccountPanel, false);
  };

  const postJson = async (url, body, token = '') => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await window.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  };

  const registrationMessage = (code) => {
    switch (code) {
      case 'ACCOUNT_USERNAME_TAKEN':
        return 'That username is already registered.';
      case 'ACCOUNT_USERNAME_PROTECTED':
        return 'That username is protected and cannot be registered here.';
      case 'ACCOUNT_PASSWORD_INVALID':
        return 'Password must be between 8 and 256 characters.';
      case 'ACCOUNT_RECOVERY_EMAIL_INVALID':
        return 'Enter a valid recovery email or leave it blank.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Try again later.';
      default:
        return 'DizyChat could not create the account. Try again.';
    }
  };

  const syncRecoveryEmailPanel = () => {
    if (!recoveryEmailManage) return;
    const hasToken = Boolean(String(auth?.readToken?.() || '').trim());
    const signedIn = Boolean(lobbyAccountLogoutBtn && !lobbyAccountLogoutBtn.hidden && hasToken);
    recoveryEmailManage.hidden = !signedIn;
    if (!signedIn) {
      setStatus(recoveryEmailStatus, '');
      if (recoveryEmailUpdate) recoveryEmailUpdate.value = '';
    }
  };

  createAccountBtn?.addEventListener('click', () => {
    const open = Boolean(createAccountPanel?.hidden);
    closeAlternatePanel(createAccountPanel);
    setPanelOpen(createAccountBtn, createAccountPanel, open);
    if (open) {
      if (registerUsername && !registerUsername.value) registerUsername.value = accountUsername?.value || '';
      registerUsername?.focus();
    }
  });

  forgotPasswordBtn?.addEventListener('click', () => {
    const open = Boolean(forgotPasswordPanel?.hidden);
    closeAlternatePanel(forgotPasswordPanel);
    setPanelOpen(forgotPasswordBtn, forgotPasswordPanel, open);
    if (open) {
      if (resetRequestUsername && !resetRequestUsername.value) resetRequestUsername.value = accountUsername?.value || '';
      resetRequestUsername?.focus();
    }
  });

  registerSubmitBtn?.addEventListener('click', async () => {
    const username = String(registerUsername?.value || '').trim();
    const password = String(registerPassword?.value || '');
    const confirmation = String(registerPasswordConfirm?.value || '');
    const recoveryEmail = String(registerRecoveryEmail?.value || '').trim();

    if (!username) {
      setStatus(registerStatus, 'Choose a username.', 'error');
      registerUsername?.focus();
      return;
    }
    if (password.length < 8 || password.length > 256) {
      setStatus(registerStatus, 'Password must be between 8 and 256 characters.', 'error');
      registerPassword?.focus();
      return;
    }
    if (password !== confirmation) {
      setStatus(registerStatus, 'Passwords do not match.', 'error');
      registerPasswordConfirm?.focus();
      return;
    }
    if (recoveryEmail && registerRecoveryEmail && !registerRecoveryEmail.checkValidity()) {
      setStatus(registerStatus, 'Enter a valid recovery email or leave it blank.', 'error');
      registerRecoveryEmail.focus();
      return;
    }

    registerSubmitBtn.disabled = true;
    setStatus(registerStatus, 'Creating account…');
    try {
      const { response, payload } = await postJson('/api/auth/register', {
        username,
        password,
        recoveryEmail,
      });
      if (!response.ok) {
        setStatus(registerStatus, registrationMessage(payload?.code), 'error');
        return;
      }

      setStatus(registerStatus, 'Account created. Signing in…', 'success');
      if (accountUsername) accountUsername.value = username;
      if (accountPassword) accountPassword.value = password;
      if (registerPassword) registerPassword.value = '';
      if (registerPasswordConfirm) registerPasswordConfirm.value = '';
      setPanelOpen(createAccountBtn, createAccountPanel, false);
      registeredJoinBtn.click();
    } catch (_error) {
      setStatus(registerStatus, 'DizyChat could not create the account. Try again.', 'error');
    } finally {
      registerSubmitBtn.disabled = false;
    }
  });

  resetRequestSubmitBtn?.addEventListener('click', async () => {
    const username = String(resetRequestUsername?.value || '').trim();
    if (!username) {
      setStatus(resetRequestStatus, 'Enter your account username.', 'error');
      resetRequestUsername?.focus();
      return;
    }

    resetRequestSubmitBtn.disabled = true;
    setStatus(resetRequestStatus, 'Requesting reset link…');
    try {
      const { response, payload } = await postJson('/api/auth/password-reset/request', { username });
      if (response.status === 429 || payload?.code === 'RATE_LIMITED') {
        setStatus(resetRequestStatus, 'Too many reset requests. Try again later.', 'error');
        return;
      }
      if (!response.ok) {
        setStatus(resetRequestStatus, 'DizyChat could not request a reset link. Try again.', 'error');
        return;
      }
      setStatus(
        resetRequestStatus,
        'If an account with a recovery email exists, a password reset link has been sent.',
        'success'
      );
    } catch (_error) {
      setStatus(resetRequestStatus, 'DizyChat could not request a reset link. Try again.', 'error');
    } finally {
      resetRequestSubmitBtn.disabled = false;
    }
  });

  recoveryEmailUpdateBtn?.addEventListener('click', async () => {
    const recoveryEmail = String(recoveryEmailUpdate?.value || '').trim();
    const token = String(auth?.readToken?.() || '').trim();
    if (!token) {
      setStatus(recoveryEmailStatus, 'Sign in before changing your recovery email.', 'error');
      syncRecoveryEmailPanel();
      return;
    }
    if (!recoveryEmail || (recoveryEmailUpdate && !recoveryEmailUpdate.checkValidity())) {
      setStatus(recoveryEmailStatus, 'Enter a valid recovery email.', 'error');
      recoveryEmailUpdate?.focus();
      return;
    }

    recoveryEmailUpdateBtn.disabled = true;
    setStatus(recoveryEmailStatus, 'Saving recovery email…');
    try {
      const { response, payload } = await postJson('/api/auth/recovery-email', { recoveryEmail }, token);
      if (response.status === 401 || payload?.code === 'ACCOUNT_AUTH_REQUIRED') {
        setStatus(recoveryEmailStatus, 'Your account session has expired. Sign in again.', 'error');
        return;
      }
      if (payload?.code === 'ACCOUNT_RECOVERY_EMAIL_INVALID') {
        setStatus(recoveryEmailStatus, 'Enter a valid recovery email.', 'error');
        return;
      }
      if (!response.ok) {
        setStatus(recoveryEmailStatus, 'DizyChat could not save the recovery email. Try again.', 'error');
        return;
      }

      recoveryEmailUpdate.value = '';
      setStatus(recoveryEmailStatus, 'Recovery email saved.', 'success');
    } catch (_error) {
      setStatus(recoveryEmailStatus, 'DizyChat could not save the recovery email. Try again.', 'error');
    } finally {
      recoveryEmailUpdateBtn.disabled = false;
    }
  });

  for (const input of [registerUsername, registerPassword, registerPasswordConfirm, registerRecoveryEmail]) {
    input?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      registerSubmitBtn?.click();
    });
  }

  resetRequestUsername?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    resetRequestSubmitBtn?.click();
  });

  recoveryEmailUpdate?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    recoveryEmailUpdateBtn?.click();
  });

  if (lobbyAccountLogoutBtn && typeof MutationObserver === 'function') {
    new MutationObserver(syncRecoveryEmailPanel).observe(lobbyAccountLogoutBtn, {
      attributes: true,
      attributeFilter: ['hidden'],
    });
  }
  syncRecoveryEmailPanel();
})();
