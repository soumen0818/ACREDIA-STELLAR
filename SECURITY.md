# Security Advisories

## Secrets Management and Rotation

The authoritative runbook for secret storage, testnet/mainnet profile separation,
and emergency key rotation is in `SECRETS_ROTATION.md`.

Highlights:

- Server-only secrets must never be exposed via `NEXT_PUBLIC_*` variables.
- Use one network selector: `NEXT_PUBLIC_STELLAR_NETWORK` (`testnet`, `mainnet`, `custom`).
- Rotate immediately if secrets were committed/shared in issues, logs, screenshots, or chat.
- Repository protections include `gitleaks` in CI and a pre-commit `gitleaks` hook.

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

## Dependency Audit — 2026-10-29

The 2026-05-27 result above is out of date. A fresh `npm audit --omit=dev` on
2026-10-29 reported 22 issues (1 critical, 13 high, 5 moderate, 3 low). The
critical and every Next.js advisory are fixed; the remaining items are
transitive dependencies of the wallet kit and are tracked below.

### Fixes Applied

| Package | Issue | Resolution |
|---|---|---|
| `next` | Three critical RCEs (`next/og` `ImageResponse`, Image Optimization with SVG, `use cache` typed arrays), plus SSRF, DoS, cache poisoning and information-disclosure advisories | Upgraded `^16.2.6` → `^16.4.3` (installed 16.3.3 → 16.4.3) |
| `eslint-config-next` | Kept in step with `next` | Upgraded `^16.2.9` → `^16.4.3` |
| `zod` | Memory exhaustion on oversized constrained collections (HIGH, GHSA-mrhx-c7xc-m3w5) | Upgraded `^4.4.3` → `^4.6.7` |
| `sharp` (via `next`) | librsvg CVE (HIGH) | 0.35.4 → 0.35.5, pulled in by the `next` upgrade |
| `follow-redirects` (via `@stellar/stellar-sdk` → `axios`) | Credential exposure across redirects (HIGH, GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c) | Lockfile 1.16.0 → 1.16.1 (inside `axios`'s existing `^1.16.0` range; no override) |
| `source-map-js` (build-time, via Tailwind/PostCSS) | Event-loop DoS (HIGH, GHSA-68fv-2mgg-jv7q) | Lockfile 1.2.1 → 1.2.2 (inside the existing range; no override) |

### CI gate

`ci.yml` now runs `npm audit --omit=dev --audit-level=critical` as a blocking
step. Tighten it to `--audit-level=high` once the wallet-kit chain below is
patched upstream.

### Known transitive advisories (accepted, tracked)

After the fixes, `npm audit --omit=dev` reports 18 issues: 0 critical, 10 high, 5
moderate, 3 low. All of them come from `@creit.tech/stellar-wallets-kit`, which
pins its WalletConnect/Reown and HOT wallet dependencies exactly. The newest
release (2.8.0) pins the same versions, and `npm audit`'s only suggested fix is
a downgrade to 1.9.5, which would remove multi-wallet support.

| Source chain | Advisory | Why it is accepted for now |
|---|---|---|
| wallet kit → `@reown/appkit*`, `@coinbase/cdp-sdk` → bundled `zod` 3.x | Zod memory exhaustion (HIGH, GHSA-mrhx-c7xc-m3w5) | No patched zod 3.x exists, and forcing zod 4 into these SDKs risks breaking wallet connection. |
| wallet kit → `@hot-wallet/sdk` → `@solana/web3.js` → `jayson` → `stream-json`, `uuid` | stream-json DoS and prototype pollution (MODERATE), uuid bounds check (MODERATE) | Same pinning; no compatible fix. |
| wallet kit → `@hot-wallet/sdk` → `@near-js/crypto` → `secp256k1` → `elliptic` | Risky primitive implementation (LOW, GHSA-848j-6mx2-7j84) | Same pinning; no compatible fix. |

**Exposure.** These packages run only in the browser, inside the wallet
connection flow. No API route, server library, script or worker imports the
wallet layer (`src/lib/wallet/` is the only importer, enforced by ESLint), so
none of them can be reached on the server. The realistic impact is limited to
the user's own browser tab during a wallet connection.

**Related peer-dependency mismatch.** `abitype` (inside `@coinbase/cdp-sdk`)
declares `zod ^3` but resolves to the app's `zod` 4 because `.npmrc` sets
`legacy-peer-deps=true`. This predates the upgrade and is part of the same
upstream chain.

**Recheck** on every `@creit.tech/stellar-wallets-kit` release: run
`npm audit --omit=dev` and remove rows from this table as they are fixed.
