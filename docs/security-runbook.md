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

The default committed dependency tree has two moderate, transitive
Firebase Storage / gaxios / uuid warnings tracked in
[issue #477](https://github.com/DizygoticCode/dizychat-server/issues/477).
The tested server-only `npm ci --omit=optional` install excludes that
optional dependency chain; its omitted-optional audit reported no
vulnerabilities at the 28 September checkpoint. CI also verified Firebase
Messaging initialisation and 573 deterministic tests, but **not**
end-to-end remote mobile delivery. This is not an upstream advisory fix:
retain the issue, watch vendor updates, and retest on dependency changes.
Avoid incompatible forced UUID overrides and unreviewed broad
`npm audit fix` changes.

See [self-hosted maintenance](SELF_HOSTED_MAINTENANCE.md) for the
exact host versions, controlled installation and verification steps.

## Post-incident actions

1. Capture timeline with exact UTC timestamps.
2. Record impacted rooms/users and actions taken.
3. Update edge rules and alert thresholds to prevent repeat patterns.
4. Run secret rotation validation test and document completion date.
