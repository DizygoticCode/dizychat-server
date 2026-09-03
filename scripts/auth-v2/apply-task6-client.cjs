'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');
const loginPath = path.join(repoRoot, 'public', 'login.html');
const chatPath = path.join(repoRoot, 'public', 'chat.js');
const cssPath = path.join(repoRoot, 'public', 'chat.css');
const uiTestPath = path.join(repoRoot, 'tests', 'ui-test.cjs');

let login = fs.readFileSync(loginPath, 'utf8');
let chat = fs.readFileSync(chatPath, 'utf8');
let css = fs.readFileSync(cssPath, 'utf8');
let uiTest = fs.readFileSync(uiTestPath, 'utf8');

function replaceOnce(source, label, needle, replacement) {
  const first = source.indexOf(needle);
  if (first === -1) throw new Error(`${label}: expected seam not found`);
  if (source.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(`${label}: seam is not unique`);
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + needle.length)}`;
}

function replaceRegexOnce(source, label, regex, replacement) {
  const matches = source.match(regex);
  if (!matches) throw new Error(`${label}: expected seam not found`);
  return source.replace(regex, replacement);
}

if (!login.includes('id="registered-login"')) {
  login = replaceRegexOnce(
    login,
    'Task 6 landing auth modes',
    /      <div class="landing-inputs">[\s\S]*?      <div id="room-list">/,
    [
      '      <div class="landing-inputs auth-v2-landing">',
      '        <div class="room-entry-fields" aria-label="Room details">',
      '          <input id="room-input" placeholder="Enter room name" autocomplete="off" />',
      '          <input id="room-password" type="password" placeholder="Room password (optional)" autocomplete="current-password" />',
      '        </div>',
      '',
      '        <div class="auth-entry-grid">',
      '          <section id="registered-login" class="auth-entry-card" aria-labelledby="registered-login-title">',
      '            <h2 id="registered-login-title">Registered account</h2>',
      '            <p>Use your protected DizyChat identity.</p>',
      '            <input id="account-username" placeholder="Account username" autocomplete="username" />',
      '            <input id="account-password" type="password" placeholder="Account password" autocomplete="current-password" />',
      '            <button id="registered-join-btn" type="button">Sign in & join</button>',
      '            <p id="account-login-status" class="auth-entry-status" aria-live="polite"></p>',
      '          </section>',
      '',
      '          <section id="guest-login" class="auth-entry-card" aria-labelledby="guest-login-title">',
      '            <h2 id="guest-login-title">Guest</h2>',
      '            <p>Join without an account. Registered names are protected.</p>',
      '            <input id="guest-username" placeholder="Guest username" autocomplete="nickname" />',
      '            <button id="guest-join-btn" type="button">Join as guest</button>',
      '          </section>',
      '        </div>',
      '      </div>',
      '',
      '      <div id="room-list">'
    ].join('\n')
  );
}

if (!login.includes('id="account-identity"')) {
  login = replaceOnce(
    login,
    'Task 6 account header controls',
    '        <button id="leave-btn" title="Exit Chat">Leave</button>',
    [
      '        <span id="account-identity" class="account-identity" hidden></span>',
      '        <button id="account-logout-btn" type="button" title="Sign out of registered account" hidden>Sign out</button>',
      '        <button id="leave-btn" title="Exit Chat">Leave</button>'
    ].join('\n')
  );
}

if (!login.includes('<script src="/auth-v2-client.js"></script>')) {
  login = replaceOnce(
    login,
    'Task 6 auth helper script',
    '  <script src="/app-config.js"></script>\n  <script src="/chat.js"></script>',
    '  <script src="/app-config.js"></script>\n  <script src="/auth-v2-client.js"></script>\n  <script src="/chat.js"></script>'
  );
}

login = login.replace(
  /  <script>\n    const ADMIN_USERNAMES[\s\S]*?  <\/script>\n(?=<\/body>)/,
  ''
);

if (!chat.includes('const DIZYCHAT_ACCOUNT_SESSION_KEY = "dizychat-account-session-v2";')) {
  chat = replaceRegexOnce(
    chat,
    'Task 6 session-aware socket bootstrap',
    /const \{ url: socketUrl, options: socketOptions \} = resolveSocketConfig\(\);[\s\S]*?window\.socket = socket;\n/,
    [
      'const { url: socketUrl, options: baseSocketOptions } = resolveSocketConfig();',
      'const DIZYCHAT_ACCOUNT_SESSION_KEY = "dizychat-account-session-v2";',
      '',
      'const readAccountSessionToken = () => {',
      '  try {',
      '    return String(sessionStorage.getItem(DIZYCHAT_ACCOUNT_SESSION_KEY) || "").trim();',
      '  } catch {',
      '    return "";',
      '  }',
      '};',
      '',
      'const storeAccountSessionToken = (token) => {',
      '  try {',
      '    const value = String(token || "").trim();',
      '    if (value) sessionStorage.setItem(DIZYCHAT_ACCOUNT_SESSION_KEY, value);',
      '    else sessionStorage.removeItem(DIZYCHAT_ACCOUNT_SESSION_KEY);',
      '  } catch {',
      '    /* ignore tab-scoped storage failures */',
      '  }',
      '};',
      '',
      'const buildSocketOptions = (options = {}) => {',
      '  const next = options && typeof options === "object" ? { ...options } : {};',
      '  const auth = next.auth && typeof next.auth === "object" ? { ...next.auth } : {};',
      '  const sessionToken = readAccountSessionToken();',
      '  if (sessionToken) auth.sessionToken = sessionToken;',
      '  else delete auth.sessionToken;',
      '  if (Object.keys(auth).length) next.auth = auth;',
      '  else delete next.auth;',
      '  return Object.keys(next).length ? next : undefined;',
      '};',
      '',
      'const socketOptions = buildSocketOptions(baseSocketOptions);',
      'let socket;',
      'if (socketUrl && socketOptions) {',
      '  socket = io(socketUrl, socketOptions);',
      '} else if (socketUrl) {',
      '  socket = io(socketUrl);',
      '} else if (socketOptions) {',
      '  socket = io(socketOptions);',
      '} else {',
      '  socket = io();',
      '}',
      'window.socket = socket;',
      ''
    ].join('\n')
  );
}

if (!chat.includes('const accountState = {')) {
  chat = replaceOnce(
    chat,
    'Task 6 account state',
    'let latestPublicRooms = [];',
    [
      'let latestPublicRooms = [];',
      '',
      'const accountState = {',
      '  sessionToken: readAccountSessionToken(),',
      '  identity: null,',
      '  expiresAt: 0,',
      '};',
      '',
      'function accountRoleCanModerate() {',
      '  const role = accountState.identity?.role;',
      '  return role === "owner" || role === "admin";',
      '}',
      '',
      'function syncAccountUi() {',
      '  const identity = accountState.identity;',
      '  if (accountIdentity) {',
      '    accountIdentity.hidden = !identity;',
      '    accountIdentity.textContent = identity',
      '      ? `${identity.username} · ${String(identity.role || "user").toUpperCase()}`',
      '      : "";',
      '  }',
      '  if (accountLogoutBtn) accountLogoutBtn.hidden = !identity;',
      '  if (accountLoginStatus) {',
      '    accountLoginStatus.textContent = identity',
      '      ? `Signed in as ${identity.username} (${identity.role || "user"})`',
      '      : "";',
      '  }',
      '  if (identity && accountUsernameInput && !accountUsernameInput.value) {',
      '    accountUsernameInput.value = identity.username || "";',
      '  }',
      '  appState.isAdmin = accountRoleCanModerate();',
      '  refreshActionMenus();',
      '  renderUserSidebar(appState.users || []);',
      '}',
      '',
      'function applyAccountSession(session) {',
      '  const token = String(session?.token || "").trim();',
      '  accountState.sessionToken = token;',
      '  accountState.identity = session?.identity && typeof session.identity === "object" ? session.identity : null;',
      '  accountState.expiresAt = Number(session?.expiresAt || 0);',
      '  storeAccountSessionToken(token);',
      '  socket.auth = socket.auth && typeof socket.auth === "object" ? { ...socket.auth } : {};',
      '  if (token) socket.auth.sessionToken = token;',
      '  else delete socket.auth.sessionToken;',
      '  syncAccountUi();',
      '}',
      '',
      'function clearAccountSession() {',
      '  accountState.sessionToken = "";',
      '  accountState.identity = null;',
      '  accountState.expiresAt = 0;',
      '  storeAccountSessionToken("");',
      '  socket.auth = socket.auth && typeof socket.auth === "object" ? { ...socket.auth } : {};',
      '  delete socket.auth.sessionToken;',
      '  syncAccountUi();',
      '}'
    ].join('\n')
  );
}

if (chat.includes('const adminPasswordInput = document.getElementById("admin-password");')) {
  chat = replaceOnce(
    chat,
    'Task 6 landing DOM bindings',
    [
      'const joinBtn = document.getElementById("join-btn");',
      'const usernameInput = document.getElementById("username-input");',
      'const roomInput = document.getElementById("room-input");',
      'const passwordInput = document.getElementById("room-password");',
      'const adminPasswordInput = document.getElementById("admin-password");'
    ].join('\n'),
    [
      'const registeredJoinBtn = document.getElementById("registered-join-btn");',
      'const guestJoinBtn = document.getElementById("guest-join-btn");',
      'const accountUsernameInput = document.getElementById("account-username");',
      'const accountPasswordInput = document.getElementById("account-password");',
      'const guestUsernameInput = document.getElementById("guest-username");',
      'const roomInput = document.getElementById("room-input");',
      'const passwordInput = document.getElementById("room-password");',
      'const accountLoginStatus = document.getElementById("account-login-status");',
      'const accountLogoutBtn = document.getElementById("account-logout-btn");',
      'const accountIdentity = document.getElementById("account-identity");',
      'const joinBtn = guestJoinBtn;',
      'const usernameInput = guestUsernameInput;'
    ].join('\n')
  );
}

chat = chat.replace(
  'const prefillPassword = urlParams.get("password") || "";\n',
  [
    'if (urlParams.has("password")) {',
    '  urlParams.delete("password");',
    '  const cleanQuery = urlParams.toString();',
    '  const cleanUrl = `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}`;',
    '  window.history.replaceState({}, "", cleanUrl);',
    '}',
    ''
  ].join('\n')
);

chat = chat.replace(
  /if \(prefillPassword\) \{[\s\S]*?\n\}\n\nif \(prefillRoom \|\| prefillPassword\) \{\n  updateQueryParams\(prefillRoom, prefillPassword\);\n\}\n\n/,
  'if (prefillRoom) {\n  updateQueryParams(prefillRoom);\n}\n\n'
);

if (chat.includes('function updateQueryParams(room, password) {')) {
  chat = replaceRegexOnce(
    chat,
    'Task 6 URL helper',
    /function updateQueryParams\(room, password\) \{[\s\S]*?\n\}\n\nfunction showLanding/,
    [
      'function updateQueryParams(room) {',
      '  try {',
      '    const params = new URLSearchParams(window.location.search);',
      '    params.delete("password");',
      '    if (room) params.set("room", room);',
      '    else params.delete("room");',
      '    const query = params.toString();',
      '    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;',
      '    if (window.location.search !== (query ? `?${query}` : "")) {',
      '      window.history.replaceState({}, "", newUrl);',
      '    }',
      '  } catch (err) {',
      '    console.warn("[URL] Unable to update query params", err);',
      '  }',
      '}',
      '',
      'function showLanding'
    ].join('\n')
  );
}
chat = chat.replaceAll('updateQueryParams(lastRoomName, lastRoomPassword);', 'updateQueryParams(lastRoomName);');
chat = chat.replaceAll('updateQueryParams(room, password);', 'updateQueryParams(room);');

if (chat.includes('function emitJoinRequest() {')) {
  chat = replaceRegexOnce(
    chat,
    'Task 6 join flow',
    /function emitJoinRequest\(\) \{[\s\S]*?\n\}\n\nfunction renderPublicRooms/,
    [
      'function joinCurrentRoomAsAccount(room, password) {',
      '  const identity = accountState.identity;',
      '  if (!identity?.username) {',
      '    showToast("Sign in to a registered account first.", "error");',
      '    return;',
      '  }',
      '  completeRoomJoin(identity.username, room, password);',
      '  socket.emit("join room", { room, username: identity.username, password });',
      '}',
      '',
      'function emitRegisteredJoinRequest() {',
      '  const room = roomInput?.value.trim();',
      '  const roomPassword = passwordInput?.value || "";',
      '  if (!room) {',
      '    showToast("Enter a room name.", "warn");',
      '    roomInput?.focus();',
      '    return;',
      '  }',
      '',
      '  if (accountState.identity) {',
      '    joinCurrentRoomAsAccount(room, roomPassword);',
      '    return;',
      '  }',
      '',
      '  const username = accountUsernameInput?.value.trim();',
      '  const password = accountPasswordInput?.value || "";',
      '  if (!username || !password) {',
      '    showToast("Enter your registered username and password.", "warn");',
      '    (!username ? accountUsernameInput : accountPasswordInput)?.focus();',
      '    return;',
      '  }',
      '',
      '  if (accountLoginStatus) accountLoginStatus.textContent = "Signing in…";',
      '  socket.emit("account login", { username, password }, (ack = {}) => {',
      '    if (!ack?.ok || !ack?.session?.identity) {',
      '      if (accountLoginStatus) accountLoginStatus.textContent = ack?.error || "Sign in failed.";',
      '      showToast(ack?.error || "Sign in failed.", "error");',
      '      return;',
      '    }',
      '    applyAccountSession(ack.session);',
      '    if (accountPasswordInput) accountPasswordInput.value = "";',
      '    joinCurrentRoomAsAccount(room, roomPassword);',
      '  });',
      '}',
      '',
      'function emitJoinRequest() {',
      '  const username = usernameInput?.value.trim();',
      '  const room = roomInput?.value.trim();',
      '  const password = passwordInput?.value || "";',
      '',
      '  if (!username || !room) {',
      '    showToast("Enter a guest username and room name.", "warn");',
      '    (!username ? usernameInput : roomInput)?.focus();',
      '    return;',
      '  }',
      '',
      '  const joinAsGuest = () => {',
      '    completeRoomJoin(username, room, password);',
      '    socket.emit("join room", { room, username, password });',
      '  };',
      '',
      '  if (accountState.identity) {',
      '    socket.emit("account logout", {}, () => {',
      '      clearAccountSession();',
      '      joinAsGuest();',
      '    });',
      '    return;',
      '  }',
      '',
      '  joinAsGuest();',
      '}',
      '',
      'function renderPublicRooms'
    ].join('\n')
  );
}

chat = chat.replace(
  '[usernameInput, roomInput, passwordInput, adminPasswordInput]',
  '[usernameInput, roomInput, passwordInput, accountUsernameInput, accountPasswordInput]'
);

if (!chat.includes('registeredJoinBtn.addEventListener("click", emitRegisteredJoinRequest)')) {
  chat = replaceOnce(
    chat,
    'Task 6 registered join binding',
    'if (joinBtn) {\n  joinBtn.addEventListener("click", emitJoinRequest);\n}',
    'if (joinBtn) {\n  joinBtn.addEventListener("click", emitJoinRequest);\n}\nif (registeredJoinBtn) {\n  registeredJoinBtn.addEventListener("click", emitRegisteredJoinRequest);\n}'
  );
}

if (chat.includes('// If we were previously in a room, automatically rejoin it after reconnecting.')) {
  chat = replaceRegexOnce(
    chat,
    'Task 6 reconnect session restore',
    /socket\.on\("connect", \(\) => \{[\s\S]*?\n\}\);\nsocket\.on\("disconnect"/,
    [
      'socket.on("connect", () => {',
      '  showToast("Connected", "success");',
      '  renderPublicRooms([], { state: "loading" });',
      '  socket.emit("request rooms");',
      '',
      '  socket.emit("account session", {}, (ack = {}) => {',
      '    if (ack?.ok && ack?.session) applyAccountSession(ack.session);',
      '    else clearAccountSession();',
      '',
      '    if (window.currentRoom && window.currentUser) {',
      '      const username = accountState.identity?.username || window.currentUser;',
      '      socket.emit("join room", {',
      '        room: window.currentRoom,',
      '        username,',
      '        password: window.currentPassword || "",',
      '      });',
      '    }',
      '  });',
      '});',
      'socket.on("disconnect"'
    ].join('\n')
  );
}

chat = chat.replaceAll('appState.isAdmin = false;', 'appState.isAdmin = accountRoleCanModerate();');
chat = chat.replace(
  /socket\.on\("admin status", \(\{ isAdmin \}\) => \{[\s\S]*?\n\}\);\n\n/,
  '// Auth v2 role metadata drives moderation affordances; no admin-password status event.\n\n'
);

if (!chat.includes('accountLogoutBtn.addEventListener("click"')) {
  const marker = 'if (copyJoinLinkBtn) {';
  const index = chat.indexOf(marker);
  if (index === -1) throw new Error('Task 6 logout insertion seam not found');
  const block = [
    'if (accountLogoutBtn) {',
    '  accountLogoutBtn.addEventListener("click", () => {',
    '    const finish = () => {',
    '      if (window.currentRoom) socket.emit("leave room", { room: window.currentRoom });',
    '      clearAccountSession();',
    '      clearReplyTarget();',
    '      showLanding({ focusUsername: false });',
    '      accountUsernameInput?.focus();',
    '      showToast("Signed out", "info");',
    '    };',
    '    socket.emit("account logout", {}, finish);',
    '  });',
    '}',
    ''
  ].join('\n');
  chat = `${chat.slice(0, index)}${block}${chat.slice(index)}`;
}

if (!css.includes('.auth-entry-grid {')) {
  css += [
    '',
    '',
    '/* Auth v2 landing */',
    '.auth-v2-landing {',
    '  width: min(720px, calc(100vw - 32px));',
    '  gap: 14px;',
    '}',
    '',
    '.room-entry-fields {',
    '  display: grid;',
    '  width: min(420px, 100%);',
    '  gap: 8px;',
    '}',
    '',
    '.auth-entry-grid {',
    '  width: 100%;',
    '  display: grid;',
    '  grid-template-columns: repeat(2, minmax(0, 1fr));',
    '  gap: 12px;',
    '}',
    '',
    '.auth-entry-card {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 8px;',
    '  min-width: 0;',
    '  padding: 16px;',
    '  border: 1px solid var(--border-color);',
    '  border-radius: var(--radius);',
    '  background: var(--surface-alt);',
    '  box-sizing: border-box;',
    '}',
    '',
    '.auth-entry-card h2, .auth-entry-card p { margin: 0; }',
    '.auth-entry-card p { color: var(--text-muted); font-size: 0.82rem; line-height: 1.4; }',
    '.auth-entry-card input, .auth-entry-card button, .room-entry-fields input { width: 100%; box-sizing: border-box; }',
    '.auth-entry-card button {',
    '  margin-top: auto;',
    '  padding: 9px 12px;',
    '  border: 0;',
    '  border-radius: var(--radius);',
    '  background: var(--accent);',
    '  color: #07130c;',
    '  font-weight: 700;',
    '  cursor: pointer;',
    '}',
    '.auth-entry-status { min-height: 1.2em; }',
    '.account-identity { font-size: 0.8rem; color: var(--text-muted); white-space: nowrap; }',
    '',
    '@media (max-width: 720px) {',
    '  .auth-v2-landing { width: min(100%, calc(100vw - 24px)); }',
    '  .auth-entry-grid { grid-template-columns: 1fr; }',
    '  .auth-entry-card { padding: 12px; }',
    '}',
    ''
  ].join('\n');
}

uiTest = uiTest.replaceAll(
  "await page.waitForSelector('#join-btn', { timeout: 30000 });",
  "await page.waitForSelector('#guest-join-btn', { timeout: 30000 });"
);
uiTest = uiTest.replaceAll(
  "await page.fill('#username-input', 'TesterBot');",
  "await page.fill('#guest-username', 'TesterBot');"
);
uiTest = uiTest.replaceAll(
  "await page.click('#join-btn');",
  "await page.click('#guest-join-btn');"
);

for (const token of ['id="admin-password"', 'ADMIN_USERNAMES', 'id="username-input"', 'id="join-btn"']) {
  if (login.includes(token)) throw new Error(`Task 6 forbidden legacy landing token remains: ${token}`);
}
for (const token of ['adminPasswordInput', '"admin auth"', "'admin auth'", '.get("password")', ".get('password')", 'params.set("password"', "params.set('password'"]) {
  if (chat.includes(token)) throw new Error(`Task 6 forbidden client token remains: ${token}`);
}
for (const token of [
  'const DIZYCHAT_ACCOUNT_SESSION_KEY = "dizychat-account-session-v2";',
  'sessionStorage.getItem(DIZYCHAT_ACCOUNT_SESSION_KEY)',
  'sessionStorage.setItem(DIZYCHAT_ACCOUNT_SESSION_KEY',
  'sessionStorage.removeItem(DIZYCHAT_ACCOUNT_SESSION_KEY)',
  'socket.emit("account login"',
  'socket.emit("account session"',
  'socket.emit("account logout"',
  'function updateQueryParams(room)',
  'params.delete("password")',
  'role === "owner" || role === "admin"',
]) {
  if (!chat.includes(token)) throw new Error(`Task 6 required client contract missing: ${token}`);
}
for (const token of [
  'id="registered-login"',
  'id="account-username"',
  'id="account-password"',
  'id="registered-join-btn"',
  'id="guest-login"',
  'id="guest-username"',
  'id="guest-join-btn"',
]) {
  if (!login.includes(token)) throw new Error(`Task 6 required landing contract missing: ${token}`);
}

fs.writeFileSync(loginPath, login);
fs.writeFileSync(chatPath, chat);
fs.writeFileSync(cssPath, css);
fs.writeFileSync(uiTestPath, uiTest);
console.log('Applied guarded Auth v2 Task 6 browser migration.');
