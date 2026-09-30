# 0005 — Upgrade Timelock & Announcement Path

**Status:** Accepted  
**Date:** 2026-09-30  
**Issue:** [#290](https://github.com/soumen0818/ACREDIA-STELLAR/issues/290)

---

## Context

The `AcrediaCredential` contract is upgradeable: the owner can replace the contract's WASM code in place (`upgrade(new_wasm_hash)`) so bugs can be fixed and logic updated without changing the contract address — which would otherwise break every issued QR code and verification link.

Before this decision, `upgrade` was a single owner-authorized call that took effect immediately. It emitted an `upgraded` event, but that event fires *after* the code has already been replaced. For a credentialing platform this is a meaningful trust gap:

- The whole value of a credential is that a relying party can trust what the issuing/verifying code does. If the owner (or a compromised owner key) can swap the contract's code instantaneously, holders and verifiers have no window to notice a change, inspect the new code, or stop relying on the contract before the new code is live.
- An `upgraded`-after-the-fact event lets monitoring detect a change only once it is irreversible from the observer's point of view.
- The previous README explicitly flagged "governed by a timelock contract" as a production recommendation but left it unimplemented.

## Decision

Split upgrades into a **two-step, timelocked, hash-committed propose/execute flow**, with the proposal published on-chain as an announcement.

### Flow

1. `propose_upgrade(new_wasm_hash)` — owner-gated. Stores a `PendingUpgrade { wasm_hash, ready_ledger }` where `ready_ledger = current_ledger + UPGRADE_TIMELOCK_LEDGERS`, and emits `upg_prop` with `(wasm_hash, ready_ledger)`. Re-proposing overwrites any existing proposal (and resets the clock).
2. `upgrade(new_wasm_hash)` — owner-gated. Succeeds only if **all** of:
   - a proposal exists (else `UpgradeNotProposed`),
   - the supplied hash equals the proposed hash (else `UpgradeHashMismatch`),
   - `current_ledger >= ready_ledger` (else `UpgradeTimelockActive`).
   On success it clears the proposal, emits `upgraded`, and replaces the WASM. Any failure path mutates nothing.
3. `cancel_upgrade()` — owner-gated. Removes a pending proposal and emits `upg_cncl`.
4. `get_pending_upgrade()` — permissionless read of the current proposal (target hash + earliest-execution ledger).

### Chosen window

`UPGRADE_TIMELOCK_LEDGERS = 120_960` ledgers ≈ **7 days** at ~5 s/ledger.

Seven days balances two forces: long enough that holders/verifiers and any monitoring have a realistic window (over a weekend, across time zones) to see the announcement and react; short enough that a genuine security fix is not held hostage for weeks. The window is a single named constant so it can be tuned in a future upgrade if operational experience warrants.

### Why hash-commitment matters

The proposal binds a specific WASM hash, and execution must present the same hash. This closes the "announce benign code, ship different code" gap: what is executed is exactly what was announced and inspectable during the window.

## Consequences

- **Transparency**: every code change has a mandatory, publicly observable ~7-day announcement (`upg_prop` + `get_pending_upgrade`) before it can take effect.
- **Incident response tradeoff**: an emergency fix cannot ship faster than the timelock. This is deliberate — the emergency `pause`/`unpause` circuit-breaker (unchanged, immediate) is the tool for stopping the bleeding *now*, while a code change goes through the announced window. Compromised-key risk on the upgrade path is further mitigated by the multi-sig owner recommendation.
- **ABI change**: `upgrade` now returns `Result<(), ContractError>` and requires a prior `propose_upgrade`. Any operator scripts or tooling that called `upgrade` directly must adopt the propose → wait → execute sequence.
- **New surface**: adds `propose_upgrade`, `cancel_upgrade`, `get_pending_upgrade`, a `PendingUpgrade` type, the `PendingUpgrade` storage key, three typed errors, and the `upg_prop` / `upg_cncl` events.
- **Multi-sig is complementary, not replaced**: the timelock governs *when* an upgrade can happen; a multi-sig owner governs *who* must agree. Production deployments should use both.
