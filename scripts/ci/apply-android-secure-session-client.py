from pathlib import Path

path = Path('public/chat.js')
text = path.read_text(encoding='utf-8')

old_storage = '''const DIZYCHAT_ACCOUNT_SESSION_KEY = "dizychat-account-session-v2";\n\nconst readAccountSessionToken = () => {\n  try {\n    return String(sessionStorage.getItem(DIZYCHAT_ACCOUNT_SESSION_KEY) || "").trim();\n  } catch {\n    return "";\n  }\n};\n\nconst storeAccountSessionToken = (token) => {\n  try {\n    const value = String(token || "").trim();\n    if (value) sessionStorage.setItem(DIZYCHAT_ACCOUNT_SESSION_KEY, value);\n    else sessionStorage.removeItem(DIZYCHAT_ACCOUNT_SESSION_KEY);\n  } catch {\n    /* ignore tab-scoped storage failures */\n  }\n};\n'''
new_storage = '''const accountAuth = window.dizychatAuthV2;\n\nconst readAccountSessionToken = () =>\n  String(accountAuth?.readToken?.() || "").trim();\n\nconst storeAccountSessionToken = (token) => {\n  accountAuth?.writeToken?.(token);\n};\n'''
if old_storage in text:
    text = text.replace(old_storage, new_storage, 1)
elif new_storage not in text:
    raise SystemExit('account storage block not found')

old_session = '''function applyAccountSession(session) {\n  const token = String(session?.token || "").trim();\n  accountState.sessionToken = token;\n  accountState.identity = session?.identity && typeof session.identity === "object" ? session.identity : null;\n  accountState.expiresAt = Number(session?.expiresAt || 0);\n  storeAccountSessionToken(token);\n  socket.auth = socket.auth && typeof socket.auth === "object" ? { ...socket.auth } : {};\n  if (token) socket.auth.sessionToken = token;\n  else delete socket.auth.sessionToken;\n  syncAccountUi();\n}\n\nfunction clearAccountSession() {\n  accountState.sessionToken = "";\n  accountState.identity = null;\n  accountState.expiresAt = 0;\n  storeAccountSessionToken("");\n  socket.auth = socket.auth && typeof socket.auth === "object" ? { ...socket.auth } : {};\n  delete socket.auth.sessionToken;\n  syncAccountUi();\n}\n'''
new_session = '''function applyAccountSession(session) {\n  const token = String(session?.token || "").trim();\n  accountState.sessionToken = token;\n  accountState.identity = session?.identity && typeof session.identity === "object" ? session.identity : null;\n  accountState.expiresAt = Number(session?.expiresAt || 0);\n  storeAccountSessionToken(token);\n  if (token && typeof accountAuth?.persistToken === "function") {\n    void accountAuth.persistToken(token).catch((error) => {\n      console.warn("[Auth] secure session persistence failed", error);\n      showToast("Signed in, but this device could not save the login securely.", "warn");\n    });\n  }\n  socket.auth = socket.auth && typeof socket.auth === "object" ? { ...socket.auth } : {};\n  if (token) socket.auth.sessionToken = token;\n  else delete socket.auth.sessionToken;\n  syncAccountUi();\n}\n\nfunction clearAccountSession({ persistent = false } = {}) {\n  accountState.sessionToken = "";\n  accountState.identity = null;\n  accountState.expiresAt = 0;\n  storeAccountSessionToken("");\n  if (persistent && typeof accountAuth?.clearPersistentToken === "function") {\n    void accountAuth.clearPersistentToken().catch((error) => {\n      console.warn("[Auth] secure session clear failed", error);\n    });\n  }\n  socket.auth = socket.auth && typeof socket.auth === "object" ? { ...socket.auth } : {};\n  delete socket.auth.sessionToken;\n  syncAccountUi();\n}\n'''
if old_session in text:
    text = text.replace(old_session, new_session, 1)
elif new_session not in text:
    raise SystemExit('account session functions not found')

old_login = 'socket.emit("account login", { username, password }, (ack = {}) => {'
new_login = '''socket.emit("account login", {\n    username,\n    password,\n    sessionKind: accountAuth?.isNativeSessionRuntime?.() ? "mobile" : "browser",\n  }, (ack = {}) => {'''
if old_login in text:
    text = text.replace(old_login, new_login, 1)
elif new_login not in text:
    raise SystemExit('account login emission not found')

old_restore = '''socket.emit("account session", {}, (ack = {}) => {\n    if (ack?.ok && ack?.session) applyAccountSession(ack.session);\n    else clearAccountSession();'''
new_restore = '''socket.emit("account session", {}, (ack = {}) => {\n    if (ack?.ok && ack?.session) applyAccountSession(ack.session);\n    else clearAccountSession({ persistent: true });'''
if old_restore in text:
    text = text.replace(old_restore, new_restore, 1)
elif new_restore not in text:
    raise SystemExit('account session restore callback not found')

# Explicit account logout paths must remove the durable Keystore token.
old_logout_callback = '''socket.emit("account logout", {}, () => {\n      clearAccountSession();\n      joinAsGuest();\n    });'''
new_logout_callback = '''socket.emit("account logout", {}, () => {\n      clearAccountSession({ persistent: true });\n      joinAsGuest();\n    });'''
if old_logout_callback in text:
    text = text.replace(old_logout_callback, new_logout_callback, 1)

old_finish = '''const finish = () => {\n      if (window.currentRoom) socket.emit("leave room", { room: window.currentRoom });\n      clearAccountSession();'''
new_finish = '''const finish = () => {\n      if (window.currentRoom) socket.emit("leave room", { room: window.currentRoom });\n      clearAccountSession({ persistent: true });'''
if old_finish in text:
    text = text.replace(old_finish, new_finish, 1)

path.write_text(text, encoding='utf-8')
print('Applied Android secure session client patch')
