(() => {
  'use strict';

  const SESSION_KEY = 'dizychat-account-session-v2';

  const readToken = () => {
    try {
      return String(sessionStorage.getItem(SESSION_KEY) || '').trim();
    } catch {
      return '';
    }
  };

  const writeToken = (token) => {
    try {
      const value = String(token || '').trim();
      if (value) sessionStorage.setItem(SESSION_KEY, value);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore tab-storage failures */
    }
  };

  const clearToken = () => writeToken('');

  const roleCanModerate = (role) => role === 'owner' || role === 'admin';

  window.dizychatAuthV2 = Object.freeze({
    SESSION_KEY,
    readToken,
    writeToken,
    clearToken,
    roleCanModerate,
  });
})();
