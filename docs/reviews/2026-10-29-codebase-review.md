# Acredia — Codebase, UX & Mainnet-Readiness Review

**Date:** 29 October 2026
**Commit reviewed:** `5ca19ba` (`main`)
**Scope:** `frontend/` (Next.js app, API routes, Supabase schema, workers), `contracts/` (Soroban), CI, docs, and repo hygiene
**Reviewer stance:** senior engineer / mentor. This is an honest review. It says plainly what is good and what is not, and it is ordered so the team can work through it step by step.

---

## 0. How to read this document

- **Section 1** is the summary: the verdict, a scorecard, and the five things to do first.
- **Section 2** lists what is already good. Keep doing those things.
- **Sections 3–8** are the findings, grouped by priority:
  - **P0** — fix before mainnet. These are security, correctness, or "real users will see the wrong network" problems.
  - **P1** — the first-visit experience and UX problems you described.
  - **P2** — code quality, structure, and maintainability.
  - **P3** — docs and repo hygiene.
- **Section 9** proposes a target structure and engineering standards.
- **Section 10** is a phased plan you can turn into GitHub issues.

Every finding has the same shape: **what**, **where** (file and line), **why it matters**, **fix**, and **done when** (how to verify the fix).

### How this review was done

| Check | Result |
|---|---|
| `npm ci` | ✅ installs (2 deprecation warnings from transitive deps) |
| `eslint .` | ✅ 0 errors |
| `tsc --noEmit` | ✅ 0 errors |
| `vitest run` | ✅ **83 files, 796 tests, all passing** |
| `next build` | ✅ builds. ⚠️ Deprecation warnings: `middleware` → `proxy`, Edge Runtime |
| `prettier --check src` | ❌ **132 files** not formatted |
| `npm audit --omit=dev` | ❌ **22 vulnerabilities: 1 critical, 13 high, 5 moderate, 3 low** |
| Per-route client JS (from the build manifests) | ❌ **~1.3–1.4 MB raw JS on every route**, including the static legal pages |
| Contract | Read the public API, storage, auth, and upgrade paths. 91 unit tests + property tests exist. `cargo` was not run in this review. |
| Database | Read `schema.sql` (the generated file), the RLS policies, and `seed.sql` |

**Coverage, stated plainly.** The core files were read in full: the layouts, providers, contexts, marketing pages, auth, the console shell, the issuance, issued-list and student-list components, verification, security headers, runtime config, the main API routes, RLS, and the contract core. The remaining ~290 source files were covered by targeted scans: hardcoded colours, testnet strings, native dialogs, nested interactive elements, unused modules, route validation, rate limiting, and file size. The app was **not** exercised in a real browser (no Lighthouse or Playwright run). The UX findings come from reading the rendered markup and the loading and state logic. Before you start the P1 work, run Lighthouse on `/`, `/verify` and `/dashboard` to get baseline numbers.

---

## 1. Executive summary

### The honest verdict

This codebase is **better than most open-source projects at this stage in some ways, and not yet production-grade in others.**

The **backend thinking is strong**. The verification route cross-checks the database against the chain and IPFS. Revocation is `chain OR db`, so the database cannot be used to "un-revoke" a credential. The contract has two-step ownership and an upgrade timelock. Rate limiting is nearly universal, runtime config fails fast on mainnet misconfiguration, and the RLS is thorough with only a few gaps. The test count is high. Many PRs clearly came from people who understood the problem.

The **frontend architecture is where the project falls behind industry standard**, and it is the direct cause of the "first visit feels bad" problem:

1. **Everything is client-rendered, and everything carries the wallet stack.** 30 of 35 pages are `'use client'`. The root layout mounts the Stellar wallet kit, the Stellar SDK and Supabase for *every* route, so the Privacy Policy page downloads WalletConnect.
2. **Auth runs entirely in the browser.** Opening `/dashboard` runs a chain of client requests (session, then role, then profile, then data) and shows up to **five different loading screens** in sequence.
3. **Contributors have each built the UI their own way.** Each component handles fetching, auth headers, toasts, dialogs and layout differently, and 132 files are not formatted. It reads like 40 authors, because it was written by 40 authors.

There are also **several real mainnet blockers** that are easy to miss because tests pass:

- hardcoded testnet explorer links,
- an RLS gap that lets a student take over another student's wallet linkage,
- test-only code shipped in the production bundle,
- a **critical Next.js advisory** that affects a feature this app uses.

None of this is unusual or embarrassing for a fast-moving open-source project. It is all fixable in roughly **4–6 focused weeks**. Do it **before** mainnet. After launch, every one of these fixes gets more expensive.

### Scorecard

| Area | Grade | One-line reason |
|---|---|---|
| Smart contract | **B+** | Solid auth, timelock, errors, and tests. Needs module split, `overflow-checks`, and removal of the legacy path. |
| API / backend logic | **B** | Consistent envelope, rate limiting, chain-anchored verification. Uneven input validation. |
| Database / RLS | **B−** | Thorough policies, but one column-level gap is exploitable. Clients can write the credential mirror. `seed.sql` is broken. |
| Security posture | **C+** | Good CSP and headers work, undermined by a critical dependency CVE, E2E backdoor code, and the RLS gap. |
| Frontend architecture | **D+** | All-client rendering, global wallet providers, client-only auth, no data layer. |
| First-load performance | **D** | ~1.3–1.4 MB JS per route. All pages dynamic. Content hidden behind animations. |
| UX consistency | **C−** | Good design tokens, inconsistent patterns (alert vs toast vs dialog, card vs table, five loaders). |
| Accessibility | **C+** | Good intent (axe tests, labels, reduced motion). Real gaps: nested interactive elements, unlabeled inputs, no focus traps. |
| Code hygiene | **C** | Lint and types are clean. Formatting is not enforced. Dead code and deps. God components. |
| Tests | **B** | 796 passing tests. Good unit coverage of `lib/`. Thin on UI flows. No perf budgets. |
| Docs | **C+** | Rich, but a 1,400-line README, broken references, and stale "planned" statements. |

### Do these five things first

1. **Upgrade `next`** (critical RCE advisory in `next/og` `ImageResponse`, which this app uses in `credentials/[token]/opengraph-image.tsx`) and resolve the high-severity `npm audit` items. → §3.1
2. **Close the `students` RLS column gap** and **stop the client from writing `wallet_address`**. → §3.2, §3.3
3. **Remove every hardcoded `testnet` URL** and route all explorer links through `runtimeConfig.stellar.explorerBaseUrl`. → §3.4
4. **Move `StellarProvider` out of the root layout** and load the wallet kit only inside the consoles and `/claim`. This one change probably removes ~1 MB from every marketing page. → §4.1
5. **Move auth to cookie-based sessions with `@supabase/ssr`** and check access on the server. This removes the loading waterfall and the "admin console flashes for a student" bug. → §4.4

---

## 2. What's genuinely good — keep it

These are now written into [`CONTRIBUTING.md` → Engineering Standards](../../CONTRIBUTING.md#engineering-standards) as the standard every new PR is held to.

- ~~**Verification is designed correctly.**~~ **Correction (2026-10-30): this was wrong.** The *design* of [`api/verify/[token]/route.ts`](../../frontend/src/app/api/verify/%5Btoken%5D/route.ts) is right (re-hash the metadata, compare it with the on-chain hash, treat revocation as chain-or-database). But the values it calls "on-chain" come from `contractReads.getCredential`, `isRevoked` and `isAuthorizedIssuer`, which **read the database first** and only fall back to the chain when no row exists. The "on-chain hash" is the database's `blockchain_hash`, which stores the *transaction* hash. Issuer authorization is never read from the contract. So editing a credential row *can* make it verify. This is fixed as part of §3.11b: verification reads the contract directly.
- **Runtime config fails fast.** [`runtimeConfig.ts`](../../frontend/src/lib/runtimeConfig.ts) refuses known testnet contract IDs on mainnet, requires an explicit network in production, and blocks secrets from `NEXT_PUBLIC_*`. This is mature work.
- **The contract has the right governance primitives:** two-step `transfer_owner`/`accept_owner`, a timelocked `propose_upgrade`/`upgrade`, `pause`, typed `ContractError`, bounded batch size with the reason documented, and TTL management. There are 91 tests plus `proptest` invariants.
- **Rate limiting** is applied to almost every API route, including per-user quotas on email-sending routes.
- **The CSP uses a per-request nonce with `strict-dynamic`**, and there is no `unsafe-eval` in production.
- **The wallet boundary is enforced by lint.** ESLint `no-restricted-imports` stops anyone importing a wallet library outside `src/lib/wallet/`. This is exactly how architectural rules should be protected.
- **The design tokens are real.** Colours are semantic tokens in `globals.css`, and only ~52 hardcoded palette classes remain, concentrated in 8 files.
- **Decision records** (`docs/decisions/`) and ops runbooks exist. Most projects never write these.
- **The CI pins actions to SHAs** and runs Gitleaks, CodeQL, dependency review, `cargo audit`, and `cargo deny`.

---

## 3. P0 — Fix before mainnet

### 3.1 Critical and high dependency vulnerabilities

**What.** `npm audit --omit=dev` reports 22 issues. The ones that matter:

| Package | Severity | Note |
|---|---|---|
| `next` (direct) | **critical ×3** | Three separate remote-code-execution advisories: `next/og` `ImageResponse` (used here in [`credentials/[token]/opengraph-image.tsx`](../../frontend/src/app/credentials/%5Btoken%5D/opengraph-image.tsx)), Image Optimization with SVG files, and `use cache` functions returning typed arrays. Plus SSRF in image optimization, DoS via Server Actions, and several cache-poisoning and information-disclosure advisories. All fixed in `16.4.3`. |
| `zod` (direct) | high | Memory exhaustion on oversized constrained collections. Every API route that validates user input is exposed. |
| `@creit.tech/stellar-wallets-kit` → `@reown/*`, `@coinbase/cdp-sdk` | high | Transitive, through WalletConnect/AppKit. |
| `sharp`, `follow-redirects`, `source-map-js` | high | Transitive. |

**Fix.**
1. `npm i next@latest eslint-config-next@latest`. At the time of writing, `16.4.3` is published and the lockfile has `16.3.3`. Re-run `npm audit`.
2. `npm i zod@latest`.
3. Check whether a newer `stellar-wallets-kit` fixes the `@reown` chain. If not, add `overrides` for the patched transitive versions, or open an upstream issue and document the accepted risk in `SECURITY.md`.
4. Add `npm audit --omit=dev --audit-level=high` as a **blocking** CI step. `dependency-review.yml` only checks *new* dependencies in a PR, not the ones already in the lockfile.

**Done when** `npm audit --omit=dev --audit-level=high` exits 0, or every remaining item is listed with a justification in `SECURITY.md`.

> **Status (2026-10-29): done, committed 2026-10-30.** `next` → 16.4.3, `eslint-config-next` → 16.4.3, `zod` → 4.6.7; `follow-redirects` → 1.16.1 and `source-map-js` → 1.2.2 via lockfile only. CI now blocks on critical. The 18 remaining items all come from the wallet kit and are documented under "Dependency Audit — 2026-10-29" in `SECURITY.md`.

---

### 3.2 RLS: students can rewrite security-relevant columns on their own row

**Where.** [`supabase/schema.sql` ~L2401](../../frontend/supabase/schema.sql), policy `"Students can update own data"`:

```sql
CREATE POLICY "Students can update own data"
  ON public.students FOR UPDATE
  USING (auth.uid() = auth_user_id)
  WITH CHECK (auth.uid() = auth_user_id);
```

There is no column restriction (no `GRANT UPDATE (col, …)`), and no trigger on `students`. Any signed-in student can therefore use the anon key to update their own `institution_id`, `status`, `student_ref`, `email` and `wallet_address`.

**Why it matters.** This is exploitable:

- Issuance links a credential to a student by wallet. [`credentialService.ts` ~L166](../../frontend/src/lib/credentialService.ts) does `students.select('id').eq('wallet_address', data.studentWallet)`, and [`batchCredentialService.ts` ~L143](../../frontend/src/lib/batchCredentialService.ts) does the same.
- `wallet_address` is `UNIQUE`. A student can set their row's `wallet_address` to **another student's address before that student links it**. Credentials later issued to that address get the attacker's `student_id` and appear in the attacker's dashboard, including name, degree, GPA and the document link. On-chain ownership is unaffected, but the privacy and data-integrity breach is real.
- A deactivated student can set `status = 'active'`. A student can move themselves into another institution's roster by changing `institution_id`, and they then appear in that institution's Students page.

**Fix.** Add a migration that does one of the following:

```sql
-- Option A (preferred): students may only touch harmless profile fields
REVOKE UPDATE ON public.students FROM authenticated;
GRANT UPDATE (name) ON public.students TO authenticated;   -- whatever is truly self-editable
```

or a `BEFORE UPDATE` trigger that rejects changes to `institution_id`, `status`, `student_ref`, `email` and `wallet_address` unless `current_setting('role') = 'service_role'` or `public.is_admin()`. Wallet linking then happens **only** through the signed-challenge flow that already exists for `/claim` (`/api/claim/*`), via a server route.

**Done when** a Vitest/pgTAP test signs in as a student with the anon key, attempts each forbidden column update, and every attempt is rejected. Add it to `tests/sqlMigrations.test.ts` or a new `tests/rls.students.test.ts`.

> **Status (2026-10-29): done, committed 2026-10-30. Scope was wider than first described.** Reproducing the attack on real Postgres showed that issuer-role **staff** could also write `students` directly. A staff member could link an unclaimed student's row to their own login (identity takeover) and insert students with no validation and no audit log. No application code writes `students` through the `authenticated` role (every API route uses the service role), so migration `20261029000000_lock_down_student_writes.sql` **drops all four direct-write policies** (student update, institution insert, institution update, admin update) and **revokes `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`** from `anon` and `authenticated`. Read policies are unchanged.
>
> Tests: `npm run test:rls` runs 31 tests against a real Postgres 16 with `schema.sql` applied (applied twice, to prove it is idempotent). The same tests run in CI as the `rls-tests` job. Run against the pre-fix schema, 20 of them fail, each one an attack succeeding. Docker-free guards in `tests/sqlMigrations.test.ts` stop a later migration from re-opening writes.
>
> **The migration still has to be applied to the production Supabase project.**

---

### 3.3 The student dashboard silently overwrites `wallet_address` on every load

**Where.** [`StudentCredentialsList.tsx` L104–108](../../frontend/src/components/student/StudentCredentialsList.tsx):

```ts
if (studentWallet) {
    await supabase.from('students').update({ wallet_address: studentWallet }).eq('auth_user_id', studentId);
}
```

**Why it matters.** Every time a student opens "My credentials" with *any* wallet connected, that wallet becomes their registered address. There is no ownership proof and no confirmation, and the error is ignored. A student who connects a second wallet, or a friend's wallet on a shared computer, silently breaks their own linkage. This is the "accidental" version of §3.2, and it will happen in production.

**Fix.** Delete this block. Wallet linking must be an explicit, signed, server-side action ("Link this wallet", then sign a challenge, then the server verifies and writes). Also delete the unused `dbHelpers`/`authHelpers` in [`lib/supabase.ts` L148+](../../frontend/src/lib/supabase.ts), which contain more client-side wallet writes.

> **Status (2026-10-29): done, committed 2026-10-30.** The write and the `studentWallet` prop are removed, and `dbHelpers`/`authHelpers` (~210 unused lines, including client-side writes to `students`, `institutions` and `credentials`) are deleted. **Decision:** a student's wallet is recorded by their institution (roster API, audited) or the signed `/claim` flow. Secure self-service linking by a signed-in student is deferred to Phase 3 (see §10). The three student messages that promised the old behaviour were corrected: "connect to view your credentials" was removed (the list never needed a wallet), and the Wallet shortcut now says "To change that wallet, ask your institution."
>
> Tests: `tests/studentWalletWrites.test.tsx` fails if any code outside `src/app/api/` writes to `students`, includes a self-check that it would have caught the removed write, and renders the overview to check the copy. `tests/adminSetup.test.ts` now asserts that the helpers stay gone. Run against the original code, all four of these tests fail.

---

### 3.4 Hardcoded testnet URLs will be wrong on mainnet

**Where.**
- [`app/issuers/page.tsx` L18–19](../../frontend/src/app/issuers/page.tsx): `https://stellar.expert/explorer/testnet/...`
- [`IssuedCredentialsList.tsx` L439](../../frontend/src/components/institution/IssuedCredentialsList.tsx)
- [`StudentCredentialsList.tsx` L359](../../frontend/src/components/student/StudentCredentialsList.tsx)
- [`lib/stellar.ts` L49–55](../../frontend/src/lib/stellar.ts): `getExplorerTxUrl`/`getExplorerAddressUrl` build URLs from `networkName`, not `explorerBaseUrl`, so a `custom` network produces `/explorer/custom/...`.

**Why it matters.** On mainnet day, every "View transaction" link in the issuer registry and both dashboards opens a "not found" page on the testnet explorer. For a product built on "verify it yourself on-chain", that is a trust-destroying bug.

**Fix.**
1. Make `getExplorerTxUrl`/`getExplorerAddressUrl` use `activeNetwork.explorerBaseUrl`.
2. Replace the three hardcoded strings with those helpers.
3. Delete `STELLAR_CONFIG` in `lib/stellar.ts`. Its `testnet` and `mainnet` entries are identical and misleading.
4. Add a lint guard (`no-restricted-syntax` on string literals matching `/explorer\/testnet|horizon-testnet|soroban-testnet/` outside `runtimeConfig.ts`) so this cannot come back.

**Done when** `grep -rn "explorer/testnet" frontend/src` returns only `runtimeConfig.ts`, and a unit test asserts that the helpers honour `explorerBaseUrl`.

---

### 3.5 E2E test mode can be switched on in production

**Where.** [`lib/e2e.ts` L86](../../frontend/src/lib/e2e.ts). `getE2eState()` returns `window.__ACREDIA_E2E__` whenever it exists, and it is checked in 11 production files. Among them: [`AuthContext.tsx`](../../frontend/src/contexts/AuthContext.tsx) (injects a fake session and role), [`StellarContext.tsx`](../../frontend/src/contexts/StellarContext.tsx) (fake signer), `credentialService.ts` (fake issuance), and `CredentialClientView.tsx` (renders a fake "verified" credential).

**Why it matters.** Anyone can type `window.__ACREDIA_E2E__ = {enabled: true, …}` into devtools on production and get a pixel-perfect "Verified" page for a credential that does not exist. Server APIs still reject the fake session, so this is **not** a server breach. But it hands fraudsters a convenient forgery tool for screenshots, it ships dead test code to every user, and it is the kind of thing an external auditor will flag immediately.

**Fix.** Gate it at build time so the bundler removes the code:

```ts
export function getE2eState(): E2eState | null {
    if (process.env.NEXT_PUBLIC_E2E !== 'true') return null;   // constant-folded in prod builds
    if (typeof window === 'undefined') return null;
    return window.__ACREDIA_E2E__ ?? null;
}
```

Set `NEXT_PUBLIC_E2E=true` only in `playwright.config.ts` `webServer.env`. Longer term, replace the in-app branches with network-level mocks: Playwright `page.route()` or MSW. Production code should not know that tests exist.

**Done when** `grep -c "__ACREDIA_E2E__" .next/static/chunks/*.js` returns 0 for a production build.

---

### 3.6 The credential mirror table is written by the browser

**Where.** [`credentialService.ts` ~L166–180](../../frontend/src/lib/credentialService.ts) inserts into `credentials` from the client after the on-chain transaction. RLS (`"Institutions can insert credentials"` and `"Institutions can update own credentials"`) lets any issuer-role member insert or update **any column** of their institution's rows.

**Why it matters.**
- Verification is safe (see §2), but **dashboards, the public credential page's `<title>`, and the OpenGraph preview** read DB `metadata` directly. An institution member, or a compromised member account, can make LinkedIn previews show a degree that the chain does not back.
- If the tab closes between the on-chain transaction and the DB insert, the chain and the DB diverge. The new indexer (`scripts/indexer.ts`) can reconcile this, but only if it is actually deployed (see §7.3).

**Fix (target architecture).** The chain is the source of truth and the DB is a **read model** written only by the server.
1. The client signs and submits the transaction, then `POST /api/institution/credentials/confirm { txHash }`.
2. The server fetches the transaction from RPC, decodes the `cred_iss` event, checks that the issuer matches the caller's institution wallet, and inserts the row with the service role.
3. The indexer backfills anything the confirm call missed.
4. Remove the `INSERT`/`UPDATE` RLS policies on `credentials` for `authenticated`.

---

### 3.7 CSP: leftover domains, and custom networks are blocked

**Where.** [`lib/securityHeaders.ts` L52–63](../../frontend/src/lib/securityHeaders.ts).

- `img-src` allows `tse1/3/4.mm.bing.net`, `www.scholarshipregion.com` and `res.cloudinary.com`. None of them are used. They are leftovers from someone's demo images, and every allowed origin is attack surface.
- `connect-src` hardcodes the testnet and mainnet Horizon/RPC hosts. If `NEXT_PUBLIC_STELLAR_NETWORK=custom` (or you move to a paid RPC provider for mainnet, which you should), the CSP silently blocks every contract read.

**Fix.** Build `connect-src` from `runtimeConfig.stellar.horizonUrl`, `runtimeConfig.stellar.sorobanRpcUrl`, the Supabase URL and the IPFS gateway, then add the WalletConnect hosts. Delete the unused `img-src` and `media-src` entries, and the matching `images.remotePatterns` in `next.config.ts`.

> **Done 2026-10-30, committed.**
> - `connect-src` is built from `runtimeConfig`: the exact Supabase origin (https and wss) and the active network's Horizon and RPC origins only, so a mainnet build no longer trusts testnet endpoints. WalletConnect hosts are kept.
> - The bing, scholarshipregion, Cloudinary and Pinata/IPFS domains are removed, `media-src` is `'self'`, and `images.remotePatterns` is gone.
> - The lint guard's exemption for `securityHeaders.ts` is removed. Tests cover the new policy.

---

### 3.8 Contract: pre-mainnet items

[`contracts/src/lib.rs`](../../contracts/src/lib.rs), [`Cargo.toml`](../../contracts/Cargo.toml).

| # | Item | Why | Fix |
|---|---|---|---|
| a | `overflow-checks = false` in `[profile.release]` (Cargo.toml L32) | Stellar's own examples ship with overflow checks **on**. The cost is negligible, and `token_id + 1` and `current + 1` should trap rather than wrap. | Set `overflow-checks = true`. |
| b | `#[allow(deprecated)]` on the whole `impl` (L268) | It hides every deprecation, not just `events().publish`. | Migrate to `#[contractevent]` typed events. Remove the blanket allow. |
| c | Legacy instance-storage authorization fallback in `check_and_extend_authorization` | Only needed for the old testnet deployment. A **fresh mainnet deploy** never has instance-stored issuers, so it is dead code, extra gas, and extra audit surface. | Remove it for the mainnet build (or behind a feature flag). |
| d | `require_initialized` uses `panic!("ContractError({})")` | Clients get an opaque host error instead of a typed one. | Use `panic_with_error!(env, ContractError::NotInitialized)`. |
| e | `authorize_issuer`/`revoke_issuer` return `()` | They are inconsistent with the rest of the API and cannot signal "already authorized". | Return `Result<(), ContractError>`. |
| f | Read-only getters (`get_owner`, `get_issuer_profile`) extend TTL | View calls become write-footprint operations. Not dangerous, but surprising. | Leave TTL bumps to the `bump_credential` keeper and write paths. |
| g | One 3,199-line file (977 lines of contract + ~2,200 lines of tests) | Hard to review and hard to audit. | Split into `lib.rs`, `errors.rs`, `storage.rs`, `events.rs`, `admin.rs`, `issuance.rs`, `upgrade.rs`, and `tests/`. |
| h | Owner key | The docs recommend 2-of-3 multisig, which is good. | **Verify** that the mainnet owner is a multisig account *before* `initialize`, and record the account in `docs/deployments/`. |
| i | **No `__constructor`** (added 2026-10-29; missed in the first pass) | Deploy and `initialize` are separate transactions, so the owner can be front-run. `SECURITY_AUDIT.md` F-1 and the 2026-10-02 deployment record both require a constructor before mainnet. | Set the owner in `__constructor` at deploy time. Remove `initialize` or make it unreachable. |

> **Update (2026-10-29).** The testnet owner key for `CD7WU5…` was lost, so that contract can no longer authorize issuers, pause or upgrade, and a fresh testnet deploy is required. Decisions: (1) make the contract changes above **before** that redeploy, so testnet is reset only once; (2) the new owner is a **multisig account even on testnet**, to rehearse the mainnet procedure; (3) add **optional credential expiry** to the contract (product request), with matching indexer, verify-route and UI changes. Order: after §3.10.

**Done when** the third-party audit referenced in `THIRD_PARTY_AUDIT.md` is run against the post-cleanup code, not the current code.

---

### 3.9 Anyone can call internal database functions through the public RPC endpoint

*Found on 2026-10-29 by the real-database tests added for §3.2. Scheduled right after §3.3.*

**What.** Supabase grants `EXECUTE` on every new `public` function to `anon` and `authenticated` by default. Several migrations run only `REVOKE ALL ON FUNCTION … FROM PUBLIC`, which does **not** remove those per-role grants. Checked against `schema.sql` on Postgres 16 with Supabase's default privileges:

| Function | `anon` / `authenticated` can call it | Intended caller |
|---|---|---|
| `next_job(text, text)` | yes | email worker only |
| `process_erasure(uuid)` | yes | service role only (its own comment says so) |
| `run_retention_purge()`, `purge_old_verification_logs()`, `purge_old_contact_messages()` | yes | cron only |
| `retention_status()` | yes | admin only |
| `request_erasure()` | yes | probably intended for signed-in users; confirm |
| `claim_ttl_keeper_lock`, `release_ttl_keeper_lock`, `change_institution_member` | **no**, correctly revoked from `anon, authenticated` | |

The last row shows the correct pattern is already known in this codebase. The older functions missed it.

**Why it matters.** All of these are `SECURITY DEFINER`, so they run with the owner's rights. Anyone, even logged out, can call `POST /rest/v1/rpc/next_job` with `{"queue_name":"send_email"}` and:
- receive queued email jobs, which contain **student email addresses, names and institution names**;
- mark them `processing`, so the real worker skips them and **notification emails are silently never sent**.

The purge functions can also be triggered by anyone. They only delete data past its retention window, so the impact is lower.

**Fix.** A migration that runs `REVOKE EXECUTE ON FUNCTION … FROM anon, authenticated` for each internal function, keeping `service_role`. Decide deliberately for `request_erasure()` and `is_admin()`. Add real-database tests asserting `has_function_privilege(...)` for every `SECURITY DEFINER` function, so new functions can't miss it.

**Verify on the real project** in the Supabase SQL editor before and after:
```sql
SELECT p.oid::regprocedure,
       has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prosecdef
ORDER BY 1;
```

> **Status (2026-10-29): done, committed 2026-10-30.** Applying it to production is tracked in the redeploy runbook. Migration `20261029010000_lock_down_function_execute.sql`:
> 1. **Revokes `EXECUTE`** from `PUBLIC`, `anon` and `authenticated` on `next_job`, `process_erasure`, `run_retention_purge`, both `purge_old_*`, `retention_status` and `request_erasure` (unused by the app; erasure goes through the API route only). It grants them explicitly to `service_role`. Every real caller uses the service role, and `pg_cron` runs as the owner.
> 2. **Keeps the three RLS policy helpers** (`is_admin`, `user_institution_ids`, `user_issuer_institution_ids`) executable by `anon`/`authenticated`, now through explicit grants. They are evaluated inside 34 policies on 15 tables, with the querying user's privileges. Revoking `is_admin` from `anon` was shown to break the public issuer registry with "permission denied for function is_admin".
> 3. **Changes the defaults**, so new functions created by `postgres` (migrations, the SQL editor) are not client-executable. This includes Postgres's global `PUBLIC` default, without which the per-role revoke would have no effect. A future function that clients or policies must call needs an explicit `GRANT` plus an allowlist entry in `tests/rls/functions.rls.test.ts`.
> 4. **Fixes a side finding:** `user_institution_ids(p_user_id)` and `user_issuer_institution_ids(p_user_id)` accepted any user id, so anyone could look up another user's institution memberships by UUID. They now answer only for the caller, unless called by the service role or a direct database session. Policies call them with no argument, so policy behaviour is unchanged (the full students RLS suite passes against the new helpers).
>
> Trigger functions were deliberately left alone. Postgres refuses to call them directly, and a test proves that a trigger function the firing user cannot `EXECUTE` still fires.
>
> Tests: 44 new real-database tests in `tests/rls/functions.rls.test.ts`. Run against the schema without this migration, 24 of them fail, one per security property. The fast guards in `tests/sqlMigrations.test.ts` were checked against fake later migrations: each regression is caught by the right guard, and comment-only text is ignored.

### 3.10 "Delete my account" (GDPR erasure) fails for every user

*Found on 2026-10-29 by the real-database tests added for §3.2. Scheduled after §3.9.*

**What.** `process_erasure()` redacts by setting `profiles.email`, `students.email` and `institutions.email` to `NULL`, but all three columns are `NOT NULL`. Every user has a `profiles` row, so the function fails for **every** user with `null value in column "email" … violates not-null constraint`. This was confirmed against the `HEAD` schema, before any change from this review.

**Why it matters.**
- The privacy policy promises erasure, and it never succeeds.
- `/api/account/erase` **unpins the user's IPFS files (step 3) before the database scrub fails (step 4)**, so each attempt leaves a half-done erasure. The request is marked `failed` and the user is told to contact support.
- The existing unit test (`gdprErasure.test.ts`) uses a fake Supabase client, so it could not catch this.

**Fix.** Redact to non-null placeholders (for example a unique `erased+<id>@invalid` address, since `email` is also `UNIQUE`), or relax the constraints deliberately. Move the IPFS unpin to *after* a successful scrub. Replace the pinned known-bug test in `tests/rls/students.rls.test.ts` with one that asserts successful redaction.

> **Status (2026-10-29): done, committed 2026-10-30. Applying it to production is tracked in the redeploy runbook. The fix changed direction during investigation.** The code contradicted what users are told: the Delete screen and the privacy policy promise account-level deletion with credentials retained, but `process_erasure()` redacted the student's credential data (so verification would show a forged-looking "mismatch") and renamed the user's *institution* to `[deleted]`. Also, deleting the account cascaded away the 7-year erasure record and the staff member's membership history. Decisions:
> - **Account-only erasure.** Login, profile and preferences are deleted, and the roster record is unlinked. Roster records, credentials and institutions are retained; the institution is the data controller for them.
> - **Only students self-serve.** `/api/account/erase` refuses anyone with an institution or admin tie (403 `self_deletion_not_available`, failing closed if the lookup errors). Their Settings screen shows "Request account removal" instead, handled through the existing POC handover and Team tools (`docs/support-procedures.md` §4, with its SQL proven in tests).
> - **Records outlive the account.** `erasure_requests` no longer references `auth.users`. `institution_users.auth_user_id` is `ON DELETE SET NULL`, with a trigger that deactivates the membership, so a deleted account never lingers as a nameless "active" member counted as an issuer.
> - The IPFS unpin is gone from the route. Credential documents stay with the credential.
>
> Migration `20261029020000_fix_account_erasure.sql`. Docs: `data-model.md` erasure sections corrected; one privacy-policy sentence and its "Last updated" date changed (**counsel should review**). Side effect: the admin page's `memberLossAt` field is no longer filled by erasures (live continuity still shows whether an institution can issue).
>
> Tests: 21 real-database erasure tests, 89 RLS tests in all, stable across shuffled runs. Without the migration, 13 fail; without only the new trigger, the two "no ghost member" tests fail. 12 route tests (8 fail on the original route) and 6 Settings-screen tests (4 fail on the original screen).

### 3.11 Credential documents and metadata are unencrypted on public IPFS

*Found on 2026-10-29 while investigating §3.10. Scheduled next, before the contract redeploy.*

**What.** `pinFileToPinata` and `pinJsonToPinata` (`src/lib/ipfsServer.ts`) upload the diploma file and the credential JSON (student name, degree, GPA, subject marks, wallet) **as plain content**. `encryptBufferAESGCM` exists but is never called. Each credential's IPFS URI is stored on-chain, where anyone can read it, so anyone can enumerate the contract and download every student's documents and grades from a public IPFS gateway. `docs/legal/data-model.md` stated these were encrypted with AES-256-GCM; a correction note has been added there.

**Why it matters.** It's a privacy exposure of every issued credential, and the legal documentation described the opposite. It also undercuts the argument that the on-chain hash is not personal data. It must be settled before the contract redeploy, because the design decides whether the contract should keep a public IPFS pointer at all.

**Next step.** A design discussion, not code. Options include encrypting with a server-held key (the verify route decrypts), keeping documents off public IPFS altogether, or holding only a hash on-chain. Each option affects verification, the indexer, pin-keeping and the contract. Counsel should review the result.

**Decision (2026-10-30).** Keep documents off public IPFS altogether and hold only the credential hash on-chain:
- The document goes to a **private** Supabase Storage bucket, `credential-documents`. It is only ever served through short-lived signed URLs, to the holder, the issuing institution, and someone holding the share link.
- The credential JSON records the document's SHA-256 as its evidence id (`urn:sha256:<hex>`). The on-chain hash covers the evidence id, so it anchors the document without publishing it.
- Each credential gets a random `share_token` (UUID). The public page is `/credentials/<share_token>`. Looking up a bare token ID shows status only: issuer, dates and valid, revoked or expired.
- Credentials can carry an optional, fixed expiry, enforced by the contract's `credential_status`.
- IPFS code is retired. The `credential_pins` table is kept for a later cleanup migration.

Delivered in three steps: **a** (issuance), **b** (verification and sharing), **c** (cleanup).

**3.11a — issuance. Done 2026-10-30, committed.**
- Migration `20261030000000_private_credential_documents.sql`:
  - adds `document_path`, `document_sha256` (checked as 64 lowercase hex characters), `expires_at` and `share_token` (unique, generated by default)
  - makes `ipfs_hash` nullable
  - drops the pin-registration trigger
  - creates the private bucket (10 MB; PDF, JPEG or PNG)
- New route `POST /api/institution/documents`. It is rate-limited, institution writers only, stores the file under a random name in the institution's folder, and never overwrites.
- Single and batch issuance no longer touch IPFS. Both send `expires_at` to the contract and store it. The issuance form and the CSV template gained an optional expiry date, entered as "valid through", in UTC.
- The E2E fake ledger now writes `ipfs_hash: null`, matching real issuance. Existing UI only shows an IPFS link when `ipfs_hash` is set, so new credentials show none.
- Tests:
  - 7 real-Postgres tests (bucket privacy, share tokens, digest check, trigger removal)
  - 10 route and helper tests
  - updated issuance tests, including two new expiry tests
  - every new assertion was proven by a targeted mutation
  - totals: 844 unit, 96 RLS, 37 Playwright; lint, types and build pass
- **Production:** this code calls the new contract interface (`expires_at`), so ship it together with the contract redeploy (see the runbook). Apply the migration first. It is safe under the old code, because the old code still writes `ipfs_hash`; the only effect is that new IPFS pins are no longer registered for the pin keeper.

**3.11b — verification and sharing. Done 2026-10-30, committed.**

*Status check by token ID.*
- `GET /api/verify/<tokenId>` and `/verify?token=` now show **status only**: issuer, issue and expiry dates, and valid, revoked or expired. Nothing about the holder is returned.
- Everything that decides the answer is read from the contract: `get_credential`, `is_revoked` and `is_authorized_issuer`. The database supplies only the institution's display name and which revocation event fired, and neither can change the result.
- A non-numeric token returns 400. A chain read failure returns 503, never a guess.
- `/docs/api` documents the new response. This is a breaking change for API-key integrators.

*Share link.*
- `/credentials/<share_token>` is served by `GET /api/credentials/share/<token>`.
- It re-hashes the stored credential and compares the result with the on-chain hash. It also checks that the credential names the on-chain holder.
- Only fields from the canonical payload are shown, because that is exactly what the hash covers. The raw row is never displayed: canonicalisation keeps only the date part of `<date>T<anything>`, so an edited `issueDate` would otherwise show under a matching hash.
- Content that doesn't match is withheld, with a "Details could not be verified" verdict.
- The page is `noindex`. Old `/credentials/<tokenId>` links redirect to the status check.

*Documents.*
- The share page downloads the document through a 5-minute signed URL and checks its SHA-256 in the viewer's browser against the anchored digest.
- Holders and the issuing institution get signed URLs from `GET /api/credentials/<id>/document`. Anyone else gets a 404 that doesn't reveal whether the credential exists.

*Links.*
- QR codes, copy-link, LinkedIn, the VC export's `verifyUrl` and notification emails all use the share link. This fixes N3 (§5.6 #5).
- Scanning or pasting a share link opens the share page. Pasting a status URL or an old showcase link runs the status check.

*Bugs found and fixed along the way:*
1. **Chain reads have never worked.** `contractReads` used the contract's C-address as the simulation source account. The SDK rejects that before any RPC call, so the "on-chain fallback" (#232) always threw and was swallowed. It now uses the SDK's `NULL_ACCOUNT`.
2. The not-found matcher looked for `Error(Contract, 4)`, but the RPC reports `Error(Contract, #4)`. An unknown token would have been reported as an outage.
3. The verification cache stored `bigint`s, which `JSON.stringify` rejects, so every cache write failed silently.
4. The fallback path read on-chain `issued_at` (seconds) as milliseconds.

*Tests and verification.*
- 939 unit tests, 40 Playwright tests, lint, types and build all pass.
- 33 mutants were each caught by a test.

*Follow-ups (not blocking):*
- The share page's social preview (`generateMetadata` and the OG image) still reads the database without a chain check. Fold it into the server-rendered loader (§5.6 #1).
- `/api/institution/credentials` selects `*`, which includes `share_token`; select explicit columns.
- **New finding (P1):** `/api/student/credentials` interpolates `search` into a PostgREST `.or()` filter string, so commas or parentheses in it can inject filter clauses. Escape the term or use separate `ilike` filters.

**3.11c — indexer and IPFS retirement. Done 2026-10-30, committed.**

*Indexer.*
- The indexer (`src/lib/indexerEvent.ts`) reads the contract's typed events by name: `credential_issued`, `credential_revoked`, `credential_revoked_by_owner`, `issuer_authorized` and `issuer_revoked`.
- Test events use the exact shapes recorded in `contracts/test_snapshots`.

*Bugs found and fixed:*
1. **The indexer destroyed credentials.** It upserted `metadata: {}` over the app's row and stored the credential hash as `blockchain_hash`. Now it only inserts what is missing. Issuance upserts on `token_id`, so whichever writes first, the app's content wins. Real-Postgres tests prove both orders, and that another institution cannot take over an index-only row.
2. **Admin authorization would have broken after the redeploy.** `adminAuthorizationVerification.ts` looked for the old `iss_auth` event with the wallet as data. It now expects `issuer_authorized` with the wallet as a topic. Re-authorizing an already-authorized wallet emits no event (§3.8), and the error message now says so.

*IPFS retired.*
- Removed: the `/api/ipfs/*` routes, `lib/ipfs.ts`, `lib/ipfsServer.ts`, `lib/pinKeeper.ts`, `worker/pinKeeper.ts`, their tests, the `worker:pin-keeper` script, and the Pinata and secondary-pinning config in `runtimeConfig`, `.env.local.example`, Playwright, CI and `next.config.ts`.
- Kept: the `credential_pins` table, until a later migration.

*Docs and copy.*
- Marketing pages corrected. The "impossible to lose" claim was dropped, because it is not true (see below).
- **Legal pages corrected (counsel review needed):** privacy policy, terms and DPA no longer claim encrypted IPFS storage, and Pinata is no longer a sub-processor.
- Also updated: `docs/legal/data-model.md`, README, architecture, the VC verification recipe, the ops runbook and incident response, CONTRIBUTING, the test plan and the mainnet checklist. `docs/ops/pin-redundancy.md` is now a retirement note.
- Current-behaviour docs use the new event names. ADRs 0004 and 0005 carry a note.

*Still open (raise before mainnet):*
- **Durability gap (P1, needs a decision).** If the database write fails after a successful chain issuance, the credential's content is lost: the database row is now its only copy, and the indexer can only restore a status-only row. Options:
  - save a pending row before signing and confirm it after
  - retry with a local recovery copy
  - accept the risk and document it
- The DPA's erasure wording now points to the Privacy Policy. Whether erasure under the DPA (controller instructions) should go further than account-only is for counsel.
- `frontend/supabase/seed.sql` is broken regardless of IPFS: it uses non-UUID ids and omits the required `institutions.email`.

---

## 4. P1 — First-visit experience and performance

This section answers "why does the site feel bad the first time I open it".

### 4.1 Every page downloads the whole wallet stack (~1.3–1.4 MB of JS)

**Measured** from the production build's client-reference manifests (raw, before compression):

| Route | Raw client JS |
|---|---|
| `/` (home) | ~1,430 KB |
| `/about` | ~1,440 KB |
| `/legal/privacy` (static text!) | ~1,303 KB |
| `/verify` | ~1,342 KB |
| `/auth/login` | ~1,324 KB |
| `/dashboard` | ~1,361 KB |

The largest shared chunks are the Stellar SDK (~600 KB), WalletConnect/Reown (~480 KB + ~400 KB), `html5-qrcode` (~360 KB) and `recharts` (~350 KB).

**Cause.** [`components/providers.tsx`](../../frontend/src/components/providers.tsx) wraps the **root layout** in `StellarProvider` and `AuthProvider`. `StellarProvider` imports `walletAdapter`, which imports the wallet kit, the SDK and WalletConnect. That puts all of it in every route's bundle.

**Fix.**
1. Root layout providers: only `MotionConfig` (or nothing) and `Toaster`.
2. Create `app/(console)/layout.tsx` for `/dashboard` and `/admin`, plus `/claim`, that mounts `StellarProvider`.
3. Inside `StellarProvider`, load the wallet kit lazily: `const { walletAdapter } = await import('@/lib/wallet')` on first `connect()` or `restore()`.
4. Load `html5-qrcode` with `dynamic(() => import(...), { ssr: false })`, only when the user clicks **Start scan**.
5. Load `recharts` with `dynamic()` on the analytics page only.
6. Add a **bundle budget** in CI. `@next/bundle-analyzer`, or a script over the manifests like the one used for this review, should fail the build if `/` exceeds, for example, 250 KB of JS.

**Done when** `/`, `/about`, `/legal/*` and `/contact` ship **under 200 KB of JS**, and Lighthouse mobile performance on `/` is ≥ 90.

### 4.2 Every page is server-rendered on every request (nothing is static)

**Measured.** `next build` marks **every** route `ƒ (Dynamic)`, including `/`, `/about` and the legal pages.

**Cause.** [`app/layout.tsx` L90](../../frontend/src/app/layout.tsx) calls `await headers()` to pick up the CSP nonce, which opts the whole tree into dynamic rendering.

**Why it matters.** Marketing pages cannot be cached at the CDN, so every first visit pays server render time and a cold start, and time-to-first-byte suffers globally.

**Fix (pick one, and document it as an ADR).**
- **Option A (recommended).** Route groups: `(marketing)` pages use a static CSP *with hashes* (no nonce needed, because they have no inline scripts once the wallet code is gone), and the `proxy` (middleware) only adds a nonce for `(console)` and `/auth`. Marketing becomes static and CDN-cached.
- **Option B.** Keep the nonce everywhere but accept dynamic rendering, and make it cheap: Node runtime, regional deployment close to Supabase, and a minimal root layout.

While you are here: `middleware.ts` is deprecated in Next 16. Run `npx @next/codemod@canary middleware-to-proxy .`

### 4.3 Marketing content is invisible until JavaScript runs

**Where.** [`app/page.tsx`](../../frontend/src/app/page.tsx) and [`app/about/page.tsx`](../../frontend/src/app/about/page.tsx) are `'use client'`. Nearly every section is wrapped in `motion.div` with `initial={{ opacity: 0, y: 24 }}`.

**Why it matters.** The server HTML ships with `opacity: 0` inline styles. On a slow phone the user sees a nearly blank page with a navbar until ~1.4 MB of JS downloads and hydrates. The LCP element (the hero heading) is one of the hidden ones. The hero illustration also floats forever (`repeat: Infinity`), which is distracting and wastes battery.

**Fix.**
1. Make marketing pages **Server Components**. Move the few interactive pieces (navbar menu, contact form) into small client islands.
2. Never animate the hero or LCP content from `opacity: 0`. Render it visible, and if you want motion, use CSS-only effects that don't hide content (for example `@starting-style` or a `transform`-only entrance).
3. For below-the-fold reveals, use a CSS class plus `IntersectionObserver` that **adds** the animation, so content is visible when JS is absent or late.
4. Remove the infinite float, or limit it to a single entrance.

### 4.4 The dashboard loading waterfall, and protected pages flashing for the wrong role

**What a user sees when opening `/dashboard`:**

1. `app/dashboard/loading.tsx`: a big centred card, "Loading dashboard".
2. `ProtectedRoute` while the session loads: a **grey top-navbar skeleton** ([`AuthContext.tsx` L150](../../frontend/src/contexts/AuthContext.tsx)). Its hardcoded `bg-gray-50`/`bg-white` doesn't match the design tokens, and its top-nav layout doesn't match the real sidebar layout.
3. `DashboardChrome` while the role resolves: a centred card, "Opening your console".
4. The page component wraps itself in `ProtectedRoute` **again**, which can repeat step 2.
5. `InstitutionConsolePage`: the profile skeleton.
6. Then the actual content.

That is four or five different visuals in sequence, and each one shifts the layout.

**There is also a role-gating bug.** In `AuthProvider`, `setLoading(false)` runs immediately after `resolveRole(nextUser)` is *called*, not after it finishes (L60–61, L75–76). For a moment, `loading === false` while `userRole === 'loading'`. `ProtectedRoute` only blocks when `userRole !== 'loading' && !allowed` (L141, L186), so **it renders the children while the role is unknown**. A student who opens `/admin` briefly sees the admin console shell and fires admin API calls (the server rejects them). It looks broken, and it leaks the admin UI structure.

**Fix (structural; this is the most valuable refactor in this report).**
1. Adopt **`@supabase/ssr`** so the session lives in httpOnly cookies instead of `localStorage`.
2. In `proxy.ts`, redirect unauthenticated requests for `/dashboard/*` and `/admin/*` to `/auth/login?next=…` **before any HTML is sent**.
3. In `app/(console)/dashboard/layout.tsx` (a **Server Component**), resolve the user, role and institution profile once on the server and pass them down through context. No client-side role fetch, no `ProtectedRoute`, no flash.
4. Delete the per-page `<ProtectedRoute>` wrappers (they are duplicated in 10+ pages).
5. Keep **exactly one** `loading.tsx` per segment, and make it a skeleton of the *real* layout (sidebar plus header plus content blocks).
6. API routes read the cookie session as well. That removes the hand-rolled `safeGetSession() → fetch(..., { Authorization: Bearer })` pattern repeated in 14 files.

**Short-term fix if the refactor must wait.** In `AuthProvider`, `await resolveRole(...)` *before* `setLoading(false)`, and in `ProtectedRoute` treat `userRole === 'loading'` as loading.

### 4.5 Smaller first-visit issues

| Issue | Where | Fix |
|---|---|---|
| OpenGraph image declared as 1200×630, but `logo.png` is **401×420** | `app/layout.tsx` L47–49, `about/layout.tsx` | Make proper 1200×630 OG images (or `opengraph-image.tsx` per route). |
| 171 KB PNG logo rendered at 36 px; `logo.png` and `Acredia.png` are duplicates | `public/` | One SVG logo. Delete the duplicate. |
| Page titles duplicate the brand: "Verified Issuer Registry — Acredia **\| Acredia**", "About Acredia - … **\| Acredia**", "Contact — Acredia \| Acredia" | `issuers/layout.tsx`, `about/layout.tsx`, `contact/page.tsx` | The root template already adds `\| Acredia`. Page titles should be just "Verified issuers", "About", "Contact". |
| `twitter.creator: '@acredia'` contradicts `lib/contact.ts`, which says no handle exists yet | `app/layout.tsx` L62 | Read it from `TWITTER_HANDLE`, or omit it. |
| Issuer registry is client-fetched, so crawlers see an empty list | `app/issuers/page.tsx` | Server-render the list (it is public data). Keep only the search box on the client. |
| `issuers/layout.tsx` does `export { default } from './page'`, so the layout *replaces* `children` with a second copy of the page | `app/issuers/layout.tsx` | A hack to attach metadata to a client page. Server-render the page and export `metadata` from it. |
| Sitemap is missing `/issuers`, `/contact`, `/legal/*`, `/docs/api` | `app/sitemap.ts` | Add them. |
| `min-h-screen` (100vh) everywhere and no `dvh` | 23 usages | On mobile Safari the address bar causes jumps. Use `min-h-dvh`. |

---

## 5. P1 — UX issues, page by page

### 5.1 Global navigation and marketing

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| 1 | The navbar always shows **"Sign in / Request access"**, even when signed in | A signed-in student who returns to the homepage looks logged out | Show "Open dashboard" plus an avatar menu when a session cookie exists (cheap once §4.4 is done). |
| 2 | The Solutions dropdown has no Escape-to-close and no outside-click close. `aria-haspopup="true"` on a disclosure, not a menu | Keyboard users get stuck, and screen readers announce the wrong pattern | Use Radix `NavigationMenu` or `Popover` (Radix is already a dependency). |
| 3 | The mobile menu sheet has no focus trap and doesn't return focus | Tab moves behind the open sheet | Use Radix `Dialog`/`Sheet`. The same problem exists in the console mobile drawer. |
| 4 | The `.skip-link` class is defined in `globals.css` but **never rendered**. Auth pages, `/claim` and route-state screens have **no `<main>` landmark** | WCAG 2.4.1 | Render `<a href="#main" className="skip-link">` in the root layout and give every page `<main id="main">`. |
| 5 | **"Request access"**, the primary CTA on every page, opens a generic name/email/message form | B2B buyers expect a qualification form. Sales has nothing to triage. | Add fields: institution name, country, role, estimated credentials/year, and a timeline. Keep the generic contact form as a secondary option. |
| 6 | Hero statistics ("3–5s", "<$0.01", "**100% tamper-proof**") have no source | Absolute claims undermine trust with institutional buyers and legal teams | Cite them ("Stellar ledger close ≈5s") or soften them ("Cryptographically verifiable"). |
| 7 | The public contact address is a **Gmail** account | Universities and employers judge legitimacy by domain | Use `support@` and `security@` on your own domain, with SPF/DKIM/DMARC. Publish `/.well-known/security.txt`. |

### 5.2 Auth (login, forgot and reset password, accept invite)

| # | Issue | Fix |
|---|---|---|
| 1 | On mobile, a 220 px illustration and the logo sit **above** the form, which pushes the email field below the fold on small phones | Hide the illustration under `sm`, or put it after the form. |
| 2 | Three different loading visuals: `auth/loading.tsx` (card skeleton), then the Suspense fallback (plain "Loading…" text), then `AuthShell` (split layout) | One skeleton that matches `AuthShell`. |
| 3 | Raw Supabase error strings are shown to users | Map known codes to friendly copy in `authFlow.ts`, with a generic fallback. |
| 4 | No show/hide password toggle. No caps-lock hint | Standard on modern login forms. |
| 5 | "Administrator access" link on the public login page | Fine, but consider hiding admin login behind a direct URL only. It advertises an attack target. |

### 5.3 Institution console — Issue credential

[`CredentialUploadForm.tsx`](../../frontend/src/components/institution/CredentialUploadForm.tsx), [`CredentialUploadFormSections.tsx`](../../frontend/src/components/institution/credential-upload/CredentialUploadFormSections.tsx)

| # | Issue | Why it matters | Fix |
|---|---|---|---|
| 1 | **The institution has to type or paste a 56-character `G…` wallet address**, even though a Student roster exists | Slow, error-prone, and the main source of mis-issued credentials | Use a **student picker** (search the roster by name, email or student ref) that fills name, email and wallet. Keep manual entry as an "advanced" option. |
| 2 | Wallet placeholder is **`"0x..."`** (L75) | Stellar addresses start with `G`. An obvious "copied from an Ethereum template" tell. | `placeholder="G…"`, plus inline checksum validation as the user types. |
| 3 | Subject row `<Label>`s have no `htmlFor`, and the inputs have no `id` | Screen readers announce unlabeled inputs. Fails WCAG 1.3.1. | Give each row stable ids: `subject-${id}-name`. |
| 4 | Errors appear as a list at the top **and** as a toast | Users have to map errors back to fields | Use inline per-field errors (`aria-invalid` + `aria-describedby`). `react-hook-form` and `zod` are **already installed and unused**. |
| 5 | Wallet connection is checked only **after** the user fills everything and confirms the review dialog | Wasted effort and a frustrating dead end | Show the connect state inline at the top of the form and disable submit with a clear reason. |
| 6 | The wallet prompt says "use the Connect Wallet button **in the sidebar**", but on mobile the sidebar is hidden in a drawer | Instructions that point at invisible UI | Render `<ConnectWallet />` inside the prompt card. |
| 7 | Progress steps are rendered with the text prefixes `"Done "` and `"* "` | Looks unfinished | Use a proper stepper: icons, `aria-current="step"`, and a live region announcing the active step. |
| 8 | On success: **three stacked toasts** (success, token ID, truncated transaction hash) and then the form resets, so the result is lost | The user cannot copy the token ID, share link or transaction link | Show a **success screen**: token ID (copyable), public link, QR code, explorer link, and buttons for "Issue another" and "View in issued list". |
| 9 | Raw contract and host errors are surfaced (`HostError: Error(Contract, #3)`) | Meaningless to an operator | Map `ContractError` codes to messages (for example "This exact credential was already issued (#3)"). |
| 10 | No navigation guard while signing or submitting | Closing the tab mid-issue causes chain/DB divergence (see §3.6) | `beforeunload` while `isSubmitting`. |
| 11 | Leftovers: `className="w-full "` and `className=""` | Noise | Remove. |

### 5.4 Institution console — Issued credentials

[`IssuedCredentialsList.tsx`](../../frontend/src/components/institution/IssuedCredentialsList.tsx)

| # | Issue | Fix |
|---|---|---|
| 1 | `<a><Button/></a>`, a button nested inside a link (L481, L488). Invalid HTML, and it fails axe `nested-interactive` | `<Button asChild><a …/></Button>`. |
| 2 | Card-per-row layout for what is an operational dataset (hundreds or thousands of rows) | A **data table**: sortable columns, sticky header, row actions menu, bulk select (bulk revoke or export), density toggle, and a card fallback on mobile. |
| 3 | No "Copy verify link" or "Open public page" per row, which is the most common support task | Add them as row actions. |
| 4 | Status filter, search and date filters, but no result count or "clear filters" | Add "Showing X of Y · Clear filters". |
| 5 | Broken indentation (L115–123) and an `import` in the middle of the file (L59) | Fixed automatically by enforcing Prettier (§6.1). |
| 6 | `institutionId` prop is declared but unused | Remove it, or use it. |

### 5.5 Student console

[`StudentCredentialsList.tsx`](../../frontend/src/components/student/StudentCredentialsList.tsx), [`dashboard/credentials/page.tsx`](../../frontend/src/app/dashboard/credentials/page.tsx)

| # | Issue | Fix |
|---|---|---|
| 1 | **Seven stacked action buttons** per credential (QR, Public showcase, Copy link, Download VC, IPFS, Blockchain) | One primary action ("Share") that opens a share sheet (link, QR, LinkedIn "Add to profile", download PDF/VC). Put technical links behind "Details". |
| 2 | `alert('Share link copied to clipboard!')` (L368) and `alert(...)` on failure | `toast.success`. Native `alert` blocks the page and looks broken. |
| 3 | "Connect your wallet to view your credentials" as the first message | **Students are not crypto users.** Credentials are already linked by `student_id`, so the list does not need a wallet. Make the wallet optional ("Link a wallet to hold credentials on-chain"). *(The false message was removed in §3.3; the optional-wallet design is still open.)* |
| 4 | `grid-cols-2` facts with no mobile breakpoint, and `ml-4` button column beside it | On a 360 px phone the card is cramped. Stack on mobile. |
| 5 | Copy-link builds `/verify?token=…` while "Public showcase" uses `/credentials/{token}`, so two different share URLs exist for the same thing | Pick one canonical public URL (`/credentials/{token}`, which has OG metadata) and use it everywhere. |
| 6 | Add to LinkedIn is missing | This is the single most valuable student feature for adoption. LinkedIn's "Add license or certification" deep link takes the name, organization, issue date, credential ID and URL. |

### 5.6 Public credential page and verification

| # | Issue | Fix |
|---|---|---|
| 1 | `/credentials/[token]` fetches the credential **twice**: on the server in `generateMetadata`, then on the client via `/api/verify` with a skeleton in between | Fetch once on the server (shared `cache()`d function) and render the card server-side. Employers get an instant page, and it is SEO and preview friendly. |
| 2 | The verify page's main input is a token ID (`placeholder="e.g. 1"`) | Accept a full URL or QR payload as well as an ID. Many verifiers will paste the link they were sent. |
| 3 | A failed lookup says "Try another token ID" | Also offer "Report a suspicious credential", which feeds your fraud process (`docs/incidents/…`). |
| 4 | QR scanner library is in the initial bundle | Lazy-load it on **Start scan** (§4.1). |
| 5 | **Every credential notification email links to a page that does not exist.** [`api/notifications/trigger/route.ts`](../../frontend/src/app/api/notifications/trigger/route.ts) builds `${appUrl}/verify/${tokenId}`, but there is no `/verify/[token]` page (only `/verify?token=…` and `/credentials/[token]`). The student's first click from the email is a 404. *(Found 2026-10-29.)* | Link to the canonical public URL, `/credentials/{tokenId}` (see §5.5 #5). Add a test that the emailed URL resolves to an existing route. |

### 5.7 Pending, unverified and empty states

- **`VerificationRequiredCard`** shows the raw status in bold ("currently **pending**") and offers **no next step**. Add what happens next, expected timing, and a "Contact Acredia" button.
- **`InstitutionUnavailableCard`** is good copy. Reuse that tone for the other states.
- **Empty states** (no issued credentials, no students, no team) should each have one illustration-free sentence and **one primary action** ("Issue your first credential", "Import students from CSV").

### 5.8 Cross-cutting UI consistency

| Pattern | Today | Standard to adopt |
|---|---|---|
| Notifications | `sonner` toasts, plus native `alert()` (3×) and `confirm()` (1×, `ApiKeysManager.tsx` L87) | `sonner` only. Destructive confirms use `<AlertDialog>`. |
| Destructive confirmation | Custom `Dialog` in some places, `confirm()` in others | One `<ConfirmDialog intent="destructive" />` component. |
| Lists | Hand-built cards everywhere | One `<DataTable>` for console lists. Cards only for student-facing views. |
| Loading | 5+ different loading visuals | One skeleton per layout. Never a full-screen spinner inside the console. |
| Forms | Manual `useState` per field | `react-hook-form` + `zod` schemas shared with the API route (single source of validation). |
| Status badges | Ad-hoc `Badge className="border-success/25 …"` copies | Add `success`, `warning` and `info` variants to `badge.tsx`. |
| Testnet indicator | Different markup in the navbar, sidebar and `NetworkBadge`, with raw `amber-*` classes | One `<NetworkBadge>` everywhere, using the `warning` token. |
| Dark mode | Disabled, but 19 `dark:` classes remain and `next-themes` is installed | Either ship dark mode properly or remove both. |

---

## 6. P2 — Code quality and structure

### 6.1 Formatting and CI gates

- **132 of ~290 source files fail `prettier --check`**, and CI does not run it. That is why some files have broken indentation, mixed alignment styles (`const router     = useRouter()`), and imports mid-file.
- CI does not run `tsc` explicitly. `next build` does, but only in the later job.

**Fix.**
1. One PR, `chore: format codebase`, that runs `npm run format`, with no other changes. Add its SHA to `.git-blame-ignore-revs`.
2. CI: add `npm run format:check` (`prettier --check .`) and `npm run typecheck` (`tsc --noEmit`) to `lint-and-test`.
3. Pre-commit: add `lint-staged` (prettier + eslint on staged files) alongside the existing Gitleaks hook.

### 6.2 God components

| File | Lines | `useState` calls |
|---|---|---|
| `app/admin/institutions/[id]/page.tsx` | 797 | 10 |
| `components/institution/StudentRoster.tsx` | 774 | 20 |
| `app/admin/institutions/page.tsx` | 704 | 13 |
| `components/institution/TeamManager.tsx` | 564 | 9 |
| `components/institution/IssuedCredentialsList.tsx` | 502 | — |
| `components/student/StudentCredentialsList.tsx` | 475 | — |

Each one mixes data fetching, auth tokens, URL-state sync, dialogs, and rendering. **Rule of thumb for this codebase:** components stay under ~250 lines; data loading lives in a hook (`useIssuedCredentials(filters)`); each dialog is its own component; and lists use the shared `<DataTable>`.

### 6.3 There is no data layer

Fourteen files hand-roll the same sequence: `safeGetSession()`, then `fetch(url, { headers: { Authorization: Bearer … } })`, then `res.json()`, then `if (!json.success) throw`. There is no caching, deduplication, retries or invalidation, and refresh-token retry logic is copy-pasted (`StudentCredentialsList.tsx` L145–158).

**Fix.**
- **Short term:** `lib/apiClient.ts` with `api.get<T>(path, params)` and `api.post<T>(path, body)` that handles auth, JSON, the `{success,error}` envelope, and typed errors.
- **Medium term:** **TanStack Query** for client data (`useQuery(['issued', filters], …)`), with mutations that invalidate lists after issue or revoke.
- **Long term (with §4.4):** read-only console pages fetch in Server Components, and the client only handles mutations.

### 6.4 Validation is inconsistent across API routes

Twenty route handlers do not use a schema (zod is used elsewhere). Some are GET-only with query params, but `institution/link-wallet`, `admin/update-authorization`, `auth/accept-invite`, `ipfs/json` and `institution/apikeys` take bodies.

Search terms are interpolated directly into PostgREST `.or()` filter strings ([`student/credentials/route.ts` L108](../../frontend/src/app/api/student/credentials/route.ts), [`institution/credentials/route.ts` L91](../../frontend/src/app/api/institution/credentials/route.ts)). A term containing `,` or `)` can inject extra filter clauses. The impact is low today because the query is already scoped by `student_id`/`institution_id`, but it is a classic injection pattern.

**Fix.** Add a `withRoute({ auth, rateLimit, query: schema, body: schema }, handler)` helper so every route is declared the same way, and escape or whitelist characters in search terms (or use a Postgres RPC with parameters).

### 6.5 Dead code and dead dependencies

| Item | Status | Action |
|---|---|---|
| `react-hot-toast` | Not imported anywhere | Remove |
| `next-themes` | Not imported (dark mode disabled) | Remove, or ship dark mode |
| `react-hook-form`, `@hookform/resolvers` | Only used by the unused `ui/form.tsx` | Use them (§5.3), or remove them |
| `react-is@^16` | Wrong major for React 19 (`recharts` peer) | `react-is@^19` |
| `@playwright/test` | In `dependencies` | Move to `devDependencies` |
| `null-loader` and the whole `webpack()` block in `next.config.ts` | Builds run on **Turbopack**, so this config is ignored | Delete it |
| `images.remotePatterns` → cloudinary | Unused | Delete it |
| `ui/avatar.tsx`, `ui/dropdown-menu.tsx`, `ui/form.tsx`, `student/CredentialDiagnostic.tsx` | Not imported | Delete them (or use them) |
| `marketing/BrandSectionHeader.tsx`, `lib/marketingContent.ts`, `lib/adminAccess.ts` | Imported **only by tests** | Delete them with their tests, or wire them in |
| `dbHelpers`/`authHelpers` in `lib/supabase.ts` | Only referenced by one test assertion | Delete them (they contain client wallet writes, see §3.3) |
| `STELLAR_CONFIG` in `lib/stellar.ts` | Identical testnet and mainnet entries | Delete it |
| `app/_design/page.tsx` | Private folder, not routable | Delete it, or turn it into a real `/internal/design` page behind admin |
| `AuthContext`'s `useAuth` "must be used within provider" check | Unreachable (the context has a default value) | Default to `undefined` so the guard works |
| `console.log` with `eslint-disable` in the issuance path (`credentialService.ts` L151–159) | Debug output in production | Use `debugLog` |
| `'RouteErrorBoundry'` typo, plus a `gtag` call when no analytics is installed (`app/error.tsx`) | Noise | Fix the typo. Remove `gtag` until analytics is chosen. |

Add **`knip`** to CI. It finds unused files, exports and dependencies automatically.

### 6.6 Configuration duplication

- Contract ID env var: the app reads `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT`, but [`scripts/indexer.ts`](../../frontend/scripts/indexer.ts) reads `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT_ID`. `.env.local.example` lists both. One name only, and have the worker import `runtimeConfig`.
- `deny.toml` exists at the repo root **and** in `contracts/` (identical). `audit.toml` exists in `contracts/` **and** `contracts/.cargo/` (identical). Keep one of each.
- The build emits "Edge Runtime is deprecated". The route is [`credentials/[token]/opengraph-image.tsx` L54](../../frontend/src/app/credentials/%5Btoken%5D/opengraph-image.tsx) (`export const runtime = 'edge'`), the same file affected by the `next/og` advisory in §3.1. Switch it to the Node runtime when you upgrade.

### 6.7 Tests: good volume, wrong shape for UI

796 unit tests is a lot, and the `lib/` coverage is genuinely good. Gaps:
- **UI flows** are covered by only 6 Playwright specs, and they run against E2E-mode fakes (§3.5) instead of mocked network responses.
- **No performance budgets.** Add Lighthouse CI on `/`, `/verify`, `/credentials/[token]` and `/auth/login`, with thresholds.
- **No RLS tests that run as `authenticated`.** §3.2 would have been caught by one.
- **No visual regression.** Playwright `toHaveScreenshot()` on the 10 key screens catches the layout drift from many contributors.
- A coverage gate of 55% is fine as a floor. Ratchet it up per-directory (`lib/` ≥ 80%) rather than globally.

---

## 7. P3 — Docs and repo hygiene

### 7.1 README

A 1,400-line README is a reference manual, not a README. New contributors and evaluators bounce off it.

**Target:** under 200 lines covering what Acredia is (3 lines), a screenshot, live demo links, quick start (5 commands), an architecture diagram link, contributing and security links, and the license. Move everything else into `docs/`.

### 7.2 Broken and stale references

- `ISSUE_DRAFTS.md` is referenced from the README, `docs/architecture.md` (×2) and `docs/product/vision.md`. **It does not exist.**
- `docs/mainnet-readiness.md` links `../ISSUE_DRAFT.md`, which does not exist.
- `docs/testing/full-application-test-plan.md` links `../issues-1-12-completion.md`, which does not exist.
- `docs/architecture.md` describes the off-chain indexer as **planned**, but the latest commit (`5ca19ba`) implements it.

Add a markdown link checker (`lychee`) to CI.

### 7.3 Long-running workers have no documented home

`scripts/indexer.ts` (polling loop), `scripts/emailWorker.ts` and `worker/pinKeeper.ts` are **long-running processes**. Vercel (`vercel.json`) only runs the two cron routes. Nothing documents where these three run in production, how they are supervised, restarted and alerted on, or how many instances run (two indexers would double-process events unless `indexer_state` is locked).

**Before mainnet:** choose a host (Fly.io, Railway, Render, or a small VM with systemd), add health checks and alerting, and write it up in `docs/ops/runbook.md`. Without the indexer running, the DB mirror can drift from the chain (§3.6).

### 7.4 Other hygiene

| Item | Fix |
|---|---|
| `frontend/supabase/seed.sql` is **broken**: it inserts `'inst_001'`, `'stu_001'` and `'key_001'` into UUID columns, and omits `NOT NULL` columns (`institutions.email`, `students.name`). `supabase db reset` fails. | Rewrite it with valid UUIDs and required columns. Add `supabase db reset` to CI. |
| `frontend/test-results/.last-run.json` is committed | Add `test-results/` and `playwright-report/` to `.gitignore` and remove the file. |
| `frontend/.gitignore` ignores `/docs` | Probably meant for something else. Remove it so nobody adds docs under `frontend/docs` and loses them. |
| Root `.gitignore` ignores `CLAUDE.md` and `*session*.jsonl` | Fine for local tooling. Document that in CONTRIBUTING so AI-assisted contributors know not to commit session files. |
| `frontend/AGENTS.md` is auto-generated by `next dev` | Either commit it intentionally (and note why) or add it to `.gitignore`. |
| Legal pages: governing law is India / West Bengal, there is no registered legal entity name, and the contact is Gmail | Get these reviewed by counsel before mainnet. Universities' procurement teams will ask for the legal entity and a DPA signatory. |

---

## 8. Open-source governance: keeping quality up as PRs flow in

The pattern behind most findings is **many contributors, each solving their issue locally, with no shared rules enforced by tooling.** Comments in the code are excellent; *enforcement* is missing. To change that:

1. **Make the rules executable**, not just written down:
   - `prettier --check`, `tsc`, `eslint`, `knip`, a bundle budget, Lighthouse CI, `npm audit --audit-level=high` and a link check, all **required** status checks on `main`.
   - ESLint rules for the patterns in this review: `no-alert`, `jsx-a11y/no-interactive-element-to-noninteractive-role`, `react/jsx-no-useless-fragment`, `no-restricted-syntax` for testnet literals, and `no-restricted-imports` banning `@/lib/supabase` writes from `components/`.
2. **Write `docs/engineering/frontend-standards.md`** (one page). It should cover: Server Components by default; client islands only for interactivity; data through `apiClient` or TanStack Query; forms through RHF + zod; toasts through sonner; confirms through `ConfirmDialog`; lists through `DataTable`; no `fetch` with hand-built auth headers.
3. **PR template:** add checkboxes for "screenshots (mobile + desktop)", "no new client-side DB writes", "no new `'use client'` page without justification", and "new strings use design tokens".
4. **CODEOWNERS:** require maintainer review for `supabase/migrations/**`, `contracts/**`, `src/lib/wallet/**`, `src/lib/securityHeaders.ts` and `src/middleware.ts`/`proxy.ts`.
5. **Label good-first-issues from Section 10**, so contributors land on planned work instead of inventing their own.

---

## 9. Target structure

A layout that fits Next 16 and this product, without overengineering:

```
frontend/src/
├── app/
│   ├── (marketing)/            # Server Components, static, no wallet code
│   │   ├── layout.tsx          # SiteNavbar + SiteFooter
│   │   ├── page.tsx            # home
│   │   ├── about/ contact/ issuers/ solutions/ legal/ docs/
│   ├── (verify)/               # public verification, server-rendered
│   │   ├── verify/  credentials/[token]/
│   ├── (auth)/                 # login, reset, accept-invite, claim
│   │   └── layout.tsx          # AuthShell
│   ├── (console)/              # authenticated area
│   │   ├── layout.tsx          # server: session + role → redirect; mounts StellarProvider
│   │   ├── dashboard/ …
│   │   └── admin/ …
│   └── api/                    # route handlers, all via withRoute()
├── features/                   # feature-sliced; each owns UI + hooks + schemas
│   ├── issuance/   (IssueForm, StudentPicker, useIssueCredential, issue.schema.ts)
│   ├── credentials/(DataTable columns, RevokeDialog, useIssuedCredentials)
│   ├── roster/     (StudentRoster split into table + dialogs + hooks)
│   ├── team/
│   ├── verification/
│   └── wallet/     (StellarProvider, ConnectWallet — lazy-loaded)
├── components/
│   ├── ui/                     # shadcn primitives only (button, dialog, data-table, …)
│   └── layout/                 # ConsoleShell, SiteNavbar, SiteFooter, skeletons
├── lib/
│   ├── server/                 # server-only (import 'server-only'): supabase admin, auth, rate limit
│   ├── client/                 # apiClient, browser supabase
│   ├── stellar/                # contracts, reads, explorer helpers
│   └── shared/                 # schemas, types, pure utils
└── proxy.ts                    # auth redirects + CSP nonce for console/auth only
```

Key rules:
- `import 'server-only'` in every server module, so service-role code can never be bundled into the client by accident.
- Each `features/*` folder exports a small public API (an `index.ts`). Features do not import each other's internals.
- Zod schemas live in `features/*/…schema.ts` and are imported by **both** the form and the API route.

Contracts:

```
contracts/
├── Cargo.toml                  # workspace
└── credential/
    ├── src/{lib,errors,storage,events,admin,issuance,upgrade}.rs
    └── tests/{issuance,revocation,ownership,upgrade,proptest}.rs
```

---

## 10. Phased plan

Each line is roughly one GitHub issue. The labels are suggestions.

### Phase 0 — Security and mainnet blockers (week 1) `priority:P0`

- [x] Upgrade `next`, `eslint-config-next` and `zod`. Triage the remaining `npm audit` highs. Add a blocking audit step to CI. (§3.1) *Done 2026-10-29, committed 2026-10-30.*
- [x] Migration: lock down direct writes to `students`, plus RLS tests that run as `authenticated` against real Postgres. (§3.2) *Done 2026-10-29, committed 2026-10-30.*
- [x] Remove the client `wallet_address` write in `StudentCredentialsList`. Delete `dbHelpers`/`authHelpers`. (§3.3) *Done 2026-10-29, committed 2026-10-30.*
- [x] Revoke `EXECUTE` on internal `SECURITY DEFINER` functions from `anon`/`authenticated`. Add privilege tests for every definer function. (§3.9, found during §3.2) *Done 2026-10-29, committed 2026-10-30. Also closed the membership-helper lookup leak and changed function defaults.*
- [x] Fix account erasure: account-only, students self-serve, staff and admins via support, erasure records and membership history outlive the account. (§3.10, found during §3.2) *Done 2026-10-29, committed 2026-10-30.*
- [x] Design and fix the unencrypted credential data on public IPFS, before the contract redeploy. (§3.11, found during §3.10) *Done 2026-10-30, committed 2026-10-30: 3.11a (issuance), 3.11b (verify and share), 3.11c (indexer, IPFS retired). Open: the durability decision and counsel review of legal pages (§3.11c).*
- [x] Explorer helpers use `explorerBaseUrl`. Replace the 3 hardcoded testnet URLs. Add a lint guard. (§3.4) *Done 2026-10-30, committed 2026-10-30. The `securityHeaders.ts` exemption was removed with §3.7.*
- [x] Build-time gate on E2E mode. Verify there are 0 occurrences in production chunks. (§3.5) *Done 2026-10-30, committed 2026-10-30. 0 chunks, even with `NEXT_PUBLIC_E2E` set by mistake; all 37 Playwright tests pass. Unreachable fake-data branches remain in callers until tests move to network-level mocks.*
- [x] CSP: derive `connect-src` from runtime config. Remove the stray `img-src` domains. (§3.7) *Done 2026-10-30, committed 2026-10-30.*
- [x] Redeploy the contract on testnet with a multisig owner, apply the migrations, reset testnet data. (`docs/deployments/2026-10-30-testnet-redeploy.md`) *Contract deployed 2026-10-30: `CD3NAUTBD5JXFNJVB7DGJW2ALLLEEYBYC5PQ3IQIL7JSSGBDL2VZOY4U`, 2-of-3 multisig owner ([record](../deployments/2026-10-30-testnet.md)). Code references and the Vercel production environment updated. Migrations, testnet data reset, issuer authorization and smoke test done by the project lead (confirmed 2026-11-07).*
- [x] Contract: `overflow-checks = true`, `panic_with_error!`, and remove the legacy auth fallback for the mainnet build. (§3.8 a, c, d) *Done 2026-10-30, committed 2026-10-30, together with: constructor (i), typed events (b), `Result` from the issuer calls (e), hash-only storage (§3.11), optional expiry and `credential_status`. 89 contract tests (10 new, each proven by a targeted mutation); fmt and Clippy clean. Deployed 2026-10-30. Read-getter TTL bumps (f) unchanged; module split (g) stays in Phase 4.*
- [x] Testnet moved to protocol 30: `@stellar/stellar-sdk` 17.2.1 could not decode its ledger headers, so `getLatestLedger` threw and the indexer and the TTL-keeper cron stopped. *Fixed 2026-11-07: upgraded to 17.4.0, with a regression test on a recorded protocol-30 header (`tests/stellarSdkProtocol.test.ts`). The four RPC calls the app makes were checked against live testnet. Also: Playwright no longer picks up a developer's `.env.local` site URL and Upstash values (`playwright.config.ts`).*

### Phase 1 — First-visit performance (week 2) `area:perf`

- [x] Move `StellarProvider` to the console and claim layouts. Lazy-load the wallet kit. (§4.1) *Done 2026-11-07. `AuthProvider` moved too. `dashboard` and `admin` now sit in the `app/(console)` route group, whose layout mounts both providers (one layout, so the `/dashboard` → `/admin` redirect keeps them mounted); `/claim` mounts the wallet provider only. `useAuth` and `useStellarAccount` throw outside their providers. The kit was already loaded lazily by the adapter; the larger cause was `lib/stellar.ts` building an `rpc.Server` at import, which put the SDK (~540 KB) on every page through the marketing navbar. It now lives in `lib/sorobanServer.ts`. Raw client JS: `/legal/privacy` 1,073 → 289 KB, `/contact` 1,086 → 302 KB, `/verify` 1,109 → 324 KB, `/` 1,200 → 416 KB, `/dashboard` 1,130 → 594 KB. Public pages no longer load the SDK, the wallet kit or the Supabase client. Left for later items: framer-motion (~116 KB) on `/` and `/about` (§4.3), the budget check in CI (item 6).*
- [ ] Lazy-load `html5-qrcode` and `recharts`. (§4.1)
- [ ] Convert `/`, `/about`, `/contact`, `/issuers`, `/solutions/*` and `/legal/*` to Server Components. Remove `opacity:0` on the hero. (§4.3)
- [ ] ADR and implementation: static marketing plus a nonce only on console and auth. `middleware` → `proxy`. (§4.2)
- [ ] Proper OG images, an SVG logo, de-duplicated page titles, and a sitemap update. (§4.5)
- [ ] CI: bundle budget plus Lighthouse CI. (§4.1, §6.7)

### Phase 2 — Auth architecture (week 3) `area:auth`

- [ ] Adopt `@supabase/ssr` (cookie sessions). (§4.4)
- [ ] `proxy.ts` redirects for `/dashboard/*` and `/admin/*`. A server layout resolves role and profile. (§4.4)
- [ ] Delete the per-page `ProtectedRoute`. One layout-accurate skeleton per segment. (§4.4)
- [ ] API routes read the cookie session. `lib/client/apiClient.ts` replaces 14 hand-rolled fetches. (§6.3)
- [ ] Server-side credential confirm endpoint. Remove client `INSERT`/`UPDATE` RLS on `credentials`. (§3.6)

### Phase 3 — UX overhaul of core flows (weeks 4–5) `area:ux`

- [ ] Issue credential: student picker, RHF + zod inline errors, inline wallet state, a real stepper, a success screen, and contract error mapping. (§5.3)
- [ ] Shared `<DataTable>`. Migrate Issued credentials, Students, Team and Admin institutions. (§5.4, §5.8)
- [ ] Student credential card: one Share action, a share sheet, Add to LinkedIn, one canonical URL, and an optional wallet. (§5.5)
- [ ] Secure self-service wallet linking for signed-in students: sign a server-issued challenge (reuse the `/claim` nonce flow), server verifies and writes, audit-logged. Decide whether a student may replace a wallet the institution recorded. Show a hint when the connected wallet differs from the recorded one. (Deferred from §3.3)
- [ ] Server-render `/credentials/[token]`. Verify input accepts a URL or QR payload. (§5.6) *The URL/QR input part is done in §3.11b.*
- [x] Fix the 404 link in credential notification emails (`/verify/{tokenId}` → `/credentials/{tokenId}`). (§5.6 #5) *Done in §3.11b: emails link to the holder's share page, with a test that the route exists.*
- [ ] Escape the student credentials `search` term before it goes into the PostgREST `.or()` filter. (§3.11b follow-ups, found 2026-10-30)
- [ ] Replace `alert`/`confirm` with sonner and `ConfirmDialog`. Add `success`/`warning`/`info` badge variants. One `NetworkBadge`. (§5.8)
- [ ] Navbar signed-in state. Radix-based dropdown and mobile sheet. Skip link and `<main>` everywhere. (§5.1)
- [ ] Qualifying "Request access" form. Your own-domain contact email. `security.txt`. (§5.1)

### Phase 4 — Code health (ongoing, start alongside Phase 1) `area:dx`

- [ ] One-shot Prettier PR plus `.git-blame-ignore-revs`. Add `format:check` and `typecheck` to CI. `lint-staged`. (§6.1)
- [ ] Remove dead deps, files and config. Add `knip` to CI. (§6.5)
- [ ] Split god components (StudentRoster, the admin institutions pages, TeamManager). (§6.2)
- [ ] A `withRoute()` helper with zod for every API route. Escape search terms. (§6.4)
- [ ] Contract module split. (§3.8 g) *Typed events and the `#[allow(deprecated)]` removal (§3.8 b) were done early, on 2026-10-30, because the interface changed before the redeploy anyway.*
- [ ] Unify env var names. Remove duplicate `deny.toml` and `audit.toml`. (§6.6)
- [ ] Fix the invalid Tailwind class `easy-in-out` (should be `ease-in-out`) in `src/lib/wallet/adapter.ts`; Playwright logs it as `TWIND_INVALID_CLASS`. (found 2026-10-30)

### Phase 5 — Ops and docs (before announcing mainnet) `area:ops`

- [ ] Deploy and supervise the indexer, email worker and pin-keeper. Document them in the runbook. (§7.3)
- [ ] Fix `seed.sql`. Add `supabase db reset` to CI. (§7.4)
- [ ] Slim the README. Fix the broken references. Add `lychee`. Mark the indexer as implemented in `architecture.md`. (§7.1, §7.2)
- [ ] Legal entity and counsel review of Terms, Privacy and DPA. (§7.4)
- [ ] Run the third-party contract audit **after** the Phase 0 and Phase 4 contract changes. Confirm the multisig owner before `initialize`. (§3.8 h)

---

## Appendix A — Commands used for the measurements

```bash
# quality gates
cd frontend && npm ci
npx eslint . && npx tsc --noEmit && npx vitest run && npx next build
npx prettier --list-different "src/**/*.{ts,tsx}" | wc -l      # → 132
npm audit --omit=dev                                           # → 22 (1 critical, 13 high)

# per-route client JS: sum entryJSFiles from .next/server/app/<route>_client-reference-manifest.js

# hardcoded testnet
grep -rn "explorer/testnet" src --include='*.ts' --include='*.tsx'

# hardcoded palette classes (design-token drift)
grep -rEo "(bg|text|border)-(gray|slate|amber|…)-[0-9]{2,3}" src | wc -l   # → 52
```

## Appendix B — Files most in need of attention

| File | Why |
|---|---|
| `src/components/providers.tsx` | Global wallet provider → bundle size on every route |
| `src/app/layout.tsx` | `await headers()` makes every route dynamic. Wrong OG image dimensions. |
| `src/contexts/AuthContext.tsx` | Role-gating race, off-brand skeleton, client-only auth |
| `src/components/student/StudentCredentialsList.tsx` | Client wallet write, `alert()`, testnet URL, 7-button cards |
| `src/components/institution/IssuedCredentialsList.tsx` | Testnet URL, nested interactive elements, formatting |
| `src/components/institution/CredentialUploadForm.tsx` + `…Sections.tsx` | `0x` placeholder, unlabeled inputs, no student picker, no success state |
| `src/lib/e2e.ts` | Test mode reachable in production |
| `src/lib/securityHeaders.ts` | Stray domains. Hardcoded network endpoints. |
| `src/lib/stellar.ts` | Explorer helpers ignore `explorerBaseUrl`. Dead `STELLAR_CONFIG`. |
| `src/app/issuers/page.tsx` + `layout.tsx` | Testnet URLs, client-only public data, layout re-export hack |
| `supabase/schema.sql` (students policy) | Column-unrestricted self-update |
| `supabase/seed.sql` | Does not run against the current schema |
| `contracts/Cargo.toml`, `contracts/src/lib.rs` | `overflow-checks`, blanket `allow(deprecated)`, legacy path, single file |
