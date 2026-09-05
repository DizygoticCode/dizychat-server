(() => {
  'use strict';

  const SESSION_KEY = 'dizychat-account-session-v2';
  let secureOperations = Promise.resolve();
  const enqueueSecureOperation = (operation) => {
    const result = secureOperations.then(operation);
    secureOperations = result.catch(() => {});
    return result;
  };

  const readToken = () => {
    try {
      return String(window.sessionStorage.getItem(SESSION_KEY) || '').trim();
    } catch {
      return '';
    }
  };

  const writeToken = (token) => {
    try {
      const value = String(token || '').trim();
      if (value) window.sessionStorage.setItem(SESSION_KEY, value);
      else window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore volatile tab-storage failures */
    }
  };

  const clearToken = () => writeToken('');

  const isNativeSessionRuntime = () => {
    try {
      return Boolean(window.Capacitor?.isNativePlatform?.());
    } catch {
      return false;
    }
  };

  const secureSessionPlugin = () => {
    if (!isNativeSessionRuntime()) return null;
    return window.Capacitor?.Plugins?.SecureSession || null;
  };

  const restoreNativeSession = async () => {
    if (!isNativeSessionRuntime()) return readToken();
    const plugin = secureSessionPlugin();
    if (typeof plugin?.readToken !== 'function') {
      throw new Error('SecureSession plugin unavailable');
    }
    const result = await enqueueSecureOperation(() => plugin.readToken());
    const token = String(result?.token || '').trim();
    writeToken(token);
    return token;
  };

  const persistToken = async (token) => {
    const value = String(token || '').trim();
    writeToken(value);
    if (!isNativeSessionRuntime()) return value;

    const plugin = secureSessionPlugin();
    if (!value) {
      if (typeof plugin?.clearToken !== 'function') {
        throw new Error('SecureSession plugin unavailable');
      }
      await enqueueSecureOperation(() => plugin.clearToken());
      return '';
    }

    if (typeof plugin?.writeToken !== 'function') {
      throw new Error('SecureSession plugin unavailable');
    }
    await enqueueSecureOperation(() => plugin.writeToken({ token: value }));
    return value;
  };

  const clearPersistentToken = async () => {
    writeToken('');
    if (!isNativeSessionRuntime()) return;
    const plugin = secureSessionPlugin();
    if (typeof plugin?.clearToken !== 'function') {
      throw new Error('SecureSession plugin unavailable');
    }
    await enqueueSecureOperation(() => plugin.clearToken());
  };

  const roleCanModerate = (role) => role === 'owner' || role === 'admin';

  window.dizychatAuthV2 = Object.freeze({
    SESSION_KEY,
    readToken,
    writeToken,
    clearToken,
    isNativeSessionRuntime,
    restoreNativeSession,
    persistToken,
    clearPersistentToken,
    roleCanModerate,
  });
})();
