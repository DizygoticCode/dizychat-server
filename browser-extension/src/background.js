const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "dizygotic-download") return false;

  const options = {
    url: String(message.url || ""),
    filename: message.filename ? String(message.filename) : undefined,
    saveAs: Boolean(message.saveAs),
    conflictAction: "uniquify"
  };

  Promise.resolve(api.downloads.download(options))
    .then((downloadId) => sendResponse({ ok: true, downloadId }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});
