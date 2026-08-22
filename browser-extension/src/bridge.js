(() => {
  "use strict";

  const runtime = globalThis.browser?.runtime || globalThis.chrome?.runtime;
  if (!runtime?.onMessage) return;

  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return undefined;

    if (message.type === "DIZY_RUMBLE_STATUS") {
      const api = globalThis.rumbleBlocker;
      const settings = api?.getSettings?.() || null;
      sendResponse({
        ok: Boolean(api),
        version: "1.8",
        blockedCount: api?.getBlocked?.()?.length || 0,
        loggedCount: api?.getChatLog?.()?.length || 0,
        recorderEnabled: Boolean(settings?.chatRecorderEnabled),
        autoBurnEnabled: Boolean(settings?.autoBurnEnabled)
      });
      return true;
    }

    if (message.type === "DIZY_RUMBLE_OPEN_SETTINGS") {
      const button = document.getElementById("floatingBlockerSettingsBtn");
      if (button) button.click();
      sendResponse({ ok: Boolean(button) });
      return true;
    }

    return undefined;
  });
})();
