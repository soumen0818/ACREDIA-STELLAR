# Security Advisories

## Public Verification Audit Logs

`/api/verify/[token]` writes an operational audit row only after its rate limiter
allows the request. Logs are stored in `verification_logs.verification_result`
with a coarse `result_type` such as `verified`, `revoked`, `not_found`,
`chain_unavailable`, or `mismatch`.

The route does not store raw IP addresses, raw token IDs, user-agent strings,
verifier email, or verifier organization. Request identifiers are HMAC hashes
derived from `VERIFICATION_LOG_HASH_SECRET`; if that is not set, the server-only
`SUPABASE_SERVICE_ROLE_KEY` is used as the fallback secret. Set a dedicated
`VERIFICATION_LOG_HASH_SECRET` in production when possible.

Verification logs are for abuse detection, aggregate reliability monitoring,
and incident response. Treat them as operational data: keep them admin-only,
avoid exporting raw rows, and purge rows older than 90 days unless an active
security investigation or legal requirement needs a longer hold.

Example retention cleanup:

```sql
DELETE FROM public.verification_logs
WHERE created_at < NOW() - INTERVAL '90 days';
```

## Dependency Audit — 2026-05-27

All known vulnerabilities resolved. `npm audit` reports **0 vulnerabilities**.

### Fixes Applied

| Package | Issue | Resolution |
|---|---|---|
| `axios` (via `@stellar/stellar-sdk`) | SSRF, prototype pollution, header injection (HIGH) | Forced to `^1.16.1` via `overrides` |
| `postcss` (bundled by `next`) | XSS via unescaped `</style>` (MODERATE) | Forced to `^8.5.10` via `overrides` |
| `next` | DoS, cache poisoning, middleware bypass (HIGH) | Upgraded to `^15.5.14` (latest stable) |
| `follow-redirects` | Auth header leakage on cross-domain redirect (MODERATE) | Resolved via `npm audit fix` |
| `ws` | Uninitialized memory disclosure (MODERATE) | Resolved via `npm audit fix` |
| `ajv` | ReDoS via `$data` option (MODERATE) | Resolved via `npm audit fix` |
| `@stellar/stellar-sdk` | Transitive axios vulnerability | Upgraded to `^15.1.0` |
| `vitest` / `esbuild` | Dev server request interception (MODERATE) | Upgraded `vitest` to `^4.1.7` |

### npm `overrides`

Two transitive dependencies are pinned in `package.json` `overrides` because upstream packages do not yet declare patched versions as their minimum:

```json
"overrides": {
  "axios": "^1.16.1",
  "postcss": "^8.5.10"
}
```

These overrides should be removed once `@stellar/stellar-sdk` and `next` declare patched minimums in their own `package.json`.
