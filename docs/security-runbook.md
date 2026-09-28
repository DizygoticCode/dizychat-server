# Security Runbook (DizyChat)

## Scope

Operational response checklist for public DizyChat deployments.

## Detection

Monitor structured logs prefixed with `[SecurityEvent]` for:

- `admin_auth_failed`
- `admin_auth_locked`
- `upload_origin_rejected`
- `room_password_mismatch`
- `banned_user_join_attempt`

## Immediate containment

1. Restrict ingress at the edge (Caddy / firewall / upstream reverse proxy rules) for abusive source IPs.
2. Rotate secrets immediately if compromise is suspected:
   - `ADMIN_PASSWORD_HASH` / `ADMIN_CREDENTIALS_HASHED`
3. Increase temporary hardening thresholds as needed:
   - lower `ADMIN_AUTH_MAX_FAILURES`
   - increase `ADMIN_AUTH_LOCK_MS`
4. If uploads are abused, temporarily disable uploads via deploy-time config or route-level block.

## Recovery

1. Verify normal service behavior:
   - room joins
   - admin authentication
   - upload storage and delivery
2. Confirm whether temporarily disabled upload security should remain off for compatibility testing or be re-enabled after the incident.
3. Review room bans/blocks and moderation logs for follow-up cleanup.

## Dependency security maintenance (28 September 2026)

The previously reported two moderate findings in the optional Firebase
Storage → `gaxios@6.7.1` → `uuid@9.0.1` chain were tracked in
[issue #477](https://github.com/DizygoticCode/dizychat-server/issues/477).
The live server used `npm ci --omit=optional` to exclude unused optional
Storage/Firestore packages; its installed-graph audit showed zero
vulnerabilities at that checkpoint.

[PR #480](https://github.com/DizygoticCode/dizychat-server/pull/480)
provides a separate **locked-tree** remediation: an explicit
`gaxios`-scoped `uuid@11.1.1` override (a pinned, tested major
override, not a parent-library upstream patch) plus CI that gates
the **full lockfile** at moderate severity and checks clean full
installation, UUID boundary handling, a real loopback Gaxios
request, Firebase Messaging module initialisation, and the
deterministic suite. The earlier omitted-optional job remains.
Do not infer real FCM delivery from these isolated tests, or
assume the GitHub change has already been deployed.

Retest both audit graphs after any dependency update, and monitor
for a supported upstream parent release that permits removing the
override. Avoid unreviewed broad `npm audit fix` changes.

See [self-hosted maintenance](SELF_HOSTED_MAINTENANCE.md) for the
dated host baseline, controlled installation and verification steps.

## Post-incident actions

1. Capture timeline with exact UTC timestamps.
2. Record impacted rooms/users and actions taken.
3. Update edge rules and alert thresholds to prevent repeat patterns.
4. Run secret rotation validation test and document completion date.
