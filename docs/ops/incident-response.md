# Incident Response & On-Call Plan

**Issue:** [#306 — No incident-response or on-call plan](https://github.com/soumen0818/ACREDIA-STELLAR/issues/306)
**Status:** Adopted — prerequisites in [§11](#11-prerequisites-before-this-plan-is-live) outstanding
**Last reviewed:** 2026-10-17
**Exercised:** [2026-10-17 desk-check — fraudulent issuer](../incidents/exercises/2026-10-17-fraudulent-issuer-tabletop.md)

> **Who this is for:** whoever is on call for Acredia, the contract owner-key
> holders, and anyone who has to decide — under pressure — whether to pull an
> emergency lever. Read it before you are on call, not during an incident.

Decide before an incident, not during one. This document decides:

1. [Roles](#1-roles) and [who is on call and how they are reached](#2-on-call)
2. [How incidents arrive](#3-how-incidents-arrive)
3. [Severity levels](#4-severity-levels), grounded in this product
4. [The emergency levers and who may pull them](#5-the-emergency-levers)
5. [The `pause()` decision path](#6-the-pause-decision-path)
6. [Playbooks](#7-playbooks) for the scenarios we already know about
7. [User communication](#8-user-communication)
8. [Post-incident review](#9-post-incident-review) and where writeups live

It complements, and does not replace:

| Document | Covers |
|---|---|
| [ops/runbook.md](./runbook.md) | Signals, dashboards and alert thresholds that *start* an incident |
| [owner-key-custody.md](../owner-key-custody.md) | The 2-of-3 owner multisig and its signing procedure |
| [ops/ttl-keeper-runbook.md](./ttl-keeper-runbook.md) | Keeper failures and archived-credential restore |
| [ops/pin-redundancy.md](./pin-redundancy.md) | IPFS pin health and repair |
| [support-procedures.md](../support-procedures.md) | Account recovery identity checks — a different problem |

---

## 1. Roles

Acredia is a small team, so one person may hold several roles. Two rules never
bend: **the two owner-key signatures must come from two different people**,
and **the Incident Commander does not also sign** unless no other holder can
be reached.

| Role | Responsibility | Who |
|---|---|---|
| **Incident Commander (IC)** | Owns the incident from declaration to close: sets severity, decides on levers (with key holders, §6), assigns roles, keeps the timeline. | The primary on-call engineer, until they hand off explicitly. |
| **Owner-key holder** | Reviews and co-signs owner-gated contract calls (`pause`, `unpause`, `revoke_issuer`, `admin_revoke_credential`, `cancel_upgrade`, `transfer_owner`). Never signs blind. | The three holders named in the internal security registry ([custody §2.1](../owner-key-custody.md#21-key-holders)). |
| **Communications lead** | Writes and posts every user-facing update (§8). | Named by the IC at declaration; defaults to the secondary on-call. |
| **Scribe** | Keeps the timestamped incident log: decisions, commands, transaction hashes. | Anyone not doing the above; for SEV3/4 the IC. |

## 2. On-call

| | |
|---|---|
| **Rotation** | Weekly, Monday 09:00 UTC handover. One **primary** and one **secondary**, never the same person two weeks running. |
| **Coverage** | SEV1/SEV2: 24×7 best effort until mainnet, then 24×7 committed. SEV3/SEV4: business hours (the on-call's local time). |
| **Roster and contact details** | The internal security registry — the same private record that names the owner-key holders. Phone numbers and personal contacts never go in this public repository. |
| **How on-call is reached** | 1. The paging tool (alerts from [runbook.md § Alerts](./runbook.md#alerts) route here). 2. Phone, from the registry. 3. The team's private incident chat channel. |
| **Escalation** | Primary does not acknowledge within the target in §4 → page secondary → after the same interval again, phone every owner-key holder in registry order. |
| **Handover** | Outgoing primary posts open incidents, active mitigations (e.g. "contract is paused"), and pending follow-ups in the incident channel. |

Until the paging tool is provisioned ([§11](#11-prerequisites-before-this-plan-is-live)),
alerts reach no one automatically; treat the testnet deployment as
monitored on a best-effort basis only.

## 3. How incidents arrive

| Source | Examples | Notes |
|---|---|---|
| Automated alerts | Exception spikes, uptime failures, IPFS errors, retention purge failures ([runbook.md](./runbook.md#alerts)); keeper `failed`/`partial`/`lowBalance` ([keeper runbook](./ttl-keeper-runbook.md)) | Thresholds live in those documents, not here. |
| On-chain events | An `iss_auth`, `own_xfer`, `upg_prop`, `paused`, `unpaused` or `cred_rev_owner` event **nobody filed a request for** | Every owner-gated call requires a written request first ([custody §2.3](../owner-key-custody.md#23-what-counts-as-an-authorized-use)). An unrequested owner event is an incident, full stop. |
| Institutions | Their POC reports issuance failures, a lost or compromised issuer wallet, or credentials they did not issue | Via `/contact` or their direct Acredia contact. |
| Verifiers and students | "This credential says verified but the institution says it never issued it"; "verification is down" | Via `/contact` or GitHub issues. |
| Security researchers | A vulnerability report | Must arrive privately — see [§11](#11-prerequisites-before-this-plan-is-live): `SECURITY.md` does not yet name a private channel. |

Anyone may **declare** an incident; declaring costs nothing. The IC can
downgrade or close it.

## 4. Severity levels

Severity is about **trust in credentials first, availability second**. A
credential that verifies when it should not is worse than a verification page
that is down.

| Level | Definition | Ack target | Update cadence | Examples in Acredia |
|---|---|---|---|---|
| **SEV1 — Critical** | Credential trust is broken or the owner key is not under our control. | 15 min | Every 60 min | • Owner key compromised (§7.1) — two of three multisig keys, or the single testnet owner key.<br>• A fraudulent issuer authorized (§7.4).<br>• An unrequested `upg_prop`, `own_xfer` or `cred_rev_owner` on-chain.<br>• Verification returns `verified` for a revoked or forged credential. |
| **SEV2 — Major** | A core function is down, or trust will break within days if nothing is done. | 30 min | Every 2 h | • Public verification down — Soroban RPC outage returns 503 `chain_unavailable`, Supabase outage returns 500 (§7.3).<br>• Credentials approaching on-chain expiry: keeper failing with `minRemainingTtlLedgers` low, or any entry archived (§7.2).<br>• One owner multisig key compromised (2-of-3 still holds).<br>• An institution's issuer wallet compromised.<br>• Issuance failing for all institutions. |
| **SEV3 — Minor** | Degraded, with a workaround or a comfortable margin. | 4 business hours | Daily | • IPFS/Pinata outage — verification still answers from the chain, document integrity reports `unavailable` (§7.3).<br>• One failed keeper run with ample TTL margin.<br>• Retention purge failed (privacy policy at risk if it persists beyond 48 h — escalate to SEV2 then).<br>• Rate limiter fell back to in-memory mode. |
| **SEV4 — Low** | Cosmetic or single-user, no trust impact. | Next business day | On resolution | A single institution's UI error; a broken docs link. |

When unsure between two levels, pick the higher one. Downgrading later is free.

## 5. The emergency levers

Every lever below already exists. "Authorizes" is who may decide to pull it;
"executes" is who can technically do it.

### 5.1 Contract levers (owner-gated)

On **mainnet**, every owner call needs **two owner-key holders** signing the
same envelope ([custody §4 step 3](../owner-key-custody.md#step-3--build-one-acceptance-envelope-and-collect-two-signatures)).
On **testnet** today the owner is a single CLI identity
([deployment record](../deployments/2026-10-02-testnet.md)), so its holder can
execute alone — the IC must still agree before they do.

| Lever | Effect | Does **not** | Authorizes | Reversible? |
|---|---|---|---|---|
| `pause` | Blocks `issue_credential`, `batch_issue_credential`, `revoke_credential`, `admin_revoke_credential` for everyone (`ContractPaused`). | Stop owner governance (`authorize_issuer`, `revoke_issuer`, ownership transfer, upgrades, `unpause`); stop reads, verification or `bump_credential`. | See §6. | Yes — `unpause`. |
| `unpause` | Restores the four calls above. | — | IC + two key holders (§6.5). | Yes — `pause`. |
| `revoke_issuer(issuer)` | That issuer can no longer issue. Indexer marks the institution `suspended`; verifiers then see `issuerStatus: "revoked"`. | Revoke any credential already issued — they still verify as **verified** (with the issuer flagged). Works while paused. | IC + two key holders. | Yes — `authorize_issuer`. |
| `admin_revoke_credential(token_id)` | Revokes one credential over the issuer's head; emits `cred_rev_owner`; verifiers see it as a *platform* revocation within ~45 s ([ADR 0004](../decisions/0004-owner-credential-revocation-override.md)). | Work while paused. | IC + two key holders, per credential list reviewed by both. | **No.** Revocation is permanent. |
| `cancel_upgrade` | Removes a pending upgrade proposal before its ~7-day timelock ends ([ADR 0005](../decisions/0005-upgrade-timelock.md)). | Undo an upgrade already executed. | IC + two key holders. | Re-propose. |
| `transfer_owner` → `accept_owner` | Moves ownership to a new account (key rotation). | Take effect until the new owner accepts. | Two key holders not suspected of compromise. | Yes, by another transfer. |

**Not a lever:** there is no contract call that freezes the owner key itself.
Against a compromised owner, `pause` protects nothing — the attacker can
`unpause`. Contract tests lock this behaviour in
(`test_pause_does_not_freeze_owner_governance`, `test_pause_blocks_admin_revoke`,
`test_revoke_issuer_works_while_paused`, `test_keeper_and_reads_work_while_paused`
in `contracts/src/lib.rs`).

### 5.2 Anyone-can-call contract levers

| Lever | Effect | Executes |
|---|---|---|
| `bump_credential(token_id)` | Extends a live credential's TTL. Works while paused. | The keeper, or anyone with a funded account. |
| `stellar contract restore --key-xdr …` | Restores an archived credential entry ([keeper runbook](./ttl-keeper-runbook.md#archived-credential-recovery-rehearsal)). | Anyone with a funded account. |

### 5.3 Platform levers

| Lever | Effect | Authorizes / executes |
|---|---|---|
| Switch Soroban RPC / Horizon provider | `NEXT_PUBLIC_SOROBAN_RPC_URL` / `NEXT_PUBLIC_HORIZON_URL` in Vercel → **redeploy** (these are compiled into the build). | IC; anyone with Vercel production access. |
| Vercel instant rollback | Reverts a bad frontend/API deploy in seconds. | IC; anyone with Vercel production access. |
| Rotate a server secret | Per the secret's provider; redeploy afterwards. | IC. |
| Admin console | Authorizes issuers and manages institutions. **It has no pause, revoke-issuer or admin-revoke action** — those are CLI-only (§6.4). | Admin accounts. |

## 6. The `pause()` decision path

`pause` is a circuit breaker for **credential state**: it stops every issuer
from issuing and every revocation, while verification and the TTL keeper keep
working. It is the right tool in a narrow set of situations and actively
harmful in others.

### 6.1 Pause when

All of these hold:

1. **New credentials (or revocations) are themselves untrustworthy right now**
   — a contract or app bug is minting bad credentials, or issuer keys are being
   abused and you cannot yet tell which ones; **and**
2. a **targeted** lever cannot contain it — e.g. you cannot name the single
   offending issuer for `revoke_issuer`; **and**
3. the owner key is **not** suspected of compromise (if it is, go to §7.1).

### 6.2 Do not pause when

| Situation | Why not | Do instead |
|---|---|---|
| One known fraudulent issuer | `revoke_issuer` stops them alone, and works while paused. Pausing also blocks the `admin_revoke_credential` calls you will need next. | §7.4 |
| Owner key compromised | The attacker holds the same authority and can `unpause`. | §7.1 |
| Verification down (RPC/IPFS) | Pause changes nothing about reads. | §7.3 |
| Credentials expiring | The keeper keeps working while paused; pause does not help. | §7.2 |
| You need to revoke credentials right now | Pause **blocks** revocation. | Revoke first, pause after if still needed. |

### 6.3 Who decides

| Network | Proposes | Authorizes | Executes |
|---|---|---|---|
| Mainnet | Any responder, to the IC | **The IC and one owner-key holder agree**, recorded in the incident log with the reason against §6.1 | **Two** owner-key holders sign the same envelope; the IC does not sign unless no other holder can be reached |
| Testnet (single owner identity today) | Any responder, to the IC | The IC | The holder of the owner CLI identity |

If the IC cannot reach any key holder within the SEV1 ack target, keep paging
(§2) — there is no way to pause without them, by design.

### 6.4 Executing

1. **Revoke anything that must be revoked first.** Once paused, neither
   `revoke_credential` nor `admin_revoke_credential` will work.
2. Build and sign the call. Testnet:
   ```bash
   stellar contract invoke --network testnet --source <OWNER_IDENTITY> \
     --id <CONTRACT_ID> -- pause
   ```
   Mainnet: build with `--build-only`, simulate, and collect two hardware
   signatures on the same envelope exactly as in
   [custody §4 step 3](../owner-key-custody.md#step-3--build-one-acceptance-envelope-and-collect-two-signatures),
   replacing `accept_owner` with `pause`.
3. Confirm, from a separate read:
   ```bash
   stellar contract invoke --network <net> --source <FUNDED_READ_ACCOUNT> \
     --id <CONTRACT_ID> -- is_paused
   ```
   must print `true`. Record the transaction hash and the `paused` event.
4. Within 30 minutes, post the pause notice (§8). Institutions trying to issue
   now see: *"Acredia has temporarily paused credential issuance and revocation
   while an incident is handled…"*.

### 6.5 Unpausing

Unpause when the cause is understood and contained — a fix is deployed, the
offending issuer is revoked, or the IC has written down why the remaining risk
is acceptable. Same authorization as pausing (§6.3); confirm `is_paused` reads
`false`; post the resumption notice. A pause that lasts longer than 24 hours
needs the IC to re-confirm §6.1 in the incident log every 24 hours.

## 7. Playbooks

Each playbook is a starting point; the IC may deviate and records why.

### 7.1 Owner key compromised — SEV1 (one multisig key: SEV2)

**Detect:** an unrequested owner event (§3), a holder reports a lost or exposed
device, or Horizon shows unexpected signer changes on the owner account.

1. Declare. Freeze all routine owner-gated work; no one signs anything that is
   not part of this response.
2. **Establish the blast radius**: which keys are exposed? Read the owner
   account's signers and thresholds from Horizon, `get_owner`,
   `get_pending_owner` and `get_pending_upgrade`.
3. **One key of three** (threshold still honest): the two unaffected holders
   `transfer_owner` to a fresh multisig without the exposed key and
   `accept_owner` ([custody §3.1](../owner-key-custody.md#31-one-key-compromised-or-lost)).
4. **Two keys, or the single testnet key**: assume the attacker can do
   anything the owner can. Pause is useless here (§6.2). Preserve evidence
   (all owner events since the suspected exposure), notify institutions, and
   follow [custody §3.2](../owner-key-custody.md#32-two-keys-compromised-simultaneously)
   — recovery may mean a new contract and a public migration.
5. If an `upg_prop` is pending that we did not file: `cancel_upgrade` if we
   still control the owner, and in any case **announce it publicly** — the
   ~7-day timelock exists so verifiers can stop relying on the contract before
   unknown code goes live.
6. Review every `iss_auth` and `cred_rev_owner` since the suspected exposure;
   treat unrequested ones as §7.4.

### 7.2 Credentials expiring on-chain — SEV2

**Detect:** keeper alert (`failed`, `partial`, `bumpFailed`, `capacityExceeded`,
low `minRemainingTtlLedgers`, missed run), or a verifier reports a known-good
credential as "not found".

1. Read `/api/admin/stats` → `stats.ttlKeeper` and the latest `cron_run_log` rows.
2. Fix the cause per the [keeper runbook](./ttl-keeper-runbook.md#responding-to-a-partial-or-failed-run)
   (fund the signer, fix the cron secret, RPC, or capacity).
3. Bump at-risk entries manually with `bump_credential` — anyone can, and it
   works while paused.
4. For an entry already **archived**: restore it with `--key-xdr`, then
   `verify_credential` and `bump_credential`
   ([keeper runbook](./ttl-keeper-runbook.md#archived-credential-recovery-rehearsal)).
   Do not conclude a credential is gone from a single failed read.
5. Do **not** pause; it does not help.

### 7.3 Verification down — RPC or IPFS outage

**Soroban RPC down (SEV2):** `/api/verify` returns 503 `chain_unavailable`;
issuance also fails. Confirm against the provider's status page, then switch
`NEXT_PUBLIC_SOROBAN_RPC_URL` (and Horizon if needed) to a known-good provider
and **redeploy**. Switch back once the primary recovers, again with a redeploy.

**IPFS/Pinata down (SEV3):** verification still answers from the chain;
document integrity shows `unavailable`. Follow
[pin-redundancy.md](./pin-redundancy.md). Escalate to SEV2 if issuance is
blocked for more than a few hours, since new credentials cannot be pinned.

**Supabase down (SEV2):** sign-in and issuance fail, and so does public
verification — `/api/verify` reads the credential index first and returns 500
on a database error, even though the chain is healthy. Track the provider's
status; there is no alternative database to fail over to. Point verifiers who
cannot wait at the contract's `verify_credential` on a block explorer.

### 7.4 A fraudulent issuer authorized — SEV1

**Detect:** an unrequested `iss_auth` event, an institution reporting
credentials it did not issue, or a verifier report.

1. Declare SEV1. **Do not pause** (§6.2).
2. `revoke_issuer(<address>)` — stops further issuance by that address and
   works whether or not the contract is paused.
3. **List everything they issued**: `cred_iss` events whose data names the
   issuer, cross-checked with
   `SELECT token_id FROM credentials WHERE issuer_wallet_address = '<address>';`.
   The chain is authoritative, but Stellar RPC `getEvents` only keeps recent
   history (about 7 days by default). For older activity use the indexer's
   database or a historical archive (e.g. a block explorer's event history),
   and reconcile the count against `get_credential` reads.
4. Two key holders review that list, then `admin_revoke_credential` each token
   ID. Until this step, those credentials still read as **verified** — the
   issuer flag alone does not change the result.
5. Confirm a sample through `/api/verify/<token>`: `revoked: true`,
   `revocationSource: "platform"` (within ~45 s).
6. Find how the authorization happened (request process bypassed? owner key
   misused? — if so, §7.1) and notify affected students and verifiers (§8).

## 8. User communication

### 8.1 Where status is posted

There is no status page yet ([§11](#11-prerequisites-before-this-plan-is-live)).
Until one exists:

| Audience | Channel |
|---|---|
| Everyone (public record) | A **pinned GitHub issue** in this repository, labelled `incident`, titled `[SEVn] <short description>`. Every update is a comment. |
| Institutions | Direct email to each institution's POC from the Acredia support address. |
| Security-sensitive details | Withheld from public posts until fixed; disclosed in the post-incident review. |

### 8.2 Who writes it

The **Communications lead** drafts; the **IC approves** before anything is
posted. Nobody else posts about an open incident in public.

### 8.3 What we promise — and don't

We promise to:

- post the first notice within **30 minutes** of declaring a SEV1 or SEV2,
  and within the update cadence in §4 after that, **even if nothing changed**;
- say plainly what users can and cannot do right now (e.g. "verification
  works; issuance is paused");
- publish a post-incident review for every SEV1 and SEV2.

We do not promise:

- a time to resolution before we know the cause;
- a root cause before the review.

We never ask anyone for a secret key, seed phrase or password, in any update,
email or chat. Say so in SEV1 notices — attackers imitate incident emails.

### 8.4 Templates

**Initial**

> **[SEV1] Credential issuance paused** — 2026-10-17 14:05 UTC
> We are investigating *<one line, user-visible symptom>*. **Right now:**
> existing credentials can be verified as normal; issuing and revoking
> credentials is paused. We will update this by 15:05 UTC. Acredia will never
> ask for your wallet secret key.

**Update**

> **Update 14:55 UTC** — *<what changed / what we know>*. *<What users can do
> now.>* Next update by 15:55 UTC.

**Resolved**

> **Resolved 16:20 UTC** — *<what was affected, from when to when>*. *<Any
> action users must take.>* A post-incident review will follow by *<date>*.

## 9. Post-incident review

| | |
|---|---|
| **Required for** | Every SEV1 and SEV2; SEV3 at the IC's discretion. |
| **When** | Draft within **5 business days** of resolution. |
| **Format** | Blameless. Timeline (UTC, with transaction hashes), impact, detection, what went well, what didn't, root cause, action items. |
| **Where** | `docs/incidents/YYYY-MM-DD-<slug>.md` in this repository. Security-sensitive details may be held back until fixed, then added. |
| **Action items** | Each one becomes a GitHub issue linked from the review, with an owner. |
| **Plan changes** | If the incident showed this plan was wrong, change it in the same pull request as the review. |

**Exercises** are written up the same way under `docs/incidents/exercises/`.

## 10. Exercises

Run a tabletop at least **quarterly**, and before mainnet, rotating through the
§7 playbooks. A scenario counts as exercised only when the people who would
actually be on call took part. The first desk-check — run against the code,
not yet with the team — is
[2026-10-17 — fraudulent issuer](../incidents/exercises/2026-10-17-fraudulent-issuer-tabletop.md).

## 11. Prerequisites before this plan is live

This plan is decided; these pieces of it are not yet in place.

- [ ] On-call roster and contact details recorded in the internal security registry.
- [ ] A paging tool provisioned, with [runbook.md](./runbook.md#alerts) alerts and the keeper's independent monitor routed to it.
- [ ] On-chain event monitoring that pages on `iss_auth`, `own_xfer`, `upg_prop`, `paused`, `unpaused` and `cred_rev_owner` — today these are only noticed if someone looks.
- [ ] A hosting and monitoring decision for the indexer (`npm run indexer`): verifiers' `issuerStatus` depends on it, and it has no documented home.
- [ ] A private security-report channel named in `SECURITY.md` (e.g. GitHub private vulnerability reporting). `SECURITY.md` also refers to a `SECRETS_ROTATION.md` that does not exist.
- [ ] A public status page (Issue 26); until then, §8.1.
- [ ] Owner multisig in place ([custody §5](../owner-key-custody.md#5-acceptance-criteria-tracking)) — until then one person can pull every lever in §5.1.
- [ ] A tabletop with the real on-call team (§10).
