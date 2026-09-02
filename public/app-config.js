window.dizychatConfig = Object.assign(
  {
    /**
     * Optional base URL for the Socket.IO connection.
     * Leave empty for the web app so Socket.IO uses the current origin.
     */
    socketUrl: "",
    /**
     * Public URL used automatically when the app is loaded from a
     * non-HTTP origin (e.g. capacitor://localhost).
     */
    defaultNativeSocketUrl: "https://dizychat.com",
    /**
     * Additional options that are passed to io(...).
     * Example: { transports: ["websocket"] }
     */
    socketOptions: {},
    /**
     * LocalStorage key used to dynamically override the socket URL at runtime.
     * Useful for debug builds when you want to switch servers without
     * rebuilding the native wrapper.
     */
    socketUrlStorageKey: "dizychat-socket-url"
  },
  window.dizychatConfig || {}
);
