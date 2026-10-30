# Testnet redeploy — Phase 0 (2026-10-30)

**Why:** the owner key for the previous testnet contract
(`CD7WU5XRV4KDGKMLDB2IYSCRMMH5FEM45XI235XEFAO6AS2TS7BPSIZH`) was lost, and the
Phase 0 contract changes (codebase review §3.8, §3.11) change its interface:
constructor-set owner, hash-only storage, optional expiry, typed events. The new
frontend only works with the new contract, so **deploy the contract, the
database migrations and the frontend together**.

Do the steps in order. Nothing here is automated; each step says how to check it.

---

## 0. Before you start

- [ ] Phase 0 changes reviewed and committed on a branch (the working tree is uncommitted).
- [ ] Production Supabase has migration `20261017000000_institution_member_continuity.sql`
      applied (the earlier diagnostic showed it missing). Check:
      `SELECT to_regprocedure('public.change_institution_member(uuid,uuid,text,text)') IS NOT NULL
        OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'institution_users' AND column_name = 'removed_at');`
      returns `true`; otherwise re-run the recovery steps from the earlier session.
- [ ] Stellar CLI installed (`stellar --version`), Rust toolchain at `~/.cargo/bin`.

### Which Phase 0 migrations does production have?

Run this in the Supabase SQL editor. Apply, in filename order, every
migration whose row says `false` (files are in `frontend/supabase/migrations/`),
then run it again until every row says `true`.

```sql
-- Phase 0: which migrations are applied? Every row should say true.
SELECT '20261017000000 institution member continuity' AS migration,
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'institution_users'
                 AND column_name = 'removed_at') AS applied
UNION ALL
SELECT '20261029000000 lock down student writes',
       NOT EXISTS (SELECT 1 FROM pg_policies
                   WHERE schemaname = 'public' AND tablename = 'students'
                     AND policyname = 'Students can update own data')
       AND NOT has_table_privilege('authenticated', 'public.students', 'UPDATE')
UNION ALL
SELECT '20261029010000 lock down function execute',
       NOT has_function_privilege('anon', 'public.next_job(text, text)', 'EXECUTE')
       AND NOT has_function_privilege('authenticated', 'public.next_job(text, text)', 'EXECUTE')
UNION ALL
SELECT '20261029020000 fix account erasure',
       EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname = 'trg_deactivate_unlinked_membership' AND NOT tgisinternal)
UNION ALL
SELECT '20261030000000 private credential documents',
       EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'credentials'
                 AND column_name = 'share_token')
       AND EXISTS (SELECT 1 FROM storage.buckets
                   WHERE id = 'credential-documents' AND public = false);
```

## 1. Create the multisig owner (testnet rehearsal of mainnet custody)

> **Done 2026-10-30.** Owner `GDKEG4EDTV3PPSQ7T7QNPYFHAEYRVYGQ665DYKKNI6ACE3HZCD6COCRO`, 2-of-3 with the
> co-signer `GCY527…TXTU` and `GBYIIK…D244`. See [the deployment record](2026-10-30-testnet.md).

Follow `docs/owner-key-custody.md`. In short:

1. Create three key-holder accounts and one owner account; fund all on testnet
   (`stellar keys generate <name> --network testnet --fund`).
2. Add the three as signers on the owner account with weight 1, set
   thresholds low/med/high = 2, and set the owner's master weight to 0.
3. Record the owner address as `OWNER_ADDR`.

Check: Stellar Expert shows the owner account with 3 signers, thresholds 2/2/2, master weight 0.

## 2. Build and deploy the contract

> **Done 2026-10-30.** Contract `CD3NAUTBD5JXFNJVB7DGJW2ALLLEEYBYC5PQ3IQIL7JSSGBDL2VZOY4U`, deploy ledger
> 5468443, `get_owner` verified. See [the deployment record](2026-10-30-testnet.md).

```bash
cd contracts
export PATH="$HOME/.cargo/bin:$PATH"
cargo build --target wasm32v1-none --release
cargo test        # expect 89 passed

stellar contract deploy \
  --wasm target/wasm32v1-none/release/acredia_stellar.wasm \
  --source <a funded deployer identity> \
  --network testnet \
  -- \
  --owner $OWNER_ADDR
```

Save the printed contract ID as `NEW_CONTRACT_ID`.

**Check immediately** (the constructor does not need the owner's signature, so
verify it was set to the right account):

```bash
stellar contract invoke --id $NEW_CONTRACT_ID --network testnet --source <any> -- get_owner
```

It must print `$OWNER_ADDR`. If not, discard the contract and deploy again.

## 3. Authorize issuers (2-of-3 signatures)

On the machine that holds the `acredia-owner` and `acredia-cosigner` CLI identities:

```bash
C=CD3NAUTBD5JXFNJVB7DGJW2ALLLEEYBYC5PQ3IQIL7JSSGBDL2VZOY4U
stellar contract invoke --network testnet --source acredia-owner --id $C --build-only \
  -- authorize_issuer --issuer <INSTITUTION_WALLET> > unsigned.xdr
stellar tx simulate --network testnet --source-account acredia-owner < unsigned.xdr > prepared.xdr
stellar tx sign --network testnet --sign-with-key acredia-owner    < prepared.xdr > signed-1.xdr
stellar tx sign --network testnet --sign-with-key acredia-cosigner < signed-1.xdr > signed-2.xdr
stellar tx send --network testnet < signed-2.xdr
```

Your own wallet (`GBYIIK…D244`) can replace either signer, for example by signing
`signed-1.xdr` in the Stellar Lab or your wallet app.

For each institution wallet, build `authorize_issuer` with the owner as source,
sign it with two key holders, and submit. Then record it in the app: Admin →
Institutions → the institution → authorize, pasting the transaction hash. The
app checks the transaction for an `issuer_authorized` event for that wallet.

Check: `stellar contract invoke --id $NEW_CONTRACT_ID --network testnet --source <any> -- is_authorized_issuer --issuer <wallet>` prints `true`.

Note: authorizing a wallet that is already authorized changes nothing and emits
no event, so the app will reject that transaction hash.

## 4. Database (production Supabase, SQL editor)

1. **Apply the new migration** `frontend/supabase/migrations/20261030000000_private_credential_documents.sql`.
   Check:
   ```sql
   SELECT id, public FROM storage.buckets WHERE id = 'credential-documents';  -- one row, public = false
   SELECT column_name FROM information_schema.columns
    WHERE table_name = 'credentials' AND column_name IN ('share_token','document_path','document_sha256','expires_at');  -- 4 rows
   ```
2. **Reset testnet credential data.** Rows from the old contract cannot verify
   against the new one. Run in one transaction (the delete guard trigger is
   disabled only inside it):
   ```sql
   BEGIN;
   ALTER TABLE public.credentials DISABLE TRIGGER block_credential_delete;
   DELETE FROM public.credentials;            -- credential_pins rows cascade; verification_logs rows stay, with credential_id set to NULL
   ALTER TABLE public.credentials ENABLE TRIGGER block_credential_delete;
   UPDATE public.institutions SET verified = false, status = 'pending', authorization_tx_hash = NULL
    WHERE wallet_address IS NOT NULL;         -- re-authorize on the new contract (step 3)
   UPDATE public.indexer_state SET last_ledger = <ledger of the deploy transaction>, updated_at = now()
    WHERE id = 'main';                        -- 5468443 for this deployment
   COMMIT;
   ```
   Run this **before** step 3's in-app authorization, or redo step 3's in-app
   part afterwards.

## 5. Frontend configuration

> **Code references done 2026-10-30** (new ID `CD3NAUTBD5JXFNJVB7DGJW2ALLLEEYBYC5PQ3IQIL7JSSGBDL2VZOY4U`):
`README.md` (contract ID, explorer links, env example),
`frontend/.env.local.example`,
`frontend/src/lib/runtimeConfig.ts` (`KNOWN_TESTNET_CONTRACTS`: add the new ID, keep the old ones),
`frontend/tests/runtimeConfig.env.test.ts`,
and [the deployment record](2026-10-30-testnet.md).

You change, in **Vercel → Project → Settings → Environment Variables**:

- [ ] `NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT` = `NEW_CONTRACT_ID`
- [ ] `NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT` = `NEW_CONTRACT_ID`
- [ ] Delete `PINATA_JWT`, `NEXT_PUBLIC_PINATA_GATEWAY` and any `SECONDARY_PINNING_*`
- [ ] Your local `frontend/.env.local`: the same changes

Then redeploy the frontend.

## 6. Retire IPFS

- [ ] In Pinata, delete (unpin) all files the app uploaded, then revoke the API key.
      The old documents were public and unencrypted; unpinning stops Pinata from
      serving them (copies others fetched cannot be recalled).
- [ ] Stop the pin-keeper worker if it runs anywhere (`npm run worker:pin-keeper` no longer exists).
- [ ] Restart the indexer (`scripts/indexer.ts`) with the new contract ID; it now reads the typed events.

## 7. Smoke test (testnet)

1. Institution issues a credential **with a document and an expiry date**.
   Check the row has `document_path`, `document_sha256`, `share_token`, `expires_at`.
2. `/verify?token=<id>` shows **Credential Verified**, the institution and dates, and **no student name or wallet**.
3. Student dashboard → **Public Showcase** opens `/credentials/<share-token>` with the
   details; **View document** says the file matches the fingerprint anchored on Stellar.
4. Copy the document's storage URL without the signature → it must be refused.
5. Revoke the credential → `/verify` shows **Credential Revoked**, the share page too.
6. Notification email link opens the share page (not a 404).
7. Admin overview → Verification outcomes counts the checks.

## 8. Afterwards

- [ ] Record the deployment (contract ID, WASM hash, owner, deploy ledger) — send me the values.
- [ ] Counsel review of the changed legal pages (privacy, terms, DPA) and `docs/legal/data-model.md`.
