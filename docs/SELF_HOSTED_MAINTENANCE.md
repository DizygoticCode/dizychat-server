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

## Dependency audit: what the zero means

The default committed dependency tree still contains an optional
Firebase Admin / Google Cloud Storage `gaxios@6.7.1` →
`uuid@9.0.1` chain reported by the advisory checker as two
**moderate** findings on 27 September 2026. It is tracked in
[issue #477](https://github.com/DizygoticCode/dizychat-server/issues/477).
Do **not** say that the upstream advisory was repaired, and do not close
the issue on the basis of omitting optional packages.

[PR #478](https://github.com/DizygoticCode/dizychat-server/pull/478)
added an isolated CI job which ran `npm ci --omit=optional`,
verified the unneeded optional Storage/Firestore/gaxios/uuid modules
were not installed, initialised Firebase Messaging with inert local
test credentials, ran the moderate+ omitted-optional audit and the
deterministic test suite. The audit returned zero findings and all
**573 deterministic tests passed** on that tested graph. This is
compatibility evidence, **not** a live remote-FCM delivery test.
The default-install high/critical audit and Self-Host CI passed too.
Continue monitoring for a supported upstream fix; do not force an
incompatible UUID override or downgrade Firebase merely to silence
the warning.

For a future controlled deployment, compare exact Git commit and
working-tree changes first, back up durable state, then perform the
dependency install and service restart within the operator's
maintenance window. Installing without optional packages must remain
an explicit, tested server-side choice; CI/mobile development jobs
currently retain their normal full install unless their own
compatibility is proved. Repeat both the default lockfile audit and
the omitted-optional installed-graph audit after dependency changes.

## Read-only verification checklist

```bash
git status --short
git rev-parse HEAD
node --version
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
