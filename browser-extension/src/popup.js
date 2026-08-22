const api = globalThis.browser ?? globalThis.chrome;
const manifest = api.runtime.getManifest();
document.getElementById("version").textContent = `Version ${manifest.version}`;

document.getElementById("open-rumble").addEventListener("click", () => {
  api.tabs.create({ url: "https://rumble.com/" });
});

document.getElementById("open-dizychat").addEventListener("click", () => {
  api.tabs.create({ url: "https://dizychat-server.onrender.com/" });
});
