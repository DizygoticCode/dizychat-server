# Security Runbook (DizyChat)

## Scope

Operational response checklist for public DizyChat deployments.

## Detection

Monitor structured logs prefixed with `[SecurityEvent]` for:

- `admin_auth_failed`
- `admin_auth_locked`
- `upload_origin_rejected`
- `upload_type_rejected`
- `upload_magic_bytes_rejected`
- `upload_scanner_disabled`
- `scanner_unavailable`
- `scanner_timeout`
- `scanner_error`
- `room_password_mismatch`
- `banned_user_join_attempt`

## Immediate containment

1. Restrict ingress at edge (WAF / reverse proxy / Render rules) for abusive source IPs.
2. Rotate secrets immediately if compromise is suspected:
   - `ADMIN_PASSWORD_HASH` / `ADMIN_CREDENTIALS_HASHED`
   - `METADEFENDER_API_KEY`
3. Increase temporary hardening thresholds as needed:
   - lower `ADMIN_AUTH_MAX_FAILURES`
   - increase `ADMIN_AUTH_LOCK_MS`
4. If uploads are abused, temporarily disable uploads via deploy-time config or route-level block.

## Recovery

1. Verify normal service behavior:
   - room joins
   - admin authentication
   - upload scan pipeline
2. Confirm scanner availability and status latency, or confirm `REQUIRE_UPLOAD_ANTIVIRUS_SCAN` is intentionally unset/false for local-only type verification.
3. Review room bans/blocks and moderation logs for follow-up cleanup.

## Post-incident actions

1. Capture timeline with exact UTC timestamps.
2. Record impacted rooms/users and actions taken.
3. Update edge rules and alert thresholds to prevent repeat patterns.
4. Run secret rotation validation test and document completion date.
