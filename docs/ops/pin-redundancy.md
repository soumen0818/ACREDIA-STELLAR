# IPFS Pin Redundancy & the Pin-Keeper — Retired

> **Status: retired on 2026-10-30.** Acredia no longer stores anything on
> IPFS, so there is nothing to pin. This page is kept so existing links
> resolve.

## What replaced it

Credential documents and credential content were uploaded to public IPFS
without encryption, and the on-chain record pointed to them. Anyone could
enumerate the contract and download every student's documents and grades.
The design was replaced (codebase review §3.11):

- **On-chain:** only the credential's hash, the holder and issuer wallets,
  the issue time and an optional expiry. There is no pointer to the content.
- **Off-chain:** the credential (a W3C VC / Open Badges 3.0 document) is
  stored in Postgres, and its document in the private Supabase Storage
  bucket `credential-documents`. The document's SHA-256 is recorded inside
  the credential, so the on-chain hash covers it.
- **Sharing:** the holder shares `/credentials/<share_token>`. That page
  re-hashes the stored credential, compares it with the on-chain hash, and
  lets the viewer's browser check the document's SHA-256. A bare token ID
  shows status only.

## What was removed

- The pin-keeper worker (`frontend/worker/pinKeeper.ts`, `npm run worker:pin-keeper`)
  and `frontend/src/lib/pinKeeper.ts`.
- The Pinata upload routes (`/api/ipfs/file`, `/api/ipfs/json`) and
  `frontend/src/lib/ipfs.ts` / `ipfsServer.ts`.
- The `PINATA_JWT`, `NEXT_PUBLIC_PINATA_GATEWAY` and `SECONDARY_PINNING_*`
  environment variables. Remove them from deployed environments and revoke
  the Pinata API key.

The `credential_pins` table is kept until a later cleanup migration. Nothing
writes to it any more; its registration trigger was dropped in
`20261030000000_private_credential_documents.sql`.

## Durability now

A credential's content lives only in the `credentials` row, and its document
only in Storage, so their durability is the database's and Storage's: see
the backup and restore procedures (`frontend/scripts/backup-db.sh`,
`restore-db.sh`). Storage objects are not part of a database dump; back up
the `credential-documents` bucket separately.

If the database write fails after a credential is issued on-chain, the
credential's content is lost; the indexer can only restore a status-only row.
This is tracked as a follow-up in the codebase review (§3.11c).
