from pathlib import Path

readme = Path('README.md')
text = readme.read_text(encoding='utf-8')

section = '''## Private Android app

DizyChat Android Slice 1 is a **private, sideload-only APK** for selected testers. The bundled Capacitor client connects to the self-hosted production backend at `https://dizychat.com`; possession of the APK does not bypass normal DizyChat account authorization. Release signing keys and passwords remain outside Git.

See [`docs/android-private-apk.md`](docs/android-private-apk.md) for the reproducible CI artifact, private release-signing build, ADB install steps, and the 14-point real-device acceptance gate.

**Slice 2** will add push notifications, notification routing, inline notification Reply, and Mark as read after the durable Slice 1 device-session baseline is proven.

'''

marker = '## Project structure\n'
if section not in text:
    if marker not in text:
        raise SystemExit('README project-structure marker not found')
    text = text.replace(marker, section + marker, 1)
    readme.write_text(text, encoding='utf-8')
    print('Added private Android section to README')
else:
    print('README private Android section already present')
