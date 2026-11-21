# Mainnet-latency RPC baselines, batch size and fees

**Measured:** 2026-11-21 (run started 05:43 UTC) · **Issue:** #314
**Data:** [`frontend/tests/mainnet-rpc-baselines.json`](../../frontend/tests/mainnet-rpc-baselines.json)
**Tool:** [`frontend/scripts/measure-rpc-baselines.ts`](../../frontend/scripts/measure-rpc-baselines.ts)
**Kept honest by:** `frontend/tests/mainnetRpcBaselines.test.ts`. It fails when the code moves past what these numbers cover (a larger `MAX_BATCH_SIZE`, other keeper constants), so they get re-measured instead of going stale.

`frontend/tests/load-baselines.json` measures route overhead with the chain mocked out: its 10 ms p50 for `/api/verify` contains no RPC time at all. This document measures the chain side.

## Summary

| Question | Answer |
|---|---|
| Verification on a cache miss, mainnet-latency RPC | **p50 985 ms, p95 1.31 s** (3 sequential simulations); one simulation is p50 ~360 ms, p95 ~600 ms |
| Sustained cold-cache load on the public mainnet RPC | **44% of verifications rejected with HTTP 429** at 2 verifications/s (6 RPC calls/s) from one client. Testnet: 0 errors. |
| `MAX_BATCH_SIZE = 20` | **Holds.** The binding mainnet limit is contract events: 51 rows. 20 uses 39% of it. |
| What a credential actually costs | **0.156 XLM to issue** (measured; ~0.136 XLM expected on mainnet), then **~0.31 XLM/year** of storage rent on mainnet, whoever pays it |
| TTL a credential actually gets | **~180 days** (3,110,399 ledgers), not the "1 year" the contract comments assumed |
| Keeper at 10k / 100k credentials | **Does not keep up.** One transaction per credential, 50 per day, covers 4,500 credentials. A page of 50 takes 202 s at p50 and **320 s at p95, over the 300 s function limit**. |
| Cold starts with Upstash rate limiting | **Not measured.** No Upstash credentials were available. See [Not measured](#not-measured). |

## Method

Everything on **mainnet is read-only**: `getHealth`, `getNetwork`, `getFeeStats`, `getLedgerEntries` and `simulateTransaction` against `https://mainnet.sorobanrpc.com`. Nothing is signed or submitted, and nothing costs anything.

The Acredia contract is not on mainnet, so its reads are modelled with reads of the same shape (contract instance plus one persistent entry) on the native XLM Stellar Asset Contract. The testnet numbers for the real Acredia calls are within a few percent of those stand-ins (table below), which supports the substitution.

On **testnet** the production contract (`CD3NAUTB…ZOY4U`) has no authorized issuer and no credentials, so its issuance and storage cannot be measured. The tool therefore deploys a **throwaway instance of the exact deployed WASM**: its SHA-256 is checked against `52b340df…d4a5` from the [deployment record](../deployments/2026-10-30-testnet.md), and nothing is built or uploaded. It is owned by throwaway friendbot-funded keys that are never written to disk. This run's instance was `CAFK3LY76SU4H5WCP73IGQMDDQWQJ4GCYT7WHJ6OS5AVAMNPQAOUV6QG`. It then issues 3 single credentials and a batch of 20, and runs 12 keeper steps, all as real transactions, so the **fees below are the network's `feeCharged`, not estimates**.

- **Limits and fee schedules** come from each network's own ledger (`getLedgerEntries` on its config settings), not from documentation. Mainnet (protocol 29) and testnet (protocol 30) have the **same limits and fee rates**. The only difference is `soroban_state_target_size_bytes`, which moves the rent rate.
- **Latency:** 60 samples per call, sequential, 150 ms apart, with the app's own 4 s per-request timeout (`RPC_REQUEST_TIMEOUT_MS`). The verification triple has 30 samples, made the way `readOnChainStatus` makes it on a cold cache.
- **Soak:** a new verification starts every 0.5 s whether or not the previous one finished, as real requests would arrive. That's 360 verifications (1,080 RPC calls) over 180 s per network, with no cache.
- **Batch size:** simulate `batch_issue_credential` with 1, 2, 4, 8, 12, 16 and 20 rows. Fit each resource linearly per row (every fit is exact or within rounding), then solve for the largest row count under each mainnet limit.
- **Rent, without a fee formula:** simulate `ExtendFootprintTTL` on the same entries to two targets above their current TTL, and divide the fee difference by the ledger difference. On testnet this is measured on the credential's own two entries. On mainnet (no Acredia entries) it is measured on the native SAC instance. Mainnet is priced from testnet using the ratio of the two networks' per-byte rates on like entries (instance entries on both). On testnet, the per-byte rate from an instance entry (0.00109) and from the credential entries (0.00107) agree, which supports the per-byte normalisation.

Re-run (about 15 minutes, mostly the soak and ledger confirmations), from `frontend/`:

```
npx tsx scripts/measure-rpc-baselines.ts --samples 60 --soak-seconds 180 --soak-rps 2
```

## Latency (ms)

| Call | Network | p50 | p90 | p95 | p99 |
|---|---|---|---|---|---|
| simulate SAC `balance` (instance + persistent read) | mainnet | 362 | 532 | 614 | 771 |
| simulate SAC `decimals` (instance read) | mainnet | 357 | 510 | 570 | 1,347 |
| `getLedgerEntries`, 1 key | mainnet | 353 | 490 | 557 | 884 |
| `getLatestLedger` | mainnet | 1,921 | 2,396 | 2,560 | 3,373 |
| **Cold-cache verification (3 reads)** | **mainnet** | **985** | **1,264** | **1,312** | **1,354** |
| simulate `get_credential` (found) | testnet | 327 | 413 | 465 | 641 |
| simulate `is_revoked` | testnet | 327 | 453 | 464 | 579 |
| simulate `is_authorized_issuer` | testnet | 346 | 463 | 475 | 624 |
| **Cold-cache verification (3 reads)** | **testnet** | **1,020** | **1,285** | **1,346** | **1,399** |

Latency is dominated by the round trip, not by the network: one simulation costs about the same on either. `getLatestLedger` on this mainnet provider is unusually slow (~2 s). Verification does not call it, but `/api/health` and anything new should not depend on it. Two testnet samples (1 in 60 for `is_revoked` and for `is_authorized_issuer`) hit the app's 4 s timeout. That is the case RPC failover (#313) covers.

## Soak: cold cache, 2 verifications/s, 180 s

| | mainnet | testnet |
|---|---|---|
| Verifications succeeded | **202 / 360** | 360 / 360 |
| Errors | **158 × HTTP 429 (rate limited)** | none |
| Latency of successes p50 / p95 / p99 | 932 / 4,492 / 5,522 | 935 / 1,088 / 1,242 |
| p50 by third of the run | 926, 1,143, 898 | 942, 912, 931 |

The public mainnet RPC throttles a single client somewhere below 6 calls/s. The successes slow down too (p95 4.5 s), because throttled requests queue. Testnet's public RPC held the same load flat. What it means for mainnet:

- **The public endpoint is not a production RPC for Acredia.** Use a provider with a contracted rate limit as `NEXT_PUBLIC_SOROBAN_RPC_URL`, and a second, independent provider in `SOROBAN_RPC_FALLBACK_URLS` (#313). An HTTP 429 counts as unavailable and fails over.
- **The verification cache matters most here.** A cache hit costs no RPC calls. All Vercel functions egress through shared addresses, so per-IP throttling on the provider side would bite at a lower aggregate rate than measured here.
- Throttled verifications still answer "Verification unavailable", or a dated last-known answer (#313). They are never shown as invalid.

## `MAX_BATCH_SIZE`: confirmed at 20

Per-row costs of `batch_issue_credential` against mainnet's per-transaction limits:

| Resource | Per row | Fixed | Mainnet limit | Max rows |
|---|---|---|---|---|
| **Contract events** | **312 B** | 180 B | **16,384 B** | **51** |
| Write entries | 2 | 2 | 200 | 99 |
| Footprint entries | 2 | 4 | 400 | 198 |
| Write bytes | 544 B | 328 B | 132,096 B | 242 |
| Transaction size | 524 B | 752 B | 132,096 B | 250 |
| Instructions | 0.53 M | 0.50 M | 400 M | 755 |
| Disk read bytes | 0 | 0 | 200,000 B | — (live Soroban state is in memory) |

The ceilings the old comment cited ("write ledger entries 53 > 50, footprint 109 > 100" at 25 rows) were the test harness's, not today's network's. **20 still holds** and stays. It uses 39% of the binding events budget. Raising it has little value: the fee per credential is the same at 1 or 20 rows (0.1565 vs 0.1556 XLM), because it is almost all rent, so a bigger batch saves signatures, not XLM. Any raise should stay under ~40 to keep events margin, and needs the contract's harness test updated plus a redeploy. The derivation is recorded next to the constant in `contracts/src/lib.rs`.

## Storage and TTL: ~180 days, not a year

- One credential stores **528 bytes**: `Credential` (396 B) and `HashIndex` (132 B).
- Both networks report `max_entry_ttl = 3,110,400` and `min_persistent_ttl = 2,073,600` ledgers. The contract's `PERSISTENT_BUMP_AMOUNT = 6,312,000` ("~1 year") was written for an older limit. The host clamps it: a fresh credential measured `live_until = issue + 3,110,399` ledgers, **~180 days** at the measured 5.0 s per ledger.
- `PERSISTENT_THRESHOLD = 3,110,400` is above any reachable TTL, so **every `bump_credential` re-extends to the maximum**. That is safe: rent is charged per ledger of life whoever extends. But the keeper must reach every credential well within ~180 days, which is what its 90-day coverage window provides. The contract comments now say this. The constants are left unchanged, because changing them needs a redeploy.

## Fees

All in XLM (1 XLM = 10,000,000 stroops). "Measured" means testnet `feeCharged`.

| Operation | Measured (testnet) | Mainnet expected |
|---|---|---|
| Issue 1 credential, `issue_credential` | 0.1565 (the very first: 0.1861, which also creates `TotalCredentials`) | ~0.137 |
| Issue 20, `batch_issue_credential` | 3.1117, i.e. **0.1556 each** | **~0.136 each** |
| `bump_credential`, nothing to extend | 0.00090 | 0.00090 + rent |
| Storage rent per credential | 0.566 stroops/ledger = **0.357/year** | **0.313/year** |
| Inclusion fee (`getFeeStats`, last 50 ledgers) | p50 100 | **p50–p99 200** |

Issuance prepays the first ~180 days of rent. It prepays at less than a later extension over the same ledgers costs, so its fee is used as measured rather than split. Budgets below use the measured testnet issuance fee (conservative); the "expected" figure scales it by the mainnet/testnet rent ratio (0.876).

The keeper bids a fixed **100-stroop** inclusion fee (`fee: '100'` in the cron route). Mainnet's Soroban inclusion fee is 200 at every percentile right now, so under any contention the keeper's transactions are outbid. It should bid from `getFeeStats`, at p90 or higher with a cap.

## Cost at three volumes (mainnet)

| | 1,000 credentials | 10,000 | 100,000 |
|---|---|---|---|
| Issuance, one-time (measured fee; expected) | 156 (136) | 1,556 (1,362) | 15,559 (13,624) |
| **Storage rent, per year** | **313** | **3,126** | **31,262** |
| Current keeper: covers every credential? | yes | **no** | **no** |
| Current keeper: transaction overhead per year | 17 (18,250 tx) | 17, but does not cover | 17, but does not cover |
| Batched keeper (20 credentials per tx, every 90 days): tx per year | 250 | 2,500 | 25,000 |
| Batched keeper: transaction overhead per year | 2 | 18 | 184 |

**Rent is the cost.** It scales with credentials × bytes × time, and it is the same however the keeper is built. Transaction overhead is noise next to it. At 100k credentials, storage alone is ~31k XLM a year. The levers are fewer bytes per credential (528 B now), or not keeping every credential live forever (archive and restore on demand).

## Keeper capacity

One keeper step, timed exactly as `src/app/api/cron/ttl-keeper/route.ts` runs it (TTL read, account load, simulate, sign, send, poll every 2 s), over 12 tokens: **p50 4.0 s, p95 6.4 s** (an earlier run: p50 5.9 s). A page is 50 sequential steps:

- **202 s at p50, 320 s at p95, against `maxDuration = 300`.** At p95 only 46 steps fit. A slow day already times out part-way: the cursor saves progress, but that page is short.
- One transaction per credential at 50 per day covers 50 × 90 = **4,500 credentials**. The route flags `capacityExceeded` beyond that. 10k and 100k need a different design.

A batched keeper fixes both. One `ExtendFootprintTTL` transaction can extend up to **200 credentials** (400 footprint entries, read bytes allow 378). Extending 20 credentials simulated at 0.0074 XLM before rent, against 0.0009 each one at a time. At 100k credentials that is 500 transactions per 90-day pass, about 6 a day. This is a recommendation for a follow-up issue, not part of this change.

## Not measured

- **Cold starts with distributed rate limiting (Upstash).** It needs a real Upstash database; none was available to this run. To measure: deploy a preview with `UPSTASH_REDIS_REST_*` set, let the function go idle for 15 minutes or more, then time the first `/api/verify` and `/api/health` against warm ones. The Upstash call has a 3 s bound (`AbortSignal.timeout(3_000)` in `src/lib/rateLimit.ts`).
- **Mainnet issuance as a real transaction.** Mainnet is read-only by design. The expected figures above price the testnet measurements with mainnet's rent rate; every other fee rate is identical on the two networks.
