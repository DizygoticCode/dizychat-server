from pathlib import Path

path = Path('index.js')
text = path.read_text(encoding='utf-8')

helper = """const isTrustedNativeHttpOrigin = (req) => {\n  const origin = String(req?.headers?.origin || '').trim().toLowerCase();\n  return TRUSTED_NATIVE_ORIGINS.has(origin) ? origin : '';\n};\n\n"""

helper_anchor = """const isTrustedNativeOrigin = (socket) => {\n  const origin = String(socket?.handshake?.headers?.origin || '').trim().toLowerCase();\n  return TRUSTED_NATIVE_ORIGINS.has(origin);\n};\n\n"""

middleware = """app.use((req, res, next) => {\n  const origin = isTrustedNativeHttpOrigin(req);\n  if (!origin) return next();\n\n  res.setHeader('Access-Control-Allow-Origin', origin);\n  res.setHeader('Vary', 'Origin');\n  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');\n  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');\n\n  if (req.method === 'OPTIONS') return res.sendStatus(204);\n  return next();\n});\n\n"""

middleware_anchor = """app.disable('x-powered-by');\n"""

changed = False
if 'const isTrustedNativeHttpOrigin = (req) =>' not in text:
    if helper_anchor not in text:
        raise SystemExit('native-origin helper anchor not found')
    text = text.replace(helper_anchor, helper_anchor + helper, 1)
    changed = True

if "res.setHeader('Access-Control-Allow-Origin', origin);" not in text:
    if middleware_anchor not in text:
        raise SystemExit('HTTP middleware anchor not found')
    text = text.replace(middleware_anchor, middleware_anchor + middleware, 1)
    changed = True

if not changed:
    print('Android native HTTP CORS patch already applied')
else:
    path.write_text(text, encoding='utf-8')
    print('Applied Android native HTTP CORS patch')
