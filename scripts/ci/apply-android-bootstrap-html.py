from pathlib import Path

login = Path('public/login.html')
login_text = login.read_text(encoding='utf-8')

login_text = login_text.replace('  <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>\n', '')
old_scripts = '''  <script src="/socket.io/socket.io.js"></script>\n  <script src="/app-config.js"></script>\n  <script src="/auth-v2-client.js"></script>\n  <script src="/chat.js"></script>\n'''
new_scripts = '''  <script src="/app-config.js"></script>\n  <script src="/auth-v2-client.js"></script>\n  <script src="/mobile-runtime.js"></script>\n  <script src="/mobile-bootstrap.js"></script>\n'''
if old_scripts not in login_text and new_scripts not in login_text:
    raise SystemExit('login bootstrap script block not found')
login_text = login_text.replace(old_scripts, new_scripts, 1)
login.write_text(login_text, encoding='utf-8')

index = Path('public/index.html')
index_text = index.read_text(encoding='utf-8')
redirect = '''  <script>\n    try {\n      if (window.Capacitor?.isNativePlatform?.()) {\n        window.location.replace("/login.html");\n      }\n    } catch (_err) {\n      /* Normal web landing stays unchanged. */\n    }\n  </script>\n'''
anchor = '  <title>DizyChat — Host unforgettable rooms</title>\n'
if redirect not in index_text:
    if anchor not in index_text:
        raise SystemExit('index title anchor not found')
    index_text = index_text.replace(anchor, anchor + redirect, 1)
index.write_text(index_text, encoding='utf-8')

print('Applied Android packaged bootstrap HTML patch')
