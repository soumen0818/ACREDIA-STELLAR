# Verifiable Credentials (W3C VC / Open Badges 3.0) — Contributor & Verifier Guide

> **Audience:** Developers contributing to ACREDIA-STELLAR, and third parties
> (HR systems, other wallets, badge platforms) that want to ingest or
> independently verify an Acredia credential.

---

## 1. Why

Credential metadata used to be a bespoke NFT-style JSON blob
(`name`/`description`/`attributes`/`credentialData`). That's fine for this
app's own UI, but nothing outside Acredia — LinkedIn, an ATS, another wallet
— has any idea what to do with it.

Every credential issued now is instead modeled as a **W3C Verifiable
Credential (VC Data Model 1.1)** that also conforms to the **1EdTech Open
Badges 3.0 `OpenBadgeCredential` profile**. It's the same JSON document that
is stored privately and canonically hashed on-chain — there is no separate
"export format"; what you download *is* what was anchored.

## 2. Where this lives in code

| Concern | Module |
|---|---|
| Builds the VC/OBv3 document | `src/lib/verifiableCredential.ts` (`buildAcrediaVerifiableCredential`) |
| Validates the document shape | `src/lib/schemas.ts` (`VerifiableCredentialSchema` / `validateVerifiableCredential`) |
| Canonicalizes + hashes for on-chain anchoring | `src/lib/credentialHash.ts` (`buildCanonicalCredentialPayloadV2`, `generateCanonicalCredentialHash`, `deriveCredentialHash`) |
| Issues the credential (stores the document → builds → validates → hashes → anchors) | `src/lib/credentialService.ts` (`issueCredential`) |
| Builds the downloadable export (adds the on-chain anchor block) | `src/lib/standardsExport.ts` (`buildStandardsExportDocument`) |
| "Download VC (.json)" UI | Student dashboard (`StudentCredentialsList.tsx`) and the public showcase page (`PublicCredentialCard.tsx`) |

## 3. Document shape

```jsonc
{
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
    { "acredia": "https://acredia.app/ns#", "credentialData": "acredia:credentialData", "onChainAnchor": "acredia:onChainAnchor" }
  ],
  "id": "urn:uuid:5f2b...",
  "type": ["VerifiableCredential", "OpenBadgeCredential"],
  "name": "degree - Ada Lovelace",
  "description": "Academic credential issued by Acredia Academy to Ada Lovelace",
  "image": null,
  "issuer": {
    "id": "https://stellar.expert/explorer/testnet/account/GISSUER...",
    "type": ["Profile"],
    "name": "Acredia Academy"
  },
  "issuanceDate": "2026-05-31T00:00:00.000Z",
  "credentialSubject": {
    "id": "https://stellar.expert/explorer/testnet/account/GSTUDENT...",
    "type": ["AchievementSubject"],
    "name": "Ada Lovelace",
    "achievement": {
      "id": "urn:acredia:achievement:gissuer...:degree:bsc-computer-science",
      "type": ["Achievement"],
      "name": "BSc Computer Science",
      "description": "Academic degree verified on the Stellar blockchain.",
      "achievementType": "Degree",
      "criteria": { "narrative": "Issued upon successful completion and verification of the stated academic requirements." }
    },
    "result": [{ "type": ["Result"], "resultDescription": "GPA", "value": "3.9" }]
  },
  "evidence": [
    {
      "id": "urn:sha256:<64 hex characters>",
      "type": ["Evidence"],
      "name": "Original credential document",
      "description": "SHA-256 of the source document uploaded by Acredia Academy at issuance. The document is held privately by Acredia."
    }
  ],
  "credentialData": {
    "studentName": "Ada Lovelace",
    "studentWallet": "GSTUDENT...",
    "degree": "BSc Computer Science",
    "major": "Software Engineering",
    "gpa": "3.9",
    "issueDate": "2026-05-31",
    "institutionName": "Acredia Academy",
    "credentialType": "degree",
    "subjects": [{ "id": "math-101", "name": "Mathematics", "marks": "95", "maxMarks": "100", "grade": "A" }]
  }
}
```

Downloaded copies additionally carry two properties that are **never** part
of the hashed/anchored core (see §5):

```jsonc
{
  "credentialStatus": {
    "id": "https://acredia.app/verify?token=42",
    "type": "StellarSorobanRevocationStatus2024",
    "stellarNetwork": "testnet",
    "stellarContractId": "CCON...",
    "stellarTokenId": "42"
  },
  "onChainAnchor": {
    "network": "testnet",
    "contractId": "CCON...",
    "tokenId": "42",
    "transactionHash": "TX...",
    "credentialHash": "5b1c...",
    "hashAlgorithm": "sha256:canonical-json:v2",
    "canonicalizationAlgorithm": "sha256:canonical-json (see this doc)",
    "verifyUrl": "https://acredia.app/verify?token=42",
    "hashCoversThisDocument": true
  }
}
```

## 4. Field mapping

| Standard concept | Field | Source |
|---|---|---|
| Issuer | `issuer.id` / `issuer.name` | Institution's Stellar wallet (resolvable Stellar Expert account URL) / institution name |
| Subject | `credentialSubject.id` / `.name` | Student's Stellar wallet (resolvable account URL) / student name |
| Achievement | `credentialSubject.achievement` | Degree/credential type, mapped `achievementType` (`Degree`, `Diploma`, `Certificate`, `Transcript`, `Achievement` — the 1EdTech controlled vocabulary) |
| Issuance date | `issuanceDate` | Form `issueDate`, normalized to a full ISO 8601 datetime |
| Evidence | `evidence[0]` | `urn:sha256:<hex>`: the SHA-256 of the uploaded source document (transcript/diploma scan). The document itself is private; the digest lets anyone holding it prove it is the one issued. |
| Result | `credentialSubject.result` | GPA, when provided |
| Legacy internal fields | `credentialData` | Kept so existing dashboards/search continue to work — not a VC/OBv3 standard property, but a properly namespaced JSON-LD extension (see `@context`) |

## 5. Canonicalization & the on-chain hash

`issue_credential` on the Soroban contract stores a SHA-256 hash (plus the
holder, issuer and an optional expiry) — no document and no pointer to one. The hash must be reproducible by anyone who
has the document, so it's computed over a **canonical** form, not raw
`JSON.stringify` (key order and incidental fields would otherwise change the
hash for byte-identical *meaning*).

`buildCanonicalCredentialPayloadV2` (`src/lib/credentialHash.ts`) extracts an
explicit allowlist of fields — `@context`, `id`, `type`, `name`,
`description`, `image`, `issuer`, `issuanceDate`, `credentialSubject`,
`evidence`, `credentialData` — normalizes them, and `canonicalJson` recursively
sorts object keys (arrays keep their order). The result is SHA-256'd.

**`credentialStatus` and `onChainAnchor` are never part of that allowlist.**
They can't be: `onChainAnchor.tokenId`/`transactionHash` are only known
*after* the chain transaction succeeds, but the hash has to be computed
*before* it (it's an argument to `issue_credential`). Any real Data Integrity
proof works the same way — canonicalize and sign/hash first, attach the
proof afterward.

This is why there is **no `proof` block** in the hashed core: this system's
proof of issuance is the Stellar transaction + on-chain hash, not an embedded
Ed25519/JWS signature. Don't fabricate one — an earlier version of the export
labeled a transaction hash as an `Ed25519Signature2020` `proofValue`, which is
actively wrong (any verifier that understands that cryptosuite would attempt
real signature verification and fail). If your use case needs a resolvable
DID + embedded Data Integrity Proof, that's a larger, separate feature
(institution DID/key custody) — track it as a follow-up rather than
approximating it.

## 6. Verification recipe (for third parties)

A token ID alone answers **status only**. To check what a credential says,
you need its JSON document, which the holder shares: either the share link
(`/credentials/<share-token>`, which also offers **Download Verifiable
Credential (.json)**) or a file they send you.

1. **Read the on-chain record.** Call the `AcrediaCredential` contract's
   `get_credential(token_id)` via Soroban RPC. It returns the
   `credential_hash` (32 bytes), `student`, `issuer`, `issued_at` and
   `expires_at`. `credential_status(token_id)` returns `Valid`, `Revoked`,
   `Expired` or `NotFound`. The convenience endpoint `GET /api/verify/{token}`
   on this app reads the same contract functions for you, but it compares no
   hash: it has no document to compare.
2. **Recompute the hash.** Run the shared document through the same
   canonicalization as §5 (`buildCanonicalCredentialPayloadV2` +
   `canonicalJson`, SHA-256), **excluding** `credentialStatus` and
   `onChainAnchor` if your copy has them attached (the downloaded export
   does; they are never part of the hash).
3. **Compare.** The recomputed hash must equal the on-chain
   `credential_hash`, and the document's `credentialData.studentWallet` must
   equal the on-chain `student`. If either differs, or the status is not
   `Valid`, do not trust the credential.
4. **Check the document (if you have it).** Its SHA-256 must equal the hex
   in `evidence[0].id` (`urn:sha256:<hex>`). Because the evidence id is part
   of the hashed document, this ties the file to the on-chain record.
5. **Check issuer standing (optional but recommended).** `is_authorized_issuer(issuer)`
   tells you whether the issuing institution is *currently* authorized — a
   credential issued by a since-deauthorized issuer is still valid/immutable,
   but you may want to flag it.

A minimal Node.js/browser implementation of steps 2–3:

```ts
import { canonicalJson, buildCanonicalCredentialPayloadV2 } from './src/lib/credentialHash';

async function verify(document: unknown, onChainHashHex: string): Promise<boolean> {
  const core = buildCanonicalCredentialPayloadV2(document);
  const serialized = canonicalJson(core as any);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === onChainHashHex.toLowerCase();
}
```

Display only fields the hash covers: the canonicalisation normalises some
values (for example it keeps only the `YYYY-MM-DD` part of `issueDate`) and
ignores keys outside its allowlist, so an edited copy can hash the same while
showing different text. The share page does exactly this server-side
(`GET /api/credentials/share/{token}`, see `src/lib/sharedCredential.ts`) and
lets the viewer's browser check the document's SHA-256.

### Legacy (schema v1) credentials

Credentials issued before this feature shipped used a different (NFT-style)
canonical form (`hash_algorithm: "sha256:canonical-json:v1"`,
`metadata_schema_version: 1`). Downloading one still produces a valid
VC/OBv3 document for interoperability, but
`onChainAnchor.hashCoversThisDocument` will be `false` — the on-chain hash for
those tokens covers the *original* stored metadata shape, not the
reconstructed VC. Schema v1 credentials belonged to the previous contract,
which the 2026-10-30 testnet redeploy retired; the share page accepts only
schema v2.

## 7. Exporting from the app

- **Student console** (`/dashboard/credentials`, "My credentials"): every credential
  card has a **"Download VC (.json)"** button.
- **Public showcase page** (`/credentials/{token}`): a
  **"Download Verifiable Credential (.json)"** button, built only from data
  already public on that page (no GPA/subjects/evidence — see the code
  comments in `standardsExport.ts` for the privacy rationale).

## 8. Non-goals / known limitations

- No DID method — `issuer.id`/`credentialSubject.id` are resolvable
  `https://stellar.expert/...` account URLs, not `did:...` identifiers. There
  is no officially registered DID method for Stellar accounts; inventing one
  (e.g. `did:stellar:...`) would be unresolvable by any real DID resolver,
  which is worse than an honest HTTPS URL.
- No embedded Data Integrity Proof / VC-JWT signature. Authenticity is
  established by the Stellar on-chain hash, not by verifying a signature
  inside the document (see §5).
- `credentialSubject.result` only carries GPA today; per-subject marks live
  in the `credentialData` extension, not the stricter OBv3
  `achievement.resultDescriptions` linkage (out of scope for this pass).
