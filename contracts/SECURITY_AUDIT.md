# AcrediaCredential Contract — Security Audit

**Contract**: `AcrediaCredential` (`contracts/src/lib.rs`)
**Scope**: `contracts/src/lib.rs`, `contracts/Cargo.toml`
**Type**: Internal manual security review (source-level, plus `cargo clippy` and `cargo audit`)
**Status**: Findings below are resolved or explicitly accepted/tracked as noted per-finding.

> This document records an **internal** review. It is groundwork for, and does not replace,
> the independent third-party audit required before mainnet deployment — see
> [MAINNET_CHECKLIST.md](./MAINNET_CHECKLIST.md), item 1. Share this report and the checklist
> with the external auditor as a starting point; re-open any finding here that they dispute or
> want to dig into further.

## Methodology

- Full manual read-through of every public entrypoint in `AcrediaCredential`, focused on:
  access control (who can call what, and how that is enforced), state transitions and their
  invariants, storage/TTL handling, integer arithmetic, and event coverage.
- `cargo clippy --all-targets` — no lints on production code (3 pre-existing style warnings in
  test helper code only, unrelated to correctness or security).
- `cargo audit` against the dependency tree (193 crates) — no known-vulnerable (RUSTSEC) crates
  in use; see F-9.
- New tests written to encode the trust model as executable checks: explicit owner/pending-owner
  auth-gating tests for every privileged entrypoint, and a proptest-based invariant test that
  drives randomized sequences of issuance/revocation and checks core invariants after every step
  (`mod proptest_invariants` in `src/lib.rs`).

## Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| F-1 | Medium | `initialize()` auth fixed; deploy-time owner race remains | **Partial — constructor required before mainnet** |
| F-2 | Low | `upgrade()` emitted no event | **Fixed** |
| F-3 | Low | `migrate()` emitted no event | **Fixed** |
| F-4 | Info | `initialize()` emitted no event | **Fixed** |
| F-5 | Medium | No owner override for `revoke_credential` | **Fixed** — distinct owner override |
| F-6 | Low | `revoke_issuer` on a never-authorized address is a silent no-op that still emits `iss_rev` | **Fixed** |
| F-7 | Info | No length cap on `ipfs_uri` | **Fixed** — 256-byte cap, error 17 |
| F-8 | Info | `read_owner()` uses `.unwrap()`, relying on an invariant rather than a typed error | **Accepted (safe today)** |
| F-9 | Info | Dependency hygiene (`cargo audit`) | **Informational** |
| F-10 | Info | Re-entrancy | **Reviewed, not applicable** |

---

### F-1 (Medium) — `initialize()` had no authorization check

**Before**: `initialize(owner: Address)` set `owner` from the caller-supplied argument with no
`require_auth()` call at all. Anyone could call `initialize` on a freshly deployed,
not-yet-initialized contract and set *any* address as owner — including an address the caller
does not control (e.g. a typo'd address or a burn address), which would permanently brick the
contract's admin functions, since `Owner` is otherwise immutable outside of an
owner-authorized `transfer_owner`/`accept_owner` flow.

**Fix**: `initialize()` now calls `owner.require_auth()` before writing state
([lib.rs](./src/lib.rs), `initialize`). This closes the "set an address I don't control"
bricking variant, because the caller must now produce a valid signature for whatever address
they pass as `owner`.

**Residual risk (not fully closed by this fix)**: an attacker who front-runs the legitimate
deploy transaction can still call `initialize(their_own_address)` and become the owner
themselves, since they can always sign for their own address. The contract alone cannot prevent
this without changing to an atomic constructor-at-deploy pattern (out of scope
for this pass — see `MAINNET_CHECKLIST.md`). Soroban permits only one contract
operation per transaction, so separate deploy and `initialize` calls **cannot**
be bundled atomically. Immediate initialization and owner verification limit
testnet risk but do not close the race. **Before mainnet**, add and audit an
owner-setting `__constructor` that runs during deployment. Treat any unexpected
`init` event as a compromised deployment and discard that instance.

**Test coverage**: `test_initialize_requires_owner_auth`.

### F-2 / F-3 / F-4 — Missing events on `upgrade`, `migrate`, `initialize`

`upgrade()` (WASM code replacement) and `migrate()` (schema migration) are the two highest-impact
owner actions in the contract, yet neither emitted an event; `initialize()` didn't either.
Off-chain indexers/monitoring had no reliable on-chain signal for "the contract's code just
changed" or "the contract just came into existence." Fixed by adding `init`, `upgraded`
(topic + new WASM hash), and `migrated` (topics: `migrated`, previous version; data: new version)
events. Covered by `test_initialize_event`, `test_upgrade_event`, `test_migrate_event`.

**Follow-up hardening (#290) — `upgrade()` timelock and announcement path**: emitting an
`upgraded` event tells observers the code *has already* changed, which is too late to react to.
`upgrade()` is now split into a two-step, owner-gated propose/execute flow. `propose_upgrade`
records the target WASM hash together with a `ready_ledger = current_ledger +
UPGRADE_TIMELOCK_LEDGERS` (120 960 ledgers, ~7 days at 5 s/ledger) and emits `upg_prop` (the
public announcement, readable on-chain via `get_pending_upgrade`). `upgrade` then succeeds only
when a proposal exists, the supplied hash matches the proposed one, and the current ledger has
reached `ready_ledger`; otherwise it returns `UpgradeNotProposed`, `UpgradeHashMismatch`, or
`UpgradeTimelockActive` and mutates nothing. `cancel_upgrade` (owner-gated, emits `upg_cncl`)
abandons a pending proposal. This gives credential holders and verifiers a fixed, observable
window to inspect the proposed code before it can take effect, rather than learning of a code
change only after the fact. Rationale and the chosen window are documented in
[docs/decisions/0005-upgrade-timelock.md](../docs/decisions/0005-upgrade-timelock.md); the public
policy is stated in [README.md](./README.md) and the public API docs. Covered by
`test_propose_upgrade_emits_event`, `test_propose_upgrade_records_pending`,
`test_upgrade_without_proposal_rejected`, `test_upgrade_before_timelock_rejected`,
`test_upgrade_hash_mismatch_rejected`, `test_cancel_upgrade_clears_pending`,
`test_cancel_upgrade_without_proposal_rejected`, and the updated happy-path `test_upgrade_event` /
`test_upgrade_owner_gated` (which now propose and advance past the timelock before executing).

### F-5 (Medium) — No owner override for `revoke_credential`

`revoke_credential` checks `credential.issuer == issuer` and nothing else — only the exact
address that originally issued a credential can revoke it, even after that issuer has since been
deauthorized via `revoke_issuer`. If an issuer's signing key is compromised or lost, the contract
owner can stop that issuer from minting *new* credentials, but has no path to revoke a
*specific bad credential* already issued by them.

**Decision**: this was a real trust-model tradeoff, not a pure security bug — adding an owner
override changes *who* can invalidate an institution's attestations, so it needed a deliberate
governance decision rather than a silent code change. That decision has now been made and is
recorded in [docs/decisions/0004-owner-credential-revocation-override.md](../docs/decisions/0004-owner-credential-revocation-override.md):
the platform adds a **narrow, auditable owner-gated escape hatch** for compromised-issuer
incident response, without letting the platform silently masquerade as the issuer.

**Fix**: added `admin_revoke_credential(token_id)`, gated on `read_owner(&env).require_auth()`
(the owner read from storage, never a caller-supplied address). It revokes any existing,
not-already-revoked credential regardless of whether the original issuer is still authorized —
which is exactly the compromised-/lost-key case the issuer-only `revoke_credential` cannot handle.
It shares the same monotonic, idempotent-safe revocation state as `revoke_credential`
(`AlreadyRevoked` on a second attempt from *either* path, `CredentialNotFound` for an unknown
token), and it respects the emergency pause. Crucially, it emits a **distinct** `cred_rev_owner`
event (data: the owner address) instead of `cred_rev`, so every downstream verifier can tell
"the issuing institution revoked this" apart from "the platform revoked this over the issuer's
head". The off-chain indexer records the distinction on a `revocation_source` column and the
public verification API/UI surface it, so the override can never be used to silently impersonate
an issuer's own revocation. The public guarantee is stated in [README.md](./README.md) and on the
public verification page.

**Test coverage**: `test_admin_revoke_credential` (owner revokes an issued credential),
`test_admin_revoke_works_after_issuer_deauthorized` (the core compromised-issuer scenario: works
even after the issuer is deauthorized via `revoke_issuer`), `test_admin_revoke_requires_owner_auth`
(rejected without the owner's signature, state unchanged), `test_admin_revoke_nonexistent_rejected`
(`CredentialNotFound`), `test_admin_revoke_already_revoked_rejected` (an issuer-revoked credential
cannot be re-revoked by the owner — monotonic across both paths), and
`test_admin_revoke_emits_distinct_event` (the `cred_rev_owner` topic, distinct from `cred_rev`).

### F-6 (Low) — `revoke_issuer` no-op on a never-authorized address still emits `iss_rev`

Calling `revoke_issuer(x)` for an `x` that was never authorized is a harmless no-op (removing a
nonexistent storage key is safe in Soroban), but it previously still published an `iss_rev`
event, which could mislead an off-chain indexer into believing `x` was previously authorized —
events are the on-chain audit trail, so one that claims a state change that never happened
undermines their value for compliance and incident reconstruction.

**Fix**: `revoke_issuer` now reads the authorization state (persistent, then instance) *before*
mutating anything. It removes the `Authorized` entry and publishes `iss_rev` only when the
address was actually authorized; revoking a never-authorized address is a true no-op that emits
no event. The public signature is unchanged (`revoke_issuer` still returns `()`), so this is not
an ABI change for callers — only the event semantics change, from "always fires" to "fires only
when something changed". Revoking a genuinely authorized issuer behaves exactly as before.

**Test coverage**: `test_revoke_never_authorized_issuer_emits_no_event` (no-op path emits no
event) and `test_revoke_authorized_issuer_emits_event_and_deauthorizes` (authorized path still
emits and deauthorizes); the pre-existing `test_issuer_revoked_event` continues to cover the
authorized path.

### F-7 (Info) — No length cap on `ipfs_uri`

**Before**: `issue_credential` (and `batch_issue_credential`) accepted an unbounded `String` for
`ipfs_uri`. An authorized issuer could push storage costs up with an oversized value. They pay
their own transaction fees, so this is a self-inflicted cost rather than an attack on other users
— but leaving the bound to the frontend/backend means it is only enforced off-chain, and any
caller that constructs the contract call directly (bypassing the app) faces no on-chain limit at
all. A legitimate IPFS URI is well under 100 bytes (a CIDv1 in base32 is ~60 chars, plus the
`ipfs://` scheme); there is no honest reason for it to run into the hundreds of bytes.

**Fix**: added `MAX_IPFS_URI_LEN = 256` and a typed `IpfsUriTooLarge` error, enforced on-chain in
**both** issuance entry points. `issue_credential` rejects an oversized URI with
`Err(IpfsUriTooLarge)` before writing any state. `batch_issue_credential` treats it as a per-row
failure — the offending row is recorded as a failed `BatchIssueResult` with
`error_code = IpfsUriTooLarge` and skipped, while the remaining rows are still attempted (matching
the existing duplicate-hash handling), so one bad row does not fail the whole batch. The bound of
256 bytes is generous for any real IPFS URI (see above) while keeping each credential a
bounded-size persistent entry. The public signatures are unchanged, so this is not an ABI change
for callers issuing within the limit.

**Test coverage**: `test_issue_credential_at_ipfs_uri_boundary_succeeds` and
`test_issue_credential_rejects_oversized_ipfs_uri` (single-issue path, at the limit and one over);
`test_batch_issue_at_ipfs_uri_boundary_succeeds` and
`test_batch_issue_rejects_oversized_ipfs_uri_row_others_succeed` (batch path, at the limit and a
mixed batch where the oversized row fails while a valid row still succeeds).

### F-8 (Info) — `read_owner()` relies on an invariant instead of a typed error

```rust
fn read_owner(env: &Env) -> Address {
    require_initialized(env);
    env.storage().instance().get(&DataKey::Owner).unwrap()
}
```

Safe today because `initialize()` is the only place `Initialized` and `Owner` are ever set, and
it sets both together. Flagged as a latent footgun for future refactors that might decouple the
two. Not changed here: `read_owner` returns a bare `Address` and is called from non-`Result`
functions (`authorize_issuer`, `revoke_issuer`, `upgrade`); converting it to return
`Result<Address, ContractError>` would ripple into those functions' on-chain signatures, which
is a larger, deliberate ABI change out of proportion to the actual risk.

### F-9 (Info) — Dependency hygiene

`cargo audit` (1173 advisories, 193 crates scanned) reports no CVE-level vulnerabilities.
Two informational warnings, both transitive and not exploitable in this contract:

- `paste 1.0.15` — unmaintained (RUSTSEC-2024-0436).
- `spin 0.9.8` — yanked version.

**Recommendation**: add `cargo audit` to CI (see `MAINNET_CHECKLIST.md`) so newly-disclosed
advisories are caught automatically rather than at ad hoc review time.

### F-10 (Info) — Re-entrancy — reviewed, not applicable

The contract makes no cross-contract calls other than `env.deployer().update_current_contract_wasm`
during `upgrade` (owner-gated, no user-controlled callback). Soroban's storage/host model does not
expose the classic EVM-style re-entrancy surface here. No action needed.

## Positive findings (things reviewed and found sound)

- **Owner-gating architecture**: privileged entrypoints call `.require_auth()` on the address
  *read from contract storage* (`read_owner(&env)`), never on a caller-supplied "admin" argument.
  This rules out a common class of bug where a naive `caller == admin` check can be bypassed by
  simply passing a different `caller` argument.
- **Two-step ownership transfer** (`transfer_owner` / `accept_owner`) prevents an irreversible
  mistake from a single mistyped address.
- **TTL/archival handling**: every write and read path extends TTL on the affected entries
  (`extend_credential_ttl`, `extend_instance_ttl`, `extend_total_credentials_ttl`), and this is
  now covered by tests that advance the simulated ledger sequence well past the default minimum
  TTL and assert data survives. See the "Storage Archival & TTL Strategy" section of
  [README.md](./README.md).
- **Emergency pause**: `pause`/`unpause` gate all state-changing entrypoints while leaving
  `verify_credential`/`get_credential` readable, so verification keeps working during an incident.
- **Revocation is monotonic and idempotent-safe**: no `unrevoke` path exists; a second
  `revoke_credential` on an already-revoked credential fails with `AlreadyRevoked`. Verified
  by `mod proptest_invariants`, which fuzzes randomized issue/revoke sequences and checks this
  (and duplicate-hash rejection, sequential token IDs, and `total_credentials` correctness) holds
  after every step, not just in a handful of hand-picked scenarios.

## Test additions from this review

All added to `contracts/src/lib.rs`:

- `test_initialize_requires_owner_auth`, `test_transfer_owner_requires_owner_auth`,
  `test_accept_owner_requires_pending_owner_auth`, `test_authorize_issuer_requires_owner_auth`,
  `test_revoke_issuer_requires_owner_auth`, `test_pause_requires_owner_auth`,
  `test_unpause_requires_owner_auth`, `test_upgrade_requires_owner_auth`,
  `test_migrate_requires_owner_auth` — each disables `mock_all_auths()` mid-test via
  `env.set_auths(&[])` and proves the call is rejected *and* state is unchanged, rather than just
  asserting the source contains a `require_auth()` call.
- `test_initialize_event`, `test_upgrade_event`, `test_migrate_event` — cover the new events.
- `mod proptest_invariants::invariant_issuance_and_revocation_hold` — property/fuzz test over
  randomized issue/revoke operation sequences (proptest, 48 cases per run, auto-shrinking on
  failure) asserting: token IDs are sequential; a hash backs at most one credential ever; only the
  recorded issuer can revoke; revocation is monotonic; `total_credentials` always equals the
  number of successful issuances; every issued credential stays retrievable by ID and by hash with
  state matching the model.

Run with `cargo test --lib` from `contracts/`. Total: 51 tests, all passing.
