(() => {
  "use strict";

  const api = globalThis.browser || globalThis.chrome;
  const getActiveTab = async () => {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  };

  const send = async (tabId, message) => {
    if (globalThis.browser) return api.tabs.sendMessage(tabId, message);
    return new Promise((resolve) => {
      api.tabs.sendMessage(tabId, message, (response) => {
        if (api.runtime.lastError) return resolve(null);
        resolve(response || null);
      });
    });
  };

  const els = {
    page: document.getElementById("pageStatus"),
    recorder: document.getElementById("recorderStatus"),
    burn: document.getElementById("burnStatus"),
    log: document.getElementById("logCount"),
    openSettings: document.getElementById("openSettings"),
    openRumble: document.getElementById("openRumble"),
    version: document.getElementById("versionLabel")
  };

  const init = async () => {
    const manifest = api.runtime.getManifest();
    els.version.textContent = `v${manifest.version}`;

    const tab = await getActiveTab();
    const onRumble = Boolean(tab?.url && /^https:\/\/(?:www\.)?rumble\.com\//i.test(tab.url));
    els.page.textContent = onRumble ? "Active" : "Not on Rumble";
    els.openSettings.disabled = !onRumble;

    if (onRumble && tab?.id != null) {
      const status = await send(tab.id, { type: "DIZY_RUMBLE_STATUS" });
      if (status?.ok) {
        els.recorder.textContent = status.recorderEnabled ? "On" : "Off";
        els.burn.textContent = status.autoBurnEnabled ? "On" : "Off";
        els.log.textContent = String(status.loggedCount ?? 0);
      } else {
        els.page.textContent = "Reload Rumble tab";
        els.openSettings.disabled = true;
      }
    }

    els.openSettings.addEventListener("click", async () => {
      const active = await getActiveTab();
      if (active?.id == null) return;
      const result = await send(active.id, { type: "DIZY_RUMBLE_OPEN_SETTINGS" });
      if (result?.ok) window.close();
    });

    els.openRumble.addEventListener("click", () => {
      api.tabs.create({ url: "https://rumble.com/" });
    });
  };

  init().catch((err) => {
    console.error("Dizygotic Rumble Chat Companion popup failed", err);
    els.page.textContent = "Unavailable";
    els.openSettings.disabled = true;
  });
})();
