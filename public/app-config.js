const dizychatNativeSocketUrl = (() => {
  try {
    return window.Capacitor?.isNativePlatform?.() ? "https://dizychat.com" : "";
  } catch (_err) {
    return "";
  }
})();

window.dizychatConfig = Object.assign(
  {
    /**
     * Canonical production backend used by the packaged mobile app.
     * Normal web pages keep using their current origin.
     */
    defaultNativeBackendUrl: "https://dizychat.com",
    /**
     * Hidden developer-only override for packaged builds.
     */
    backendUrlStorageKey: "dizychat-backend-url",
    /**
     * Native builds pin the production Socket.IO endpoint directly in the
     * packaged config. Normal web pages leave it blank and stay same-origin.
     */
    socketUrl: dizychatNativeSocketUrl,
    socketOptions: {}
  },
  window.dizychatConfig || {}
);
