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
     * Optional explicit Socket.IO URL. The mobile bootstrap derives this from
     * the canonical backend before chat.js loads.
     */
    socketUrl: "",
    socketOptions: {}
  },
  window.dizychatConfig || {}
);
