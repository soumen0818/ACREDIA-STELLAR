# Full application test plan — staging/testnet

**Updated:** 2026-10-02
**Scope:** whole Acredia application, with special acceptance checks for issues 1–12.
**Rule:** run live writes on an isolated **testnet staging** deployment, database, and disposable contract. Do not use the mainnet contract or real student data for these tests. Automated browser tests use mocked wallets, RPC and database responses; their pass result is not proof of a real transaction.

Record each result in a private test log with date/time, tester, git commit/deployment ID, environment, wallet name/version and device, contract ID, token ID, public verification URL, relevant transaction hashes, expected result, actual result, and a redacted screenshot/log when useful. Never record seed phrases, private keys, service-role tokens, cron secrets, or unredacted student data.

## 1. Prepare an isolated environment

1. [ ] Create or identify a staging Supabase project, testnet contract, Pinata account, Redis database, and staging domain. Use disposable identities and sample credentials. Confirm the app, wallets, RPC, Horizon and contract are all on **testnet**. A [fresh testnet contract](../deployments/2026-10-02-testnet.md) was deployed from this checkout for issues 9–12; use its recorded ID/hash, or deliberately upgrade another testnet instance if preserving its ID. A local `cargo test` does not update deployed WASM. The new instance has no credentials or authorized issuers yet.
2. [ ] Apply the existing baseline migrations in order if the database is new. For an existing database, check its migration history and apply only unapplied files. Then apply **`20260930000000_credential_revocation_source.sql` before any owner-revocation test**, followed by **`20261002000000_ttl_keeper_run_log.sql`**. Paths are under `frontend/supabase/migrations/`. Take a backup before changing an existing staging database; do not paste the whole generated `schema.sql` over it. For a Supabase CLI-linked **staging** project, review the pending list and run `cd frontend && npx supabase db push`; for a database originally set up manually, run the two file contents separately in the staging SQL Editor and record that they were applied. Confirm the linked project name before any push.
3. [ ] In the Supabase SQL editor, verify the two additions without exposing row data:

   ```sql
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'credentials'
     AND column_name = 'revocation_source';

   SELECT to_regclass('public.cron_run_log') AS cron_run_log,
          to_regclass('public.ttl_keeper_lock') AS ttl_keeper_lock,
          to_regprocedure('public.claim_ttl_keeper_lock(uuid)') AS claim_fn,
          to_regprocedure('public.release_ttl_keeper_lock(uuid)') AS release_fn;
   ```

   Expect one `revocation_source` text column and four non-null object names. Check that only the service role can write the keeper tables. The revocation migration backfills previously revoked rows as `issuer`; review any historical owner-revocation events before trusting that attribution.
4. [ ] Configure the [environment variables below](#environment-variables-and-accounts-to-provision) in the **staging** deployment. Public variables are baked into the browser build: redeploy after changing them. Keep every secret server-side. The indexer currently reads `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT_ID` in addition to the app's `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT`; set both to the same staging contract ID.
5. [ ] Create a provisioned admin user, an authorized test issuer/institution, a student test user and wallet, three separate wallet apps/extensions for issue 2 (including Freighter), a real phone with a compatible WalletConnect wallet, and a funded keeper account. Confirm roles and wallet addresses before testing.
6. [ ] Start the standalone indexer (`cd frontend && npm run indexer`) with the same contract ID, RPC URL and staging Supabase credentials. Watch for errors and note its starting ledger. A new indexer starts from the current ledger; issue test credentials **after** it starts. Keep it running through revocation tests.

## 2. Run the automated baseline

From a clean checkout with dependencies installed (`npm ci` in `frontend`; use the lockfile), run:

```bash
cd contracts
cargo test --locked
cd ../frontend
npx tsc --noEmit
npm run lint
npx vitest run --silent
npx playwright test
npm run build -- --webpack
```

1. [ ] Record pass/fail counts and commit. The last verified local baseline was **87 contract**, **666 frontend unit/integration**, and **15 browser** tests (12 existing plus three wallet modal/CSP checks run in the prior pass). Counts can change; investigate failures rather than accepting a target number.
2. [ ] Let Playwright start its own app on port 3199. Its identity guard must reject a different app on that port; do not bypass it to make tests green. Set `PLAYWRIGHT_PORT` to a free port if necessary.
3. [ ] If a test cannot bind a local socket, retry in an environment that allows loopback. If the build cannot fetch Inter from Google Fonts or Turbopack cannot start an internal process, record the environmental error separately; the webpack build is the verified fallback. A build pass is still required before release.
4. [ ] Run `git diff --check` and review migration and configuration diffs before deployment.

## 3. Manual whole-application smoke test

Run in this order on staging. Mark each step only after seeing the stated result and logging evidence.

### Public and access control

1. [ ] Open `/`, `/about`, `/solutions/institutions`, `/solutions/students`, `/docs/api`, `/legal/privacy`, and `/contact` on desktop and phone. Check links, layout at 320/360 px, keyboard focus, readable text and no console/CSP errors.
2. [ ] Load `/verify`, `/issuers`, and a known credential's public page without login. Confirm public data is accessible and no private student details leak.
3. [ ] Open admin and institution routes while signed out and as a student. They must deny access. Sign in as a provisioned admin and check the admin overview, institution list, rate-limit health and retention status. Sign in as an institution and confirm it cannot use admin-only routes.
4. [ ] Submit the contact form with valid data and invalid/empty data. Check success/validation, database/email outcome if configured, and that no duplicate submission occurs on reload.

### Institution and student lifecycle

5. [ ] As admin, create or invite a disposable institution contact. Check invite delivery, expiry, acceptance, and the institution's onboarding state. Reuse/replay an invite and verify rejection. Confirm another institution cannot read or edit its records.
6. [ ] Authorize the institution's **testnet wallet** on the disposable contract. Record the transaction hash and confirm on-chain `is_authorized_issuer` and the admin UI agree. Test an unauthorized wallet: issuance must fail without creating a credential row.
7. [ ] Invite/provision a disposable student. Check email/acceptance flow, student dashboard, account/wallet linking and role separation. Use a wallet address controlled by the tester, not the issuer.
8. [ ] Upload a sample document and issue one credential through the normal institution UI. Record Pinata CID, transaction hash, token ID and database row. Confirm the on-chain credential hash/URI match the public verification result and that no record was inserted when signing was cancelled.
9. [ ] Batch issue two or more **different** sample credentials. Check row-level success/failure, sequential token IDs, no accidental duplicates, correct ownership and public pages. Deliberately submit one invalid row and verify other valid rows are handled as documented.
10. [ ] As the student, open `/claim` and complete the supported message-signing flow. Confirm the linked credential appears on the student dashboard. Retry the same claim, a wrong wallet and a rejected signature; expect clear failures without cross-account access.
11. [ ] Verify the issued credential through the public page and `/api/verify/<token_id>`. Check genuine = verified, wrong hash/altered metadata = not verified, unknown token = not found, and a simulated RPC outage = clear degraded/error state rather than a false verified result. Inspect the response for private-data leaks.
12. [ ] Revoke a disposable credential as its original issuer. Confirm `cred_rev` on chain, `revoked=true` and `revocation_source='issuer'` in the index, and public UI/API saying **revoked by issuer**. A second revocation must fail without a misleading success event.
13. [ ] Test institution credential list, export and analytics with both active and revoked sample credentials. Confirm counts and access are scoped to the institution.
14. [ ] Test password reset, sign-out, reload, notification preferences and account-erasure path using disposable users only. Check the retention cron separately and verify its admin status; never use a live student account for erasure rehearsal.
15. [ ] Test institution API-key creation, use and revocation; confirm revoked keys stop working and cannot access another institution. Exercise the institution point-of-contact handover and admin recovery-link flow with two disposable users; check audit records and old-user access removal.
16. [ ] If email is configured, test invite, recovery and notification delivery with a verified staging sender. Trigger a notification twice and confirm expected de-duplication. If email is not configured, record those flows as untested rather than passed.
17. [ ] Run the retention cron with the correct bearer secret against disposable overdue records, then confirm deletion counts, admin status and no deletion of in-retention records. Test wrong/missing secret. Verify a staging database backup can be restored into a **different** disposable project. Never restore over the active staging or production database.
18. [ ] If secondary IPFS pinning is configured, run its keeper/worker and prove a credential's CID remains retrievable when the primary gateway fails. Check email and pin worker logs for failed jobs and retries. Record these optional integrations as not configured if no staging provider exists.

## 4. Manual issue 1–12 acceptance tests

### Issues 1–4: browser, wallets, signer and phone

1. [ ] Issue 1: intentionally point Playwright at a foreign responder/app and confirm global setup refuses it with the offending URL. Then run the normal browser suite against Acredia. Keep the main suite green.
2. [ ] For **Freighter, xBull, and at least one more supported wallet**, perform a real testnet connect → authorization where applicable → issue → public verify → batch issue → issuer revoke cycle. Record every signed transaction hash and wallet/version. Also test cancel, locked wallet, changed account, revoked permission, reload without an unsolicited popup, and wrong network. This is the real-signer regression for issues 2 and 3.
3. [ ] Walk the [per-wallet matrix](../../frontend/tests/TEST_STRATEGY.md#per-wallet-verification-matrix). For Albedo and Rabet, verify `/claim` refuses early with a clear message if message signing is unavailable. HOT Wallet is intentionally disabled; do not count it as supported.
4. [ ] On a **real phone** at the staging HTTPS origin, connect via WalletConnect and approve the testnet session in an installed wallet app. Complete `/claim` with `stellar_signMessage` as the student. Separately, if that wallet can sign contract transactions, use an **authorized issuer** account to issue a disposable credential. Confirm the wallet's actual capability rather than assuming it. Check 360 px modal width, tap targets, keyboard/screen-reader labels, reload/reconnect and cancellation. Record browser/wallet/OS versions and console CSP errors. A desktop device emulator does not satisfy this test.

### Issues 5–6: governance and independent audit

5. [ ] On a disposable testnet contract, execute the [2-of-3 owner custody rehearsal](../owner-key-custody.md#4-ownership-transfer-at-mainnet-launch): verify signer weights/thresholds, fail a one-signer privileged call, pass the same operation with two distinct hardware signers, transfer/accept ownership, read `get_owner`, and record hashes. Keep owner seeds off developer workstations. Do not perform this on the shared test contract while other tests run.
6. [ ] Give an independent auditor the **final** contract source/commit, tests and [handoff scope](../../contracts/THIRD_PARTY_AUDIT.md). Obtain a written report, resolve and re-review critical/high findings, decide lower-severity findings in writing, tag the audited commit and verify the deployed WASM comes from that commit. No internal test substitutes for this step.

### Issues 7–8: keeper and distributed limiter

7. [ ] Run `GET /api/cron/ttl-keeper` with `Authorization: Bearer <CRON_SECRET>` against staging. A missing or wrong secret must fail; a configured, funded signer should create a `cron_run_log` row. Inspect `status`, `totalCredentials`, `indexedCredentials`, `indexGap`, `nextTokenId`, `bumpSucceeded`, `bumpFailed`, `minRemainingTtlLedgers`, `keeperBalanceXlm`, `lowBalance` and `capacityExceeded`. The minimum TTL reported is **only the sampled page**, not the entire contract.
8. [ ] Use enough disposable credentials to prove the 50-ID page rotates across runs, including a revoked record and a credential missing from the index. Confirm an index mismatch produces an unhealthy result; repair/replay the indexer. Measure run duration, actual fees and minimum remaining TTL. Test wrong keypair, unfunded signer, failed RPC and overlapping invocations; each must fail visibly or return an unhealthy status, never a false success.
9. [ ] Rehearse archived-entry restoration and post-restore verification on testnet following the [keeper runbook](../ops/ttl-keeper-runbook.md). Do not rely on a merely failed verification call to prove archival. Configure an independent monitor for missing runs (>25 h), failed/partial runs, low balance and low TTL; trigger a staging alert and confirm a human receives it.
10. [ ] With Redis configured, call the admin-only `/api/admin/rate-limit-health`; expect `healthy: true`. Hit a rate-limited endpoint through **two separate deployed instances** with the same test identity and confirm the combined quota is shared. Test missing Redis at boot on a disposable mainnet-labelled configuration, Redis outage and recovery; verify HTTP 503/alert behavior and no `RATE_LIMIT_ALLOW_IN_MEMORY_ON_MAINNET=true` in the real deployment. Do not use abusive traffic against third-party services.

### Issues 9–12: contract behavior and indexer provenance

11. [ ] On a disposable testnet contract, issue URI inputs of exactly **256 UTF-8 bytes** and 257 bytes through both single and batch issuance. Expect 256 accepted, 257 rejected with typed error **17**, and no partial state for the rejected item. Check existing testnet URI lengths before upgrading a shared contract. The Rust boundary tests are the primary repeatable check.
12. [ ] On a disposable credential, invoke `admin_revoke_credential` with the owner. Confirm `cred_rev_owner`, index `revocation_source='platform'`, public API/UI **revoked by platform**, and no issuer attribution. An unauthorized owner, nonexistent token and already-revoked token must fail. Stop the indexer briefly, revoke, restart/replay it, and confirm the provenance appears; a missing index row must not silently advance the cursor.
13. [ ] Revoke a never-authorized issuer and confirm **no** `iss_rev` event. Authorize another disposable issuer, revoke it and confirm exactly the intended deauthorization/event behavior. Repeat the no-op call. Use an event explorer or RPC result rather than only the UI.
14. [ ] On a disposable contract, propose a harmless audited test WASM hash. Record `upg_prop`, `get_pending_upgrade` and the ready ledger. Confirm immediate execution and wrong-hash execution fail. Test cancellation and absence of pending proposal. For a full execution rehearsal, wait the required **120,960 ledgers (approximately seven days)** on testnet and confirm only the matching hash executes after the deadline. Do not shorten a production policy or use production upgrades as a test. Publish the observed policy and result for verifiers.

## 5. Environment variables and accounts to provision

Set these in the staging deployment's protected settings and, only where needed for local work, in an ignored `frontend/.env.local`. Compare with [`frontend/.env.local.example`](../../frontend/.env.local.example). **Do not paste values into the test log or a chat.**

| Purpose | Exact variable(s) / account | Where and check |
|---|---|---|
| Baseline app/database | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | First two public; service-role key server-only. Staging Supabase project and migrations required. |
| Testnet/network | `NEXT_PUBLIC_STELLAR_NETWORK=testnet`, contract ID in `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT` and `NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT`; indexer also needs `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT_ID` and `NEXT_PUBLIC_SOROBAN_RPC_URL` | All three contract ID values must match. Use canonical network settings; no mainnet testing for this plan. |
| IPFS and admin | `PINATA_JWT`, `NEXT_PUBLIC_PINATA_GATEWAY`, `ADMIN_EMAIL_ALLOWLIST` | Pinata JWT server-only; provision admin through trusted path. |
| Public origin | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL` | Staging HTTPS origin for callbacks and WalletConnect display. |
| Mobile WalletConnect | **New:** `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Reown project ID; public ID, but configure the correct staging origin. Required for real-phone issue 4 test. |
| Shared limiter | **New:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Server-only staging Redis; production later needs its own approved configuration. |
| Keeper | **New:** `TTL_KEEPER_ACCOUNT_PUBLIC`, `TTL_KEEPER_ACCOUNT_SECRET` | Matching funded testnet signer. Secret server-only; separate from owner hardware multisig. |
| Cron | `CRON_SECRET` | Server-only shared secret for retention and keeper; add it if absent. Staging can use a different value from production. |
| Optional but needed for live paging | `OBSERVABILITY_INGEST_URL` or an independently configured external monitor | The code emits failure signals; a collector/alert destination and recipient must be configured and tested. |
| Human-controlled identities | Three distinct wallet types including Freighter; mobile wallet with message signing; issuer and student test accounts; three hardware owner signers; independent auditor | These are accounts/people, **not** app environment secrets. Record addresses and transaction hashes, never private keys. |

Also verify `SUPABASE_SERVICE_ROLE_KEY`, `PINATA_JWT`, `UPSTASH_REDIS_REST_TOKEN`, `TTL_KEEPER_ACCOUNT_SECRET` and `CRON_SECRET` are absent from browser bundles, screenshots and public logs. Leave `RATE_LIMIT_ALLOW_IN_MEMORY_ON_MAINNET` unset/false.

## 6. Release decision

Do not call issues 2, 4–8, 10 or 12 fully accepted until their manual rows pass with evidence. Issue 7 still needs an all-credential minimum-TTL metric if its original exact criterion is retained. Do not announce mainnet readiness until the independent audit, custody, keeper, Redis and alerting gates are closed. Link the completed evidence log and the [issues 1–12 status record](../issues-1-12-completion.md) in the release review.
