# 0006 — Institution Member Continuity and the Mainnet Second-Member Rule

**Status:** Proposed — awaiting maintainer acceptance
**Date:** 2026-10-17
**Issue:** [#307](https://github.com/soumen0818/ACREDIA-STELLAR/issues/307)
**Builds on:** [0003 — Multiple users per institution](./0003-multiple-institution-users.md)

---

## Context

[ADR 0003](./0003-multiple-institution-users.md) made membership a relation
(`institution_users`), so an institution *can* have several members. Nothing
made it *likely*: an institution got one POC at provisioning and had no way to
add anyone else without an Acredia admin. In practice every institution had a
single point of contact. If that person was locked out, left, or erased their
account, all issuance and revocation for the institution stopped until an
admin stepped in.

The admin-side POC handover and recovery links make recovery possible. This
decision is about not needing them.

## Decision

### 1. Institutions manage their own members

Owners invite, re-role and remove members from **Team** in the institution
console (`/dashboard/team`), with no Acredia admin involved.

- **Roles:** `owner` (issue, revoke, manage members), `issuer` (issue and
  revoke), `viewer` (read-only). The legacy `poc`/`admin`/`member` values map
  onto these.
- **Invitations are emailed to the invitee and never shown to the inviter.**
  A link the inviting owner could open would let them set the invitee's
  password and stand up a "second member" who is really themselves — passing
  the continuity check while defeating it. If email delivery fails, the owner
  retries or Acredia support sends the invitation.
- Invitations expire after 7 days. Every invite, resend, removal, role change
  and acceptance is written to `admin_audit_logs`.

### 2. An institution can never strand itself

Self-service changes go through `change_institution_member()`, which locks
the institution's membership rows and refuses any change that would leave
**no active owner** or **no active member with issuing rights**. It runs in
one transaction, so two owners removing each other at the same moment still
cannot leave the institution empty. A pending invitation never counts.

The one path that cannot be refused is **account erasure** (GDPR Art. 17). It
is never blocked. Instead, the last member able to issue must explicitly
acknowledge that their institution will stop issuing, and the erasure is
audited with `institution_left_without_issuers`. Erasing a member while others
can still issue no longer suspends the institution; it is handed to a
remaining owner.

### 3. The risk is visible on both sides

- **Institution console:** a persistent, non-dismissible banner on every page
  while fewer than two members can issue, and a prompt to invite a second
  member right after the first owner activates their account.
- **Admin console:** a continuity-risk list of institutions with one person
  (or nobody) able to issue, including those orphaned by an erasure.

### 4. Mainnet: a second member is required before wallet authorization *(proposed)*

On **mainnet**, Acredia does not authorize an institution's wallet
(`authorize_issuer`, signed by the owner multisig) until the institution has
**at least two active members with issuing rights**. An exception is allowed
only with a written reason recorded in the authorization request
([custody §2.3](../owner-key-custody.md#23-what-counts-as-an-authorized-use)).
On **testnet** the rule is advisory: the banner and the admin risk list.

#### Why at authorization, not at every issuance

| Option | Verdict |
|---|---|
| **Block issuance in the app** while there is one member | Rejected. It is not enforceable: the contract only knows the institution's wallet, so whoever holds that wallet can issue on-chain directly, bypassing the app. It would also stop a legitimately small institution mid-term with no warning. |
| **Advisory only, everywhere** | Rejected for mainnet. On testnet a stalled institution costs nothing; on mainnet it stalls graduates' real credentials, and the single-member state is exactly when nobody notices until it is too late. |
| **Require it at wallet authorization** | Chosen. Authorization is the one step Acredia controls for every institution, it already requires a written, two-holder-reviewed request, and it happens before any credential exists. |

The rule cannot stop an institution from shrinking back to one member later.
The admin risk list exists for that; an institution that stays at one member
for 30 days gets a follow-up from Acredia.

### 5. What this does not cover

Issuing on-chain also needs the institution's **Stellar wallet**. A second
member with dashboard access but no ability to sign with the wallet cannot
issue. Wallet key custody is the institution's own responsibility and
Acredia can neither see nor recover it; the Team page says so explicitly.

## Consequences

- Most institutions stop depending on Acredia admins for routine staffing
  changes; POC handover remains for when nobody at the institution can act.
- Removed members lose access immediately. Their membership is deactivated,
  never deleted, so who held issuing rights stays auditable. The deprecated
  `institutions.auth_user_id` column is moved to a remaining owner so it can
  never resurrect a removed member's access.
- New surface: the `change_institution_member()` function; per-member invite
  and removal columns on `institution_users`; four audit actions
  (`invite_member`, `resend_member_invite`, `remove_member`,
  `change_member_role`); `/api/institution/members*` routes.
- Viewers are now assignable, so write routes enforce role server-side,
  including IPFS pinning.

## Open question for acceptance

§4 is a product and policy call. Accepting this ADR accepts the mainnet rule.
Rejecting §4 alone leaves §1–§3 in place and makes the second member advisory
on mainnet too.
