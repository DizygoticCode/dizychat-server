# DizyChat self-hosted maintenance (28 September 2026)

This is a dated **operator-reported checkpoint**, not a live dashboard or
a substitute for verification after a future deployment. The shared
Ubuntu/Caddy/Node host also serves DizyTrades; see its
[self-hosted operations runbook](https://github.com/DizygoticCode/DizyTrades/blob/main/docs/SELF_HOSTED_OPERATIONS.md).
Do not commit host secrets, full logs, exported chat history or backups.

## Verified maintenance sequence

- The DizyChat checkout advanced from
  `3128460815da164b7f4d8f26b08856795e22c3b5` to
  `0af4eae090743d5b27cee3be12b008aead118927`, the merge of
  [PR #478](https://github.com/DizygoticCode/dizychat-server/pull/478).
  That PR changed **only**
  `.github/workflows/dependency-security-audit.yml`; it did not patch
  application code or change the lockfile. The operator observed that
  `data/soundboards/*.json` and `data/soundboards/index.json` held
  local modifications, plus an untracked board. These are retained
  application data; never run `git reset --hard` or `git clean -fd`
  to prepare a pull without an explicit backup/reconciliation plan.
- The operator ran `npm ci --omit=optional` in the DizyChat checkout.
  This reinstalls dependencies without optional packages **on that host**;
  it does not rewrite the committed `package-lock.json`. That install
  reported 373 packages added and `found 0 vulnerabilities`. A separate
  `npm audit --omit=optional --audit-level=moderate` reported
  `found 0 vulnerabilities` **at that time and for that omitted-optional
  graph only**. DizyChat was then restarted with systemd. Post-install
  application-level smoke verification remains an operator step;
  a prior `/version` check is not proof of health after the reinstall.
- MongoDB standalone was upgraded from 8.0.29 to **8.0.32**. Before
  upgrading, DizyChat was temporarily quiesced and a protected fresh
  `mongodump --gzip --archive` backup was taken. The archive was
  accepted by `mongorestore --dryRun --gzip --archive`, MongoDB
  `ping` succeeded, and DizyChat was restarted. The dry run does not
  establish that a **full restore** would succeed; rehearse that in an
  isolated environment before marking recovery verified.
- Caddy **2.11.4**, kernel **6.8.0-142-generic**, the Netplan package
  updates and the split Linux firmware packages were installed in
  isolated host-maintenance steps. The Netplan configuration generated
  without applying a new network configuration. The DizyChat public
  route is proxied to `127.0.0.1:10001`, and LiveKit has its own
  proxy path. The operator checked `ssh.socket`, `caddy`,
  `dizytrades`, `dizychat` and `mongod` active after the OS
  maintenance. Changes to the live Caddyfile require a dated backup,
  validation, reload and both-app smoke checks.
- System Node.js is **22.23.1**, intentionally under
  `sudo apt-mark hold nodejs`. DizyChat declares Node `>=22`,
  but the co-hosted DizyTrades project requires **exactly 22.23.1**.
  Do not unhold/upgrade the shared Node installation merely because
  an Ubuntu/NodeSource update appears; coordinate a tested DizyTrades
  engine/CI/build change first.

## Dependency audit: host mitigation and source-tree fix

**Historical operator checkpoint:** on 27 September, the *old* full
lockfile reported two moderate advisory entries along Firebase Admin's
optional Google Cloud Storage `gaxios@6.7.1` →
`uuid@9.0.1` chain. On 28 September the operator installed the
already-supported `npm ci --omit=optional` graph on dizyserver:
373 packages installed, and the moderate+ omitted-optional audit
reported zero vulnerabilities. [PR #478](https://github.com/DizygoticCode/dizychat-server/pull/478)
had already verified Firebase Messaging module initialisation and
573 deterministic tests without those optional modules. The server's
last installed dependencies do not change merely because GitHub
later merges a lockfile.

**Repository fix:** [PR #480](https://github.com/DizygoticCode/dizychat-server/pull/480)
addresses [issue #477](https://github.com/DizygoticCode/dizychat-server/issues/477)
by pinning patched `uuid@11.1.1` **only under gaxios**, using npm's
package-level `overrides` rather than overriding UUID globally.
The Gaxios 6 dependency otherwise requests `uuid ^9`. This
*is* a deliberately bounded major-version override; it is not an
upstream Gaxios or Firebase Admin fix. The approach has an upstream
usage precedent in Firebase CLI's gaxios-specific override.

The new full-dependency CI job checks a clean `npm ci`,
`npm ls gaxios uuid`, UUID v4 and buffer-boundary contracts,
an actual loopback HTTP request through Gaxios 6,
Firebase Messaging initialisation without a real FCM send, and
all deterministic tests. The full **committed lockfile** audit
is now gated at `--audit-level=moderate`, and the separate
`npm ci --omit=optional` compatibility and installed-graph audit
remain in force. Passing these checks fixes the *repository's locked
dependency finding*; it does **not** prove live remote-FCM delivery
or remove the need to review upstream release compatibility.

**Operator implications:** keep the production `npm ci --omit=optional`
choice unless an explicitly reviewed change calls for full optional
dependencies. A GitHub merge does not install packages, restart
DizyChat, or change the running server automatically. For a future
controlled deployment: check the exact commit and host-local soundboard
changes, protect state/rollback, install the reviewed dependency
graph, then restart only when needed and verify actual browser,
Socket.IO and mobile push behaviour. Review upstream release notes
periodically and remove the major override when a supported parent
dependency no longer requires it. Never run a broad forced
`npm audit fix` solely to silence alerts.

## Read-only verification checklist

```bash
git status --short
git rev-parse HEAD
node --version
npm audit --package-lock-only --audit-level=moderate
npm audit --omit=optional --audit-level=moderate
systemctl is-active ssh.socket caddy dizytrades dizychat mongod
curl -fsS http://127.0.0.1:10001/version
curl -fsS https://dizychat.com/version
```

A successful `/version` response and `active` unit do not replace
a browser login/room join, authenticated Socket.IO/WebSocket flow,
media/ClamAV, and actual Android/Web Push acceptance checks. A
documentation-only GitHub merge is not deployed by itself and
should not trigger a service restart. Any future network change
needs a timed rollback/console access plan; do not blindly apply
Netplan over the only SSH connection.

Keep backup archives encrypted/protected on the host, outside Git.
Never use a restore with destructive flags against the live database
as a test; use an isolated target and verify representative collections
and indexes. Review APT autoremove candidates individually rather
than running it simply because they are offered.
