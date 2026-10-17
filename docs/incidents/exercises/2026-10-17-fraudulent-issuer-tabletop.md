# Exercise 2026-10-17 — A fraudulent issuer is authorized

**Type:** Desk-check tabletop against the code and contract tests
**Plan under test:** [docs/ops/incident-response.md](../../ops/incident-response.md)
**Scenario playbook:** [§7.4 — A fraudulent issuer authorized](../../ops/incident-response.md#74-a-fraudulent-issuer-authorized--sev1)
**Facilitated by:** Claude Code (AI coding assistant), at the request of maintainer @soumen0818
**Related issue:** [#306](https://github.com/soumen0818/ACREDIA-STELLAR/issues/306)

## What kind of exercise this was

A **desk-check**: each inject was walked through the plan, and every action the
plan prescribes was checked against what the code and the contract actually do
— by reading the source and by running contract tests written for the purpose.
No on-call staff took part, so it tested *the plan and the system*, not *the
people*. It does not replace a tabletop with the real on-call team, which
remains open in [§11 of the plan](../../ops/incident-response.md#11-prerequisites-before-this-plan-is-live).

## Scenario

Mainnet, after launch. The owner is the 2-of-3 multisig. An attacker
social-engineers one key holder into co-signing an `authorize_issuer` call
that appears to be for a legitimate new university; the second signature comes
from a holder who signed without checking the request (violating
[custody §2.3](../../owner-key-custody.md#23-what-counts-as-an-authorized-use)).
The attacker's address `G…FRAUD` is now an authorized issuer and starts
minting credentials for fake graduates.

## Timeline of injects

### T+0 — The authorization lands on-chain

*Inject:* `iss_auth(G…FRAUD)` is emitted. No request exists for it.

| Plan says | System reality | Result |
|---|---|---|
| Unrequested owner event → SEV1 (§3, §4) | Correct by policy, but **nothing watches for it**: there is no on-chain event monitoring; the indexer updates the database, it does not alert. | ❌ Gap **F-8** |

Detection therefore falls to T+2 days.

### T+2 days — A real university reports credentials it never issued

*Inject:* the University of X's POC emails: three people hold "verified"
Acredia degrees in its name.

| Plan says | System reality | Result |
|---|---|---|
| Declare SEV1; IC paged; ack in 15 min (§2, §4) | Policy is defined. **No paging tool and no roster are provisioned yet.** | ⚠️ Prerequisite (§11) |
| Do **not** pause for a single known issuer (§6.2) | Correct: pause would block the `admin_revoke_credential` calls needed in step 4. Verified by new contract test `test_pause_blocks_admin_revoke`. | ✅ |

*Discussion:* the instinctive move is to hit `pause`. Before this exercise,
`pause()`'s own doc comment said it halts "all state-changing entrypoints",
which would have led a responder to believe pausing also froze the attacker's
authorization. It does not.

### T+2 days +20 min — Stop further issuance

| Plan says | System reality | Result |
|---|---|---|
| `revoke_issuer(G…FRAUD)`, two holders sign (§7.4 step 2) | Works, including while paused — `test_revoke_issuer_works_while_paused`. | ✅ |
| Execute via CLI (§6.4) | The admin console has **no** revoke-issuer, admin-revoke or pause action; this is CLI-only. Holders must have the CLI, hardware wallet and multisig envelope flow ready. | ⚠️ **F-7** |

### T+2 days +40 min — What do verifiers see now?

| Question | System reality | Result |
|---|---|---|
| Do the fake credentials stop verifying after `revoke_issuer`? | **No.** `/api/verify` computes `verified` from the on-chain record, hash match and the credential's own revocation only. The fakes still read `verified: true`. | ⚠️ **F-5** — playbook step 4 is mandatory, not optional |
| Is the issuer at least flagged? | `issuerStatus` comes from `institutions.verified` in the database, set by the indexer. An attacker address with **no** institution row reads `issuerStatus: "revoked"` from the start, so the flag never distinguished it from a legitimately revoked issuer. And the indexer has no documented production host. | ❌ **F-6** |

### T+2 days +1 h — Enumerate and revoke the fakes

| Plan says | System reality | Result |
|---|---|---|
| List the issuer's credentials from `cred_iss` events, cross-checked with the database (§7.4 step 3) | `cred_iss` data carries the issuer address, so the chain can answer. But RPC `getEvents` keeps only ~7 days; this attack is 2 days old, so it works here — at 8+ days it would not. The database copy depends on the indexer having run. | ⚠️ **F-11** |
| Two holders review the list, `admin_revoke_credential` each (§7.4 step 4) | Works while unpaused; distinct `cred_rev_owner` event; verifiers see a platform revocation within ~45 s (revocation cache TTL). Existing tests `test_admin_revoke_*`. | ✅ |
| Irreversibility is respected | `admin_revoke_credential` cannot be undone; the plan requires both holders to review the list first. | ✅ |

### T+2 days +1 h 30 min — Institutions try to issue during the response

*Variation:* suppose the IC had paused after all. A legitimate institution
tries to issue.

| Plan says | System reality (before this exercise) | Result |
|---|---|---|
| Users see that issuance is deliberately paused (§6.4 step 4) | They saw `Simulation failed: HostError: Error(Contract, #10)` — indistinguishable from a bug. | ❌ **F-4** — fixed |

### T+2 days +2 h — Communication

| Plan says | System reality | Result |
|---|---|---|
| Public notice within 30 min on a pinned GitHub issue; institutions emailed (§8) | Workable today. There is no status page (Issue 26); the GitHub issue is the interim public record. | ⚠️ Prerequisite (§11) |
| Never ask for secrets; say so in SEV1 notices | In the templates. | ✅ |

### Close — Root cause

The root cause is a process failure (a blind co-signature), which the contract
cannot prevent. The custody process's "written request first" rule
([custody §2.3](../../owner-key-custody.md#23-what-counts-as-an-authorized-use))
is the control, and on-chain event monitoring (F-8) is the backstop that would
have cut detection from two days to minutes.

## Findings

| ID | Finding | Status |
|---|---|---|
| F-1 | Pausing blocks `admin_revoke_credential` as well as issuance, so pausing first would have stalled the cleanup. | **Addressed** — plan §6.2/§6.4 ("revoke first"); locked in by `test_pause_blocks_admin_revoke`. |
| F-2 | `pause()`'s doc comment claimed it halts all state-changing entrypoints. | **Fixed** — comment now lists exactly what is and is not blocked. |
| F-3 | Pause does not freeze owner governance (`authorize_issuer`, transfers, upgrades, `unpause`), so it is no defence against a compromised owner key. | **Addressed** — plan §5.1, §6.2, §7.1; locked in by `test_pause_does_not_freeze_owner_governance`. |
| F-4 | During a pause, issuers saw a raw `Error(Contract, #10)`. | **Fixed** — `invokeContractMethod` now explains the pause (`CONTRACT_PAUSED_MESSAGE`); covered in `tests/contractsInvoke.test.ts`. |
| F-5 | `revoke_issuer` leaves past credentials reading `verified: true`. | **Addressed** — by design (ADR 0004); playbook §7.4 makes per-credential admin revocation mandatory. |
| F-6 | `issuerStatus` is derived from the database and the indexer, not the chain; an issuer with no institution row reads "revoked" from the start, and the indexer has no documented host. | **Open** — plan §11 (indexer hosting); consider reading issuer status from the chain. |
| F-7 | Emergency contract levers are CLI-only. | **Open** — commands documented in plan §6.4; key holders must rehearse them ([custody §4 step 4](../../owner-key-custody.md#step-4--verify-ownership-and-privileged-operations)). |
| F-8 | No on-chain event monitoring; an unrequested `iss_auth` is noticed only when someone complains. | **Open** — plan §11. |
| F-9 | `SECURITY.md` names no private reporting channel and refers to a missing `SECRETS_ROTATION.md`. | **Open** — plan §11. |
| F-10 | On testnet the owner is a single CLI identity: one person can execute every lever, and a single key compromise is a full owner compromise. | **Open** — tracked as mainnet blocker [readiness §3.2](../../mainnet-readiness.md#32-contract-owner-key-custody--decided-rehearsal-pending). |
| F-11 | Stellar RPC keeps ~7 days of events; older fraud cannot be enumerated from RPC alone. | **Addressed** in plan §7.4 step 3; depends on F-6 (a reliable indexer) to be fully closed. |

## Verification evidence

- `cargo test --locked --lib` in `contracts/`: 91 passed, including the four
  new pause-matrix tests named above.
- `npx vitest run tests/contractsInvoke.test.ts` in `frontend/`: the pause
  message tests pass, and contract errors `#1`/`#100` are not mistaken for a pause.
- Code read for each "System reality" claim: `contracts/src/lib.rs`
  (`pause`, `revoke_issuer`, `admin_revoke_credential`), `frontend/src/app/api/verify/[token]/route.ts`,
  `frontend/src/lib/contractReads.ts` (`isAuthorizedIssuer`),
  `frontend/src/lib/indexerEvent.ts`, `frontend/src/lib/verificationCache.ts`.

## Next exercise

With the real on-call team, before mainnet: **§7.1 Owner key compromised**,
two keys of three — the scenario this plan is least able to contain.
