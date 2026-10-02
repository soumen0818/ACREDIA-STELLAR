# Mainnet Readiness Checklist — AcrediaCredential

This checklist gates any future mainnet deployment of the `AcrediaCredential` contract. Every
item must be checked off (or explicitly waived, in writing, by the project owner) before
deploying `--network public`. Pair with [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) for the
findings behind several of these items.

Out of scope for this checklist: the actual mainnet deploy/interaction steps themselves — see
the "Production Deployment (Mainnet)" section of [README.md](./README.md) for that, once this
checklist is fully satisfied.

## 1. Independent third-party audit

- [ ] A third-party firm (not the original contract authors) has performed a security audit of
      `contracts/src/lib.rs`, using [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) as a starting point.
- [ ] Every finding from that audit is tracked to closure (fixed, or explicitly accepted with a
      written rationale, mirroring the Accepted/Fixed pattern used in `SECURITY_AUDIT.md`).
- [ ] The final audit report is linked here once complete: `<link to be added>`.

## 2. Owner-key custody

The `Owner` address can: authorize/revoke issuers, pause/unpause the contract, transfer
ownership, upgrade the WASM, and run migrations. Compromise of this key is a full compromise of
contract governance.

- [ ] `Owner` is **not** a single hot-wallet key held by one individual.
- [ ] `Owner` is either:
  - a Stellar native multi-signature account (multiple signers, appropriate weight thresholds), or
  - a hardware-wallet-backed single key used only for this purpose, or
  - a dedicated multisig/timelock smart contract.
- [ ] Signer set, thresholds, and the recovery process for a lost/compromised signer are
      documented somewhere the whole team can find (link here: `<link>`).
- [ ] Add and audit an owner-setting `__constructor` before mainnet deployment.
      `initialize()` requires owner authorization, but a separate deployment
      and initialization cannot be atomic because Soroban transactions permit
      only one contract operation. Immediate succession is acceptable only for
      disposable testnet rehearsal; see SECURITY_AUDIT.md F-1.
- [ ] The team knows what an unexpected `init` event (from an address they didn't submit) means:
      redeploy before issuing any credentials.

## 3. Upgrade governance

- [ ] Decision made and documented: does `Owner` retain unilateral upgrade power on mainnet, or
      is upgrade gated behind a timelock / separate governance process? (See "Upgrade Governance
      & Security" in README.md — currently single-signature, multisig recommended.)
- [ ] If a timelock is used, its delay is long enough for affected parties (issuers, students,
      verifiers) to notice and react to a proposed upgrade before it executes.
- [ ] `upgrade()` now emits an `upgraded` event with the new WASM hash (SECURITY_AUDIT.md F-2) —
      confirm this event is wired into monitoring/alerting before mainnet, so any upgrade is
      immediately visible to the team (and, ideally, to the public).
- [ ] `migrate()` now emits a `migrated` event (SECURITY_AUDIT.md F-3) — same monitoring
      expectation.
- [ ] Rollback plan exists: if a bad upgrade ships, is there a known-good WASM hash on hand to
      upgrade back to?

## 4. TTL / archival-keeper strategy

Soroban persistent entries expire and become inaccessible (archived) unless their TTL is
extended. See "Storage Archival & TTL Strategy" in README.md for the full mechanism; this
section is the operational go-live gate for it.

- [ ] A keeper bot (or equivalent scheduled job) is deployed and running *before* mainnet launch,
      not added after the first credentials are issued.
- [ ] The keeper enumerates all issued token IDs and calls `bump_credential(token_id)` on a
      recurring schedule (README recommends weekly; confirm the chosen interval leaves comfortable
      margin under the ~6-month re-extend threshold).
- [ ] The keeper (or a separate monitor) also periodically touches instance storage (e.g. calls
      `total_credentials()`) so `Owner`/`Authorized`/`NextTokenId`/`Paused`/`StorageVersion` never
      lapse.
- [ ] Alerting is wired up for any credential whose live-until ledger falls below the ~60-day
      threshold noted in the README, so a keeper outage is caught with time to spare.
- [ ] Someone on the team knows the manual recovery path (`RestoreFootprintOp` via Stellar CLI/
      Horizon) if an entry is archived anyway, and has practiced it on testnet at least once.
- [ ] The **separate** off-chain IPFS pin-redundancy keeper (`frontend/worker/pinKeeper.ts`,
      `docs/ops/pin-redundancy.md`) is also deployed and running, with a second pinning provider
      configured. The TTL keeper above only keeps the on-chain hash/URI record alive — without the
      pin keeper, a lost IPFS pin still makes the document itself unretrievable even though the
      chain record is fine.

## 5. Event coverage

- [ ] Every state-changing entrypoint emits an event. As of this checklist, that's: `init`,
      `own_xfer`, `own_acpt`, `iss_auth`, `iss_rev`, `cred_iss`, `cred_rev`, `paused`, `unpaused`,
      `upgraded`, `migrated`. Re-verify this list against `src/lib.rs` if entrypoints change.
- [ ] Indexers/monitoring subscribe to all of the above, not just the credential-lifecycle events.
- [ ] Decide on F-5/F-6 from SECURITY_AUDIT.md (owner override for `revoke_credential`;
      `iss_rev` firing on never-authorized addresses) before mainnet — both affect what event
      consumers can assume about event semantics.

## 6. Error taxonomy

- [ ] Every `ContractError` variant is documented with its meaning and which entrypoint(s)
      return it — see the "Error Taxonomy" table in README.md. Keep that table in sync with
      `enum ContractError` in `src/lib.rs` whenever a variant is added, removed, or repurposed.
- [ ] Frontend/backend error handling maps each variant to a user-facing message (no raw
      `ContractError(N)` strings surfaced to end users).
- [ ] Distinguish, in frontend copy, between errors that are normal/expected (e.g.
      `CredentialAlreadyExists` from a genuine duplicate submission) and errors that indicate a
      bug or attack (e.g. `UnauthorizedRevoker`).

## 7. Test coverage

- [ ] `cargo test --lib` passes (currently 44 tests: functional, event, TTL/archival,
      pause/circuit-breaker, owner-only-gating, and property/fuzz invariant tests — see
      SECURITY_AUDIT.md "Test additions from this review").
- [ ] Every privileged entrypoint has an explicit test proving it rejects calls without the
      required authorization (`test_*_requires_owner_auth`, `test_accept_owner_requires_pending_owner_auth`)
      — not just tests of the happy path.
- [ ] Property/fuzz tests (`mod proptest_invariants`) cover issuance and revocation invariants —
      extend this suite if new state-changing entrypoints are added.
- [ ] `cargo clippy --all-targets` is clean on production code (pre-existing style-only warnings
      in test helpers are tracked separately and are not a release blocker).
- [ ] `cargo audit` is run and any newly-disclosed CVE-level advisory is resolved (informational
      warnings — see SECURITY_AUDIT.md F-9 — do not block release, but should be re-checked).

## 8. Sign-off

- [ ] All items above are checked or explicitly waived with written rationale from the project
      owner.
- [ ] This checklist itself is reviewed and re-run for any subsequent contract upgrade that
      touches access control, storage layout, or privileged entrypoints — it is not a one-time
      gate.

| Reviewed by | Date | Notes |
|---|---|---|
| | | |
