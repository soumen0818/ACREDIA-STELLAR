# Smart-Contract Third-Party Audit — Scope and Preparation

**Issue**: [#280 — No independent smart-contract audit](https://github.com/soumen0818/ACREDIA-STELLAR/issues/280)
**Status**: Audit not yet engaged — this document prepares the scope, hands the
internal self-review to the auditor, and tracks findings.
**Last reviewed**: 2026-09-29

> **This document does not replace the audit**. When a third-party report is
> delivered, it is published here in `contracts/` and the tracking tables below
> are updated with its findings and resolutions.

---

## 1. What already exists

The contract has 64 passing tests and an internal self-review in
[SECURITY_AUDIT.md](./SECURITY_AUDIT.md). Share both with the external auditor
as a starting point, not as a clean bill of health:

| ID | Severity | Finding | State |
|----|----------|---------|-------|
| F-1 | Medium | `initialize()` auth fixed; deploy-time owner race remains | **Partial — constructor required before mainnet** |
| F-2 | Low | `upgrade()` emitted no event | **Fixed** |
| F-3 | Low | `migrate()` emitted no event | **Fixed** |
| F-4 | Info | `initialize()` emitted no event | **Fixed** |
| F-5 | Medium | No owner override for `revoke_credential` | **Fixed** (`admin_revoke_credential`, distinct event) |
| F-6 | Low | `revoke_issuer` no-op still emits `iss_rev` | **Fixed** (event only on change) |
| F-7 | Info | No length cap on `ipfs_uri` | **Fixed** (`MAX_IPFS_URI_LEN`, `IpfsUriTooLarge = 17`) |
| F-8 | Info | `read_owner()` uses `.unwrap()` | **Accepted** (safe, invariant upheld) |

---

## 2. Audit scope

The following areas must be explicitly included in the engagement letter or
scope document presented to the auditor.

### 2.1 Authorization model

- Owner vs. issuer vs. student privilege separation.
- `require_auth()` placement on every privileged entrypoint.
- The persistent/instance storage migration path in
  `check_and_extend_authorization`.
- Whether the two-step `transfer_owner` / `accept_owner` pattern is sound and
  covers all handover edge cases.

### 2.2 TTL and archival

- The `PERSISTENT_BUMP_AMOUNT` and `PERSISTENT_THRESHOLD` constants and whether
  they map to the intended real-world durations.
- Every `extend_*_ttl` call site, with attention to whether all paths (including
  error paths) extend TTL where expected.
- What happens when a credential entry expires: can it be restored, and by whom?

### 2.3 `batch_issue_credential`

- Partial-failure semantics: if one item in the batch fails, are previous items
  rolled back or committed?
- `MAX_BATCH_SIZE = 20` resource ceiling: is 20 provably safe for compute and
  storage limits?
- In-batch duplicate detection: is a duplicate hash within the same batch
  caught before any storage is written?
- Token-id sequencing: can a batch leave gaps or duplicate IDs?

### 2.4 `upgrade` / `migrate`

- Owner-only gating: verify `require_auth()` on `read_owner()` is the sole
  authorization path.
- Storage-version handling: what does `migrate` do to credentials issued under
  an older schema version?
- What a malicious or buggy WASM replacement could do to existing credential
  records.

### 2.5 Economic / DoS surface

- Unbounded `ipfs_uri`: storage cost borne by the contract vs. the issuer.
- Permissionless `bump_credential`: can an adversary grief the contract by
  bumping TTLs of every entry, inflating the contract's ledger footprint?
- Storage growth: is there any mechanism that lets an unprivileged caller grow
  per-entry or instance storage unboundedly?

---

## 3. Auditor handoff package

The following materials should be provided to the auditor at engagement start:

1. `contracts/src/lib.rs` — the complete contract source.
2. `contracts/Cargo.toml` and `contracts/Cargo.lock` — the pinned dependency
   tree.
3. `contracts/SECURITY_AUDIT.md` — the internal review, so the auditor knows
   what has already been examined and what was accepted.
4. `contracts/MAINNET_CHECKLIST.md` — the deployment checklist.
5. This file (`contracts/THIRD_PARTY_AUDIT.md`) as the formal scope document.
6. The test suite (`cargo test --lib` from `contracts/`) run to green before
   handoff — do not hand over a failing test suite.

---

## 4. Acceptance criteria

- [ ] A written third-party audit report is published in `contracts/`.
- [ ] Every critical or high finding is fixed and re-reviewed by the auditor.
- [ ] Every medium finding is either fixed or explicitly accepted with a
      rationale recorded in this document.
- [ ] Every low/informational finding is triaged and either fixed or accepted.
- [ ] The audited commit is tagged (e.g. `audit/v1-final`).
- [ ] The mainnet deploy uses that exact tagged source — the deploy script or
      CI step asserts the commit hash matches the tag.
- [ ] `docs/mainnet-readiness.md` §3.1 updated to ✅ with a link to the report.

---

## 5. Third-party report — placeholder

> **Pending**: No external audit has been conducted yet. When a report is
> received, it is published here and the findings table below is updated.

| ID | Severity | Finding | Status | Notes |
|----|----------|---------|--------|-------|
| (pending) | — | — | — | — |

---

## 6. Finding resolutions (post-audit)

This section is populated after the external report is received.

| Report ID | Internal ID | Severity | Resolution | Commit |
|-----------|-------------|----------|-----------|--------|
| (pending) | — | — | — | — |
