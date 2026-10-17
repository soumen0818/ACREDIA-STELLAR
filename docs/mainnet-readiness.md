# Mainnet Readiness

**Acredia runs on Stellar testnet today.** It is built so that moving to mainnet
is a configuration change, not a rewrite — but configuration is deliberately
*not* the only gate. This document states, honestly and in public, what is
finished, what is not, and what must be true before the switch is thrown.

> **Current status: not ready for mainnet.** The application is
> feature-complete and hardened on testnet. The outstanding items below are
> mostly governance and operational, not code.

**Last reviewed:** 2026-10-17

---

## 1. Readiness at a glance

| Area | Status | Blocking mainnet? |
|---|---|---|
| Application code & network switch | ✅ Ready | No |
| Database schema, RLS, data integrity | ✅ Ready | No |
| Security posture (audit findings) | ⚠️ Deploy-time owner constructor pending | **YES** |
| Dependency supply chain | ✅ 0 vulnerabilities | No |
| Automated test coverage | ✅ 796 frontend unit/integration; 91 contract tests | No |
| **Independent smart-contract audit** | ❌ Not started | **YES** |
| **Key custody for the contract owner** | ⚠️ 2-of-3 policy decided; hardware setup and rehearsal pending | **YES** |
| **Credential TTL / keeper strategy** | ⚠️ Partial | **YES** |
| **Distributed rate limiting configured** | ⚠️ Guard enforced — Upstash provisioning required | **YES** |
| Institution business continuity | ✅ Self-service members & risk list — mainnet second-member rule proposed | Strongly advised |
| Incident response & on-call | ⚠️ Plan adopted — roster, paging and team tabletop pending | Strongly advised |

**Overall: 5 of 11 areas complete; 5 hard blockers remain.**

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
- **Mainnet RPC endpoint verified reachable.** The mainnet default shipped as
  `soroban-mainnet.stellar.org`, a host that **does not exist** — every contract
  read would have failed on cutover day. It is now `mainnet.sorobanrpc.com`,
  confirmed healthy through the Stellar SDK, and a regression test asserts both
  network profiles point at reachable hosts.
- **CSP already permits mainnet endpoints** (`horizon.stellar.org`,
  `mainnet.sorobanrpc.com`), so the switch will not be blocked by
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

### 3.1 Independent smart-contract audit — **scope documented, engagement pending**

The `AcrediaCredential` Soroban contract has never been reviewed by an
independent third party. Its own tests pass, but self-testing does not establish
that authorization, TTL handling, and upgrade paths are safe when real
credentials and real money are involved.

On testnet a contract bug costs nothing. On mainnet it is permanent.

The audit scope is now formally documented in
[contracts/THIRD_PARTY_AUDIT.md](../contracts/THIRD_PARTY_AUDIT.md), covering:
authorization model, TTL and archival, `batch_issue_credential` semantics,
`upgrade`/`migrate` gating, and economic/DoS surface.

**Required to clear this blocker:** a written third-party report published in
`contracts/`, critical/high findings fixed and re-reviewed, and the audited
commit tagged for the mainnet deploy.

### 3.2 Contract owner key custody — **decided, rehearsal pending**

The custody mechanism is now decided and documented in
[docs/owner-key-custody.md](./owner-key-custody.md).

**Summary**: Stellar account-level multisig (2-of-3 threshold). No contract
change is required — the existing `transfer_owner` / `accept_owner` two-step
handover (contracts/src/lib.rs lines 283–322) is used for the transfer.

**Remaining gate before mainnet**: the transfer must be rehearsed on testnet,
start to finish, with the commands recorded. See §4 of
[docs/owner-key-custody.md](./owner-key-custody.md) for the step-by-step
procedure.

### 3.3 Credential TTL / keeper strategy — **code verified; deployment and rehearsal pending**

The daily 02:00 UTC keeper now enumerates chain token IDs, including revoked
credentials, in rotating pages of 50. It reads each entry's TTL, bumps entries
near expiry, submits sequentially with the configured network/signer, retries
failed IDs, reconciles the database count, and records outcomes/cursor in
`cron_run_log`. It reports failed/partial states and exposes the latest run in
`/api/admin/stats`. The 300-second function and page size require a live capacity
measurement; a run is marked unhealthy above 4,500 credentials.

**Remaining gates before mainnet:** apply the keeper SQL migration; provision and
fund the keeper account and cron secret; measure fees, duration and TTL margin;
configure an independent missed-run/failure/low-balance alert; and record a
real testnet sweep plus archived-entry restore rehearsal. See the
[keeper runbook](./ops/ttl-keeper-runbook.md). A timestamp in the admin console
is observability, not an independently configured alert.

### 3.4 Distributed rate limiting — **guard enforced, provisioning required**

`rateLimit.ts` supports Upstash Redis and correctly reports its mode
(`distributed` / `in-memory-fallback` / `in-memory-unconfigured`).

**New in this change (Issue #282)**:

- **Mainnet boot guard**: when `NEXT_PUBLIC_STELLAR_NETWORK=mainnet` and
  `UPSTASH_REDIS_*` are absent, the app now **fails to boot** (throws at
  module-init time) rather than silently running per-instance. This mirrors
  the `UnsafeConfigError` philosophy. An escape hatch
  (`RATE_LIMIT_ALLOW_IN_MEMORY_ON_MAINNET=true`) exists for operators who
  explicitly accept the risk.
- **Health-check endpoint**: `GET /api/admin/rate-limit-health` (admin-only)
  probes Redis live, reports the current process mode separately, and returns
  HTTP 503 on mainnet when Redis is unavailable.

**To clear this blocker:**
1. Provision Upstash Redis and size it for measured traffic.
2. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel →
   Production environment.
3. Redeploy. Confirm `/api/admin/stats` → `rateLimiterMode` = `distributed`.
4. Confirm `/api/admin/rate-limit-health` → `healthy: true` on the deployed instances;
   test outage/recovery and configure an external alert.

---

## 4. Strongly advised before mainnet

Not strictly blocking, but each is a real operational risk.

### 4.1 Institution business continuity — **self-service shipped; mainnet rule proposed**

Institutions no longer depend on a single point of contact by default (#307,
[ADR 0006](./decisions/0006-institution-member-continuity.md)):

- **Self-service team management.** An institution's owners invite, re-role
  and remove members from **Team** in the console (`/dashboard/team`) with no
  Acredia admin. Roles: owner, issuer, viewer. Invitations go straight to the
  invitee's inbox and are never shown to the inviter.
- **The last owner, or the last member who can issue, cannot be removed or
  demoted.** A database function enforces this inside one locked transaction.
  Account erasure is the one path that cannot be blocked; it asks the last
  issuer for explicit confirmation and is audited.
- **Visible risk.** A persistent console banner shows while fewer than two
  members can issue; the first owner is prompted to invite a second member on
  activation; admins get a continuity-risk list fed by live membership and the
  erasure audit signal.
- Erasing one member no longer suspends an institution others can still run.

**Proposed for mainnet** (ADR 0006 §4, awaiting acceptance): Acredia does not
authorize an institution's wallet on mainnet until it has two active members
with issuing rights, unless an exception is recorded in the authorization
request.

**Not covered by Acredia:** issuing also needs the institution's Stellar
wallet, which a second member must be able to sign with. That custody is the
institution's own responsibility.

### 4.2 Incident response — **plan adopted; staffing and tooling pending**

The plan is in [docs/ops/incident-response.md](./ops/incident-response.md)
(#306). It decides:

- **Roles and on-call**: Incident Commander, owner-key holders,
  communications lead and scribe; a weekly primary/secondary rotation with a
  defined escalation path. The roster lives in the internal security registry,
  alongside the owner-key holders, not in this public repo.
- **Severity levels** SEV1–SEV4, grounded in this product: owner key
  compromise and a fraudulent issuer are SEV1; verification outages and
  credentials nearing on-chain expiry are SEV2.
- **The emergency levers and who may pull them**, including an explicit
  `pause()` decision path: the IC and one owner-key holder decide; two holders
  sign on mainnet. Pause blocks issuance **and revocation** but not owner
  governance, so it is the wrong tool against a single fraudulent issuer or a
  compromised owner key. Four new contract tests lock that behaviour in.
- **User communication**: a pinned GitHub `incident` issue as the public
  record until a status page exists, direct email to institutions, and stated
  update cadences and promises.
- **Post-incident review**: blameless, within five business days, under
  `docs/incidents/`.

A first desk-check exercise ([fraudulent issuer](./incidents/exercises/2026-10-17-fraudulent-issuer-tabletop.md))
ran the plan against the code. It fixed a misleading `pause()` doc comment and
the raw error institutions saw while paused, and recorded the open gaps below.

**Remaining before mainnet** (plan §11): on-call roster recorded; a paging
tool wired to the runbook and keeper alerts; on-chain event monitoring for
owner events; a hosting decision for the indexer; a private security-report
channel in `SECURITY.md`; a status page; and a tabletop with the real on-call
team.

### 4.3 Stellar SDK upgrade — **completed (17.x)**

`@stellar/stellar-sdk` is upgraded to `^17.1.0` (#301).
- **Compatibility Verified**: All contract invocation, server-side simulation (`simulateRead` / `simulate`), and verification routines in `contracts.ts` and `contractReads.ts` were audited against the 17.x Soroban RPC interfaces.
- **Defensive Workarounds Documented & Tested**: Retained defensive type guards and multi-shape return value parsing (`getSorobanTransactionResult`) with comprehensive unit test coverage (`tests/contracts.test.ts`) to ensure resilience across divergent RPC node versions and test fixtures.
- **Test Suite**: All unit and integration test suites pass with `@stellar/stellar-sdk` 17.x.

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
