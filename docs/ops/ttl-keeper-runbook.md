# Credential TTL keeper — operations runbook

**Issue:** [#281](https://github.com/soumen0818/ACREDIA-STELLAR/issues/281)
**Reviewed:** 2026-10-02

## What the scheduled job does

`/api/cron/ttl-keeper` is scheduled daily at 02:00 UTC in `frontend/vercel.json`. It reads `total_credentials` from the contract, rotates through up to 50 sequential token IDs per run, and includes revoked credentials so their historical revocation remains verifiable. It reads each credential's persistent-storage TTL and submits `bump_credential` only when 3,110,400 ledgers or fewer remain. Transactions use one funded signer and run sequentially. A failed token is retried in the next run (up to ten retries before the next page). The job checks the database credential count against the chain total, persists its cursor and outcome in `cron_run_log`, and rejects overlapping runs with a database lease.

The page size covers at most about 4,500 credentials in a 90-day rotation, leaving a buffer against the contract's approximately six-month extension threshold. Above that count, `capacityExceeded` marks the run unhealthy; increase throughput and prove the new duration/fee budget before relying on it. `indexGap` means the database count differs from chain total. It does not repair the index.

## Required deployment setup

1. Apply `frontend/supabase/migrations/20261002000000_ttl_keeper_run_log.sql` and confirm the existing revocation-source migration is applied.
2. In the production server environment set `TTL_KEEPER_ACCOUNT_PUBLIC`, `TTL_KEEPER_ACCOUNT_SECRET`, and `CRON_SECRET`. The public key must match the secret and the account must be funded on the configured Stellar network. Keep the secret in the deployment secret store.
3. Confirm canonical `NEXT_PUBLIC_STELLAR_NETWORK`, contract ID, RPC, and Horizon settings point to the intended network. Invoke the cron with its bearer secret and inspect the response and `cron_run_log` row. A successful empty-chain run is not proof of credential coverage.
4. Fund against measured transaction fees and actual credential count. The current low-balance threshold is 5 XLM; it is an alert threshold, not a fee estimate.
5. Configure an **independent** monitor to check for a missing run after 25 hours, HTTP 5xx/timeout, `partial` or `failed` rows, low balance, `indexGap`, `capacityExceeded`, `bumpFailed`, and a low `minRemainingTtlLedgers`. The app records these states and emits capture/structured logs, but no external paging service is provisioned by this repository.

The latest keeper status is visible to admins at `/api/admin/stats` → `stats.ttlKeeper`. A failed run recorded in `cron_run_log` should be investigated before the next daily cycle. If the function times out, the six-minute lease expires; the next run may retry the same page. The contract operation is safe to repeat, but monitor duplicate fee spend.

## Responding to a partial or failed run

- `bumpFailed > 0`: inspect `failedTokenIds`, RPC transaction outcomes, and the on-chain entry. The next run retries up to ten IDs. Manually bump urgent entries before expiry.
- `indexGap`: compare contract `total_credentials` with indexed credential rows. Repair/replay the indexer; the keeper still enumerates chain token IDs, so the gap does not exclude an entry from its sweep.
- `lowBalance`: top up the configured signer on the correct network and rerun the job. Record the transaction hash and post-run balance.
- `capacityExceeded`: expand the per-run throughput or run frequency after measuring RPC latency, 300-second function duration, fees, and minimum TTL margin.
- Missed run: check deployment cron configuration, cron secret, function logs, lease, RPC/Horizon availability, and database migration status. Manually invoke once the fault is fixed, then confirm a new successful row.

## Archived credential recovery rehearsal

Rehearse on testnet with an expendable credential before launch. Record its contract ID, token ID, storage-key XDR, ledger numbers, transaction hashes, fees, and verification result. The key is Soroban `DataKey::Credential(u64)` encoded as an XDR `ScVal` vector of symbol `Credential` and the u64 token ID. For an archived entry use the installed Stellar CLI's `contract restore --id <CONTRACT_ID> --key-xdr <BASE64_SCVAL_KEY> --source-account <FUNDED_ACCOUNT> --network testnet`; `--key` accepts symbols only, so this tuple key needs `--key-xdr`. Then call `verify_credential` and `bump_credential` and confirm the restored entry's TTL. Follow the CLI's current `stellar contract restore --help` for signing and flags. Do not infer expiry solely from a failed verify call; inspect the entry's archival state first.

A revoked credential must still verify as revoked after restoration. Keep its off-chain row and `revocation_source`. A real expiry/restore exercise and independent missed-run alert evidence are outstanding launch gates.
