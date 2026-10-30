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
│  Supabase Storage │  Credential documents        │  YES ✓       │
│  Stellar Blockchain│  SHA-256 hash, wallets, dates│  NO ✗        │
└─────────────────────────────────────────────────────────────────┘
```

Until 2026-10-30, credential documents and metadata were also pinned to public IPFS, unencrypted, with a pointer on-chain. That design was retired (codebase review §3.11); see Layer 2.

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

- `credentials.blockchain_hash` — the issuance transaction hash
- `credentials.document_sha256` — SHA-256 of the credential document
- `credentials.token_id` — on-chain token identifier
- `credentials.issued_at`, `credentials.revoked` — audit timestamps

---

## Layer 2 — Supabase Storage (private documents)

Credential documents (PDFs, images) are stored in the private Supabase Storage bucket `credential-documents`, under the issuing institution's folder with a random file name. The credential itself (a W3C VC / Open Badges 3.0 JSON document) is stored in `credentials.metadata` (Layer 1). Since 2026-10-30 nothing is pinned to IPFS.

- **Nothing is public.** Documents are served only through signed URLs that expire after 5 minutes: to the credential holder, to members of the issuing institution, and to anyone the holder gives the credential's share link (`/credentials/<share_token>`, a random UUID). A credential's token ID alone shows only its issuer, dates and status.
- **Anchored, not published.** The document's SHA-256 is recorded inside the credential, so the on-chain hash covers it. The share page lets the viewer's browser check the document against that digest.
- Account deletion does **not** remove documents: the credentials stay verifiable (§3.10).

> **History.** Before 2026-10-30 these documents and the metadata were pinned to public IPFS without encryption, and their IPFS address was stored on-chain, where anyone could read it. This document previously said they were encrypted with AES-256-GCM; they were not. Content pinned under that design may have been copied by third parties and cannot be recalled. On testnet, the redeploy retires those credentials.

---

## Layer 3 — Stellar Blockchain (immutable — not PII)

When a credential is issued, the following is written on-chain:

```
token_id         → unique identifier for this credential
credential_hash  → SHA256(canonical-JSON(credential metadata))
issuer           → Stellar public key of the issuing institution
student          → Stellar public key of the student
issued_at        → ledger time of issuance
expires_at       → optional expiry time, fixed at issuance
```

There is no pointer to the credential's content or document.

### Why the hash is not personal data

Under **GDPR Recital 26**:

> *"The principles of data protection should therefore not apply to anonymous information, namely information which does not relate to an identified or identifiable natural person or to personal data rendered anonymous in such a manner that the data subject is not or no longer identifiable."*

The `credential_hash` is a one-way SHA-256 digest of the credential metadata. Without access to the original metadata document, an observer **cannot reverse the hash** to identify the individual.

> **⚠ For counsel (updated 2026-10-30).** This paragraph previously added that Acredia deletes the metadata on erasure, and concluded the hash is anonymous. Account deletion now retains credentials (§3.10), so the metadata remains in Acredia's private database. Since §3.11 the metadata is no longer public and there is no on-chain pointer to it, but the holder's wallet address sits next to the hash on-chain. Whether the on-chain record is personal data must be confirmed by counsel.

### Why it cannot be erased

Blockchain records are technically immutable. There is no `DELETE` operation on Stellar's ledger. Attempting to comply with Art. 17 by deleting the underlying PII (database and Storage) achieves the same practical outcome: the credential hash remains on-chain, but without the metadata it is meaningless.

We rely on the exemption in **GDPR Art. 17(3)(b)**:

> *"The right [to erasure] shall not apply to the extent that processing is necessary: (b) for compliance with a legal obligation which requires processing by Union or Member State law … or for the performance of a task carried out in the public interest …"*

Academic credential verification serves a legitimate public-interest function. The hash anchors the academic record permanently, which is the core value proposition for institutions and employers. The immutability is both technically unavoidable and legally justified.

---

## Data Retention Schedule

| Data | Retention | Basis |
|------|-----------|-------|
| Account profile and login | Until the account is deleted | Contract |
| Student roster records and credentials | Retained as the institution's records; not removed by account deletion | Institution (controller) |
| Credential documents (private Storage) | Retained with the credential; not removed by account deletion | Institution (controller) |
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

No credential, document, roster or institution data is changed.

---

## References

- [GDPR Art. 17 — Right to erasure](https://gdpr-info.eu/art-17-gdpr/)
- [GDPR Recital 26 — Anonymous data](https://gdpr-info.eu/recitals/no-26/)
- [GDPR Art. 17(3)(b) — Exemption](https://gdpr-info.eu/art-17-gdpr/)
- [Stellar Ledger Immutability](https://developers.stellar.org/docs/learn/fundamentals)
- `frontend/supabase/migrations/20260801000000_gdpr_erasure.sql` — original SQL migration
- `frontend/supabase/migrations/20261029020000_fix_account_erasure.sql` — account-only erasure, erasure records outlive the account
- `frontend/supabase/migrations/20261030000000_private_credential_documents.sql` — private document bucket, share tokens, expiry; IPFS pin registration dropped
- `frontend/src/app/api/account/erase/route.ts` — API route
- `frontend/src/app/legal/privacy/page.tsx` — Privacy Policy
