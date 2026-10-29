# Data Model & GDPR Compliance — Acredia

> **Issue #160** — This document satisfies the acceptance criterion:
> *"on-chain immutability is documented and justified."*

---

## Overview

Acredia stores data across three distinct layers with different mutability characteristics.

```
┌─────────────────────────────────────────────────────────────────┐
│  LAYER            │  CONTENT                    │  MUTABLE?     │
├───────────────────┼─────────────────────────────┼───────────────┤
│  Supabase DB      │  PII (name, email, metadata) │  YES ✓       │
│  IPFS (Pinata)    │  Credential docs + metadata* │  YES (unpin) │
│  Stellar Blockchain│  SHA-256 hash + CID pointer  │  NO ✗        │
└─────────────────────────────────────────────────────────────────┘
```

\* Not encrypted today; see the note under Layer 2.

---

## Layer 1 — Supabase Database (purgeable)

All personally identifiable information lives in Supabase:

| Table | PII columns | On erasure |
|-------|-------------|-----------|
| `profiles` | `email`, `full_name`, notification preferences | Row deleted |
| `students` | `name`, `email` | **Retained** — the institution's roster record. Only its link to the account (`auth_user_id`) is removed. |
| `institutions` | `name`, `email` | **Retained** — organisation data. Staff accounts are removed by support, who hand over the contact first. |
| `credentials` | `metadata` (JSONB — contains student name, degree, grade) | **Retained** — credentials stay verifiable. |

Account deletion is **account-only** (decided 2026-10-29, review §3.10). It removes the login, the profile and the account's link to the roster, which is what the Delete screen and the privacy policy describe. Roster records and credentials belong to the institution, the data controller for them; requests to correct or remove them go to the institution. Only students self-serve deletion; institution staff and admins request removal through support (`docs/support-procedures.md` §4).
| `verification_logs` | `verifier_email`, `verifier_org` (optional) | Auto-purged after 90 days |

**Non-PII columns retained after erasure** (not subject to Art. 17):

- `credentials.blockchain_hash` — SHA-256 one-way hash
- `credentials.ipfs_hash` — IPFS CID (content address pointer)
- `credentials.token_id` — on-chain token identifier
- `credentials.issued_at`, `credentials.revoked` — audit timestamps

---

## Layer 2 — IPFS / Pinata

> **⚠ Correction (2026-10-29), under review as §3.11 of the codebase review.** This section previously said credential documents and metadata are encrypted with AES-256-GCM before upload. **They are not**: the encryption helper exists in `src/lib/ipfsServer.ts` but is never called, and documents and metadata are pinned in plain form. Their IPFS addresses are public on-chain, so the content is readable by anyone who looks them up. The design for fixing this is the next item of work.

Credential documents (PDFs, images) and metadata JSON objects are pinned to IPFS through Pinata when a credential is issued.

- Account deletion does **not** unpin them: the credentials stay verifiable (§3.10).
- Unpinning only stops Pinata from hosting the content. Copies already fetched or pinned elsewhere on IPFS are outside Acredia's control.

---

## Layer 3 — Stellar Blockchain (immutable — not PII)

When a credential is issued, the following is written on-chain:

```
token_id         → unique identifier for this credential NFT
blockchain_hash  → SHA256(canonical-JSON(credential metadata))
issuer_wallet    → Stellar public key of the issuing institution
student_wallet   → Stellar public key of the student
```

### Why the hash is not personal data

Under **GDPR Recital 26**:

> *"The principles of data protection should therefore not apply to anonymous information, namely information which does not relate to an identified or identifiable natural person or to personal data rendered anonymous in such a manner that the data subject is not or no longer identifiable."*

The `blockchain_hash` is a one-way SHA-256 digest of the credential metadata. Without access to the original metadata document, an observer **cannot reverse the hash** to identify the individual.

> **⚠ To revisit (2026-10-29).** This paragraph previously added that Acredia deletes the metadata on erasure, and concluded the hash is anonymous. Neither holds today: account deletion retains credentials (§3.10), and the metadata is publicly readable on IPFS (§3.11). Whether the on-chain hash and IPFS pointer are personal data must be re-assessed with the §3.11 design and confirmed by counsel.

### Why it cannot be erased

Blockchain records are technically immutable. There is no `DELETE` operation on Stellar's ledger. Attempting to comply with Art. 17 by deleting the underlying PII (DB + IPFS) achieves the same practical outcome: the credential hash remains on-chain, but without the metadata it is meaningless.

We rely on the exemption in **GDPR Art. 17(3)(b)**:

> *"The right [to erasure] shall not apply to the extent that processing is necessary: (b) for compliance with a legal obligation which requires processing by Union or Member State law … or for the performance of a task carried out in the public interest …"*

Academic credential verification serves a legitimate public-interest function. The hash anchors the academic record permanently, which is the core value proposition for institutions and employers. The immutability is both technically unavoidable and legally justified.

---

## Data Retention Schedule

| Data | Retention | Basis |
|------|-----------|-------|
| Account profile and login | Until the account is deleted | Contract |
| Student roster records and credentials | Retained as the institution's records; not removed by account deletion | Institution (controller) |
| IPFS credential documents | Retained with the credential; not unpinned on account deletion | Institution (controller) |
| Verification logs | 90 days (auto-purge via `purge_old_verification_logs()`) | Legitimate interest |
| Erasure request records | 7 years | Legal compliance |
| On-chain hash records | Permanent | Art. 17(3)(b) GDPR |

---

## Erasure Flow (Technical)

Self-service, students only:

```
Student clicks "Delete my account" (Settings)
  │
  ▼
POST /api/account/erase   (bearer token required)
  │
  ├─► Refuse with 403 self_deletion_not_available if the account has any
  │   institution tie (profile role institution/admin, trusted admin email,
  │   any institution_users row, or institutions.auth_user_id) — support
  │   handles those (docs/support-procedures.md §4)
  │
  ├─► INSERT erasure_requests (status = 'processing')
  │
  ├─► CALL process_erasure(request_id)   [service_role only]
  │       UPDATE students SET auth_user_id = NULL   (record retained)
  │       DELETE FROM profiles                      (email, name, preferences)
  │       UPDATE erasure_requests SET status = 'completed'
  │
  └─► supabase.auth.admin.deleteUser(userId)
          (erasure_requests has no foreign key to auth.users, so the record
           survives for its 7-year retention)
  │
  ▼
204 No Content → client signs out → redirect to /
```

Nothing is unpinned and no credential, roster or institution data is changed.

---

## References

- [GDPR Art. 17 — Right to erasure](https://gdpr-info.eu/art-17-gdpr/)
- [GDPR Recital 26 — Anonymous data](https://gdpr-info.eu/recitals/no-26/)
- [GDPR Art. 17(3)(b) — Exemption](https://gdpr-info.eu/art-17-gdpr/)
- [Pinata Unpin API](https://docs.pinata.cloud/api-reference/endpoint/unpin-file)
- [Stellar Ledger Immutability](https://developers.stellar.org/docs/learn/fundamentals)
- `frontend/supabase/migrations/20260801000000_gdpr_erasure.sql` — original SQL migration
- `frontend/supabase/migrations/20261029020000_fix_account_erasure.sql` — account-only erasure, erasure records outlive the account
- `frontend/src/app/api/account/erase/route.ts` — API route
- `frontend/src/app/legal/privacy/page.tsx` — Privacy Policy
