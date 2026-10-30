# 0004 — Owner Override for Credential Revocation

**Status:** Accepted  
**Date:** 2026-09-30  
**Issue:** [#288](https://github.com/soumen0818/ACREDIA-STELLAR/issues/288)

> **Event names changed on 2026-10-30** (codebase review §3.8, typed `#[contractevent]` events): `cred_rev_owner` is now `credential_revoked_by_owner` and `cred_rev` is now `credential_revoked`. The decision below is unchanged.

---

## Context

`revoke_credential(token_id, issuer)` checks `credential.issuer == issuer` and nothing else: only the exact address that originally issued a credential can revoke it. This is the right default — an institution's attestations should be the institution's to invalidate, and the platform should not casually override them.

But it leaves one scenario with no on-chain remedy: an issuer's signing key is **compromised or lost**. Once that happens:

- The contract owner can stop the issuer minting *new* credentials (`revoke_issuer`), but
- there is no path to revoke a *specific bad credential already issued* — the only address that could revoke it is the very key that is compromised or gone.

For a credentialing platform this is a real incident-response gap: a credential issued fraudulently with a stolen issuer key (or one the institution can no longer legitimately manage) stays "valid" forever.

The audit (F-5) deliberately left this open because closing it changes *who* can invalidate an institution's attestations — a governance decision, not a pure security fix. This document is that decision.

## Options considered

1. **No override (status quo).** Simple and maximally issuer-sovereign, but leaves the compromised-key gap permanently open. Rejected.
2. **Owner override with a distinct, audited event (chosen).** Add an owner-gated `admin_revoke_credential(token_id)` that can revoke any credential, but emit a *different* event (`cred_rev_owner`) so that a platform revocation is always publicly distinguishable from an issuer's own revocation. The override exists, but it can never be used to silently impersonate the issuer.
3. **Owner override reusing the `cred_rev` event.** Simplest to implement, but it would let a platform revocation be indistinguishable from an issuer's own — precisely the trust erosion we want to avoid. Rejected.

## Decision

Adopt **Option 2**.

- `admin_revoke_credential(token_id)` — owner-gated via `read_owner(&env).require_auth()` (owner read from storage, never a caller argument). Revokes any existing, not-already-revoked credential regardless of the original issuer's current authorization status. Respects the emergency pause. Shares the same monotonic, idempotent-safe revocation state as `revoke_credential` (`AlreadyRevoked` / `CredentialNotFound` behave identically from either path).
- It emits **`cred_rev_owner`** (topics: the symbol + `token_id`; data: the owner address), *distinct* from the issuer path's `cred_rev`.
- The off-chain indexer records which path revoked a credential in a `revocation_source` column (`'issuer'` vs `'platform'`), and the public verification API and UI surface that distinction to anyone verifying the credential.

### Guarantee

> The platform can revoke a credential over an issuer's head **only in the open**. Every platform-initiated revocation is recorded on-chain under a distinct `cred_rev_owner` event and is shown to verifiers as a *platform* revocation, never as the issuing institution's own. The platform cannot silently masquerade as the issuer.

## Consequences

- **Incident response**: compromised-/lost-key situations now have an on-chain remedy for individual bad credentials, complementing `revoke_issuer` (which only stops future minting).
- **Trust model, made explicit**: issuers remain the default revoker of their own credentials; the platform's override is a narrow, always-attributed escape hatch, not a silent super-power.
- **Verifier-visible**: verification responses distinguish issuer vs platform revocation, so relying parties can factor the *source* of a revocation into their own trust decisions.
- **New surface**: adds `admin_revoke_credential`, the `cred_rev_owner` event, a `revocation_source` column in the off-chain index, and a `revocationSource` field in the public verification API.
- **Owner-key sensitivity**: this concentrates more power in the owner key; the existing multi-sig-owner recommendation for production (see the contract README's upgrade governance) applies here too.
