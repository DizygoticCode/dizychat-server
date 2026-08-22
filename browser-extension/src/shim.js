(() => {
  "use strict";

  if (typeof globalThis.GM_download === "function") return;

  globalThis.GM_download = (options = {}) => {
    try {
      const anchor = document.createElement("a");
      anchor.href = String(options.url || "");
      anchor.download = options.name || options.filename || "download";
      anchor.style.display = "none";
      document.documentElement.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => options.onload?.(), 0);
    } catch (error) {
      options.onerror?.(error);
    }
  };
})();
