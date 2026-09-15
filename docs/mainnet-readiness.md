# Mainnet Readiness

**Acredia runs on Stellar testnet today.** It is built so that moving to mainnet
is a configuration change, not a rewrite — but configuration is deliberately
*not* the only gate. This document states, honestly and in public, what is
finished, what is not, and what must be true before the switch is thrown.

> **Current status: not ready for mainnet.** The application is
> feature-complete and hardened on testnet. The outstanding items below are
> mostly governance and operational, not code.

**Last reviewed:** 2026-08-16

---

## 1. Readiness at a glance

| Area | Status | Blocking mainnet? |
|---|---|---|
| Application code & network switch | ✅ Ready | No |
| Database schema, RLS, data integrity | ✅ Ready | No |
| Security posture (audit findings) | ✅ Ready | No |
| Dependency supply chain | ✅ 0 vulnerabilities | No |
| Automated test coverage | ✅ 511 unit + 9 E2E | No |
| **Independent smart-contract audit** | ❌ Not started | **YES** |
| **Key custody for the contract owner** | ❌ Not decided | **YES** |
| **Credential TTL / keeper strategy** | ⚠️ Partial | **YES** |
| **Distributed rate limiting configured** | ⚠️ Not provisioned | **YES** |
| Institution business continuity | ⚠️ Single POC | Strongly advised |
| Incident response & on-call | ❌ Not defined | Strongly advised |

**Overall: 5 of 11 areas complete; 4 hard blockers remain.**

---

## 2. What "ready" already means

These are done and verified, not aspirational.

### 2.1 The network switch is real

Network selection is driven entirely by `NEXT_PUBLIC_STELLAR_NETWORK`
(`testnet` | `mainnet` | `custom`). Endpoints, the network passphrase, and
explorer URLs all derive from it — there are no per-environment code branches.

Verified behaviours:

- **No hardcoded network names in the UI.** All network badges render through a
  single `NetworkBadge` component derived from `activeNetwork`. Testnet shows an
  amber "Live on Stellar Testnet" badge; mainnet shows a neutral one. Previously
  two components hardcoded the string "Live on Stellar Testnet" and would have
  lied to users after cutover.
- **CSP already permits mainnet endpoints** (`horizon.stellar.org`,
  `soroban-mainnet.stellar.org`), so the switch will not be blocked by
  Content-Security-Policy.
- **Explorer links follow the network** — mainnet correctly maps to
  stellar.expert's `public` path.
- **No faucet, friendbot, or test-funding code exists** anywhere in the app.

### 2.2 Unsafe configuration fails the boot

The app boots in *degraded mode* when configuration is merely **missing** — this
keeps a misconfigured deployment navigable instead of showing a white screen.

That trade-off is explicitly **not** applied to configuration that is
**dangerous**. `UnsafeConfigError` is re-thrown rather than degraded, so:

```
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT=<a known testnet contract>
```

**fails the boot** instead of silently serving a mainnet-labelled app backed by a
testnet contract. Both behaviours are covered by regression tests
(`tests/runtimeConfig.env.test.ts`).

This mattered: before the guard was separated from the degrade path, the above
configuration booted successfully and served the testnet contract.

### 2.3 Credentials cannot be destroyed

Enforced at the database level, verified against a live PostgreSQL 16 instance:

- `credentials.institution_id` and `credentials.student_id` are `ON DELETE RESTRICT`
- `institutions.auth_user_id` and `students.auth_user_id` are `ON DELETE SET NULL`
- A `BEFORE DELETE` trigger refuses any deletion of a `credentials` row outright
- Deleting an auth user leaves the institution and its credentials intact

```
DELETE FROM auth.users  → institution SURVIVES, credential SURVIVES, link nulled
DELETE FROM credentials → ERROR: Deleting credentials is not allowed.
                                 They are immutable business records.
```

Verification also falls back to reading the chain directly when the database
index has no row, so losing the index does not make a credential unverifiable.

### 2.4 Security findings are closed

A full audit covering all API routes, RLS, supply chain, CI/CD, secrets, and
OWASP Top 10:2025 produced ten findings. All are resolved, including:

- An **unauthenticated IPFS upload endpoint** that let anyone pin files to the
  project's Pinata account — now requires an authenticated institution
- An **IDOR** allowing anyone to change any user's notification settings
- **Seven dependency vulnerabilities** — now zero
- CSP hardened to a per-request nonce (no `unsafe-inline` for scripts)

Verified clean and re-checked: RLS on all 15 tables, no secrets in git history,
no XSS sinks, no SQL injection surface, no `pull_request_target` in CI.

---

## 3. Hard blockers

These must be resolved before mainnet. None are code defects.

### 3.1 Independent smart-contract audit — **not started**

The `AcrediaCredential` Soroban contract has never been reviewed by an
independent third party. Its own tests pass, but self-testing does not establish
that authorization, TTL handling, and upgrade paths are safe when real
credentials and real money are involved.

On testnet a contract bug costs nothing. On mainnet it is permanent.

**Required:** a written third-party audit report, findings triaged, and any
critical or high findings fixed and re-reviewed.

### 3.2 Contract owner key custody — **not decided**

Today the contract owner is a single Stellar keypair held on a developer
machine. Whoever holds it can authorise any issuer.

That is acceptable for testnet and unacceptable for mainnet: losing it means
**no new institution can ever be authorised**, and leaking it means an attacker
can authorise themselves as an issuer.

**Required, decided and documented:**
- Where the mainnet owner key lives (hardware wallet, HSM, or multisig)
- Who can access it and under what approval
- The recovery procedure if it is lost
- Whether ownership transfers to a multisig at launch — the contract already
  supports two-step `transfer_owner` / `accept_owner`

### 3.3 Credential TTL / keeper strategy — **partial**

Soroban entries expire unless their TTL is extended. The contract exposes a
permissionless `bump_credential` so anyone can keep a credential alive, and a
pin-keeper worker exists — but there is no funded, monitored, scheduled process
guaranteeing every credential is bumped before expiry.

A credential that expires on-chain stops verifying. For a product whose promise
is *permanent*, verifiable records, this is the most product-damaging failure
available.

**Required:** a scheduled keeper with funding, monitoring, alerting on failure,
and a documented worst-case recovery path.

### 3.4 Distributed rate limiting — **not provisioned**

`rateLimit.ts` supports Upstash Redis and correctly reports its mode
(`distributed` / `in-memory-fallback` / `in-memory-unconfigured`), warning loudly
at startup when unconfigured. But `UPSTASH_REDIS_*` is not set, so limits are
per-serverless-instance and reset on cold start.

On testnet this is an annoyance. On mainnet the public verification endpoint is
the most exposed surface in the product.

**Required:** provision Upstash, set both variables, and confirm the admin
console reports `distributed`.

---

## 4. Strongly advised before mainnet

Not strictly blocking, but each is a real operational risk.

### 4.1 Institution business continuity

An institution is currently reachable through a single point of contact. If that
person is locked out or leaves, **all issuance for that institution stops** until
an Acredia admin intervenes manually.

The `institution_users` table already models membership as a relation and
supports multiple members per institution — the remaining work is to allow and
encourage a second member. See [Issue 14](../ISSUE_DRAFT.md).

### 4.2 Incident response

No documented on-call rotation, escalation path, or user-communication plan for
a mainnet incident. Decide before launch, not during one.

### 4.3 Stellar SDK upgrade

The project pins `@stellar/stellar-sdk` 15.x. Version 17 is available. There is
no security reason to rush (the one advisory reaching 15.x was resolved by
pinning a patched transitive `toml`, and the affected SEP-1 code path is never
called), but going to mainnet a major version behind is avoidable. Upgrade and
verify fully on testnet first.

---

## 5. The cutover procedure

Once every blocker above is cleared:

1. **Deploy the contract to mainnet** with the audited source.
   ```bash
   stellar contract deploy --network public --source <funded-mainnet-account> ...
   ```
2. **Initialise ownership** to the custody solution chosen in §3.2 — not a
   developer laptop key.
3. **Set production environment variables** (Vercel → Production → Redeploy):
   ```
   NEXT_PUBLIC_STELLAR_NETWORK=mainnet
   NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT=<mainnet contract id>
   NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT=<mainnet contract id>
   UPSTASH_REDIS_REST_URL=...
   UPSTASH_REDIS_REST_TOKEN=...
   ```
   `NEXT_PUBLIC_*` values are compiled into the bundle — **a redeploy is
   mandatory**, not optional.
4. **Confirm the boot guard works for you, not against you.** If a testnet
   contract id is left in place the deployment will fail to boot. That is
   intended.
5. **Verify after deploy:**
   - Network badges read "Live on Stellar Mainnet" everywhere
   - Admin console reports rate limiter mode `distributed`
   - Issue one credential end-to-end and verify it publicly
   - Explorer links resolve on `stellar.expert/explorer/public`
6. **Keep testnet running** as a staging environment. Do not repurpose it.

---

## 6. What does *not* change at cutover

- Database schema, RLS, and all off-chain data — Supabase is network-agnostic
- IPFS/Pinata storage
- Authentication, provisioning, and invitations
- The public verification flow

Only the ledger, the contract addresses, and the owner key custody change.

---

## 7. How to read this document

This is a live status document, not marketing. If you are evaluating Acredia:

- **Testnet:** the application is complete and hardened. Use it.
- **Mainnet:** not yet. The blockers in §3 are real and stated deliberately.

Progress is tracked in [`ISSUE_DRAFT.md`](../ISSUE_DRAFT.md). If a blocker here
is resolved, update the table in §1 in the same change.
