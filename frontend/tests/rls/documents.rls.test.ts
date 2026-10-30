import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, connect } from './db';

/**
 * Private credential documents, share tokens and expiry
 * (migration 20261030000000_private_credential_documents.sql, review §3.11).
 */

const UNI_D = 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0';
const STUDENT_D = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const UNI_E = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
const ISSUER_D = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2'; // issuer-role member of Uni D
const ISSUER_E = 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2'; // issuer-role member of Uni E
const BUCKET = 'credential-documents';

let db: Client;

beforeAll(async () => {
    db = await connect();
    await db.query(
        `INSERT INTO auth.users (id, email) VALUES
            ($1, 'doc-student@student.test'), ($2, 'issuer@uni-d.test'), ($3, 'issuer@uni-e.test')
         ON CONFLICT (id) DO NOTHING`,
        [STUDENT_D, ISSUER_D, ISSUER_E],
    );
    await db.query(
        `INSERT INTO public.institutions (id, name, email, status, verified) VALUES
            ($1, 'Uni Docs', 'docs@uni.test', 'verified', true),
            ($2, 'Uni Docs E', 'docs-e@uni.test', 'verified', true)
         ON CONFLICT (id) DO NOTHING`,
        [UNI_D, UNI_E],
    );
    await db.query(
        `INSERT INTO public.institution_users (institution_id, auth_user_id, role, status) VALUES
            ($1, $2, 'issuer', 'active'), ($3, $4, 'issuer', 'active')
         ON CONFLICT (institution_id, auth_user_id) DO NOTHING`,
        [UNI_D, ISSUER_D, UNI_E, ISSUER_E],
    );
});

afterAll(async () => {
    await db?.end();
});

/** Inserts a credential row as the service role would, without IPFS content. */
async function insertCredential(c: Client, tokenId: string, extra: Record<string, unknown> = {}) {
    const columns = [
        'institution_id',
        'token_id',
        'blockchain_hash',
        'metadata',
        ...Object.keys(extra),
    ];
    const values = [UNI_D, tokenId, `tx-${tokenId}`, '{}', ...Object.values(extra)];
    const placeholders = values.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await c.query(
        `INSERT INTO public.credentials (${columns.join(', ')}) VALUES (${placeholders})
         RETURNING share_token, ipfs_hash`,
        values,
    );
    return rows[0];
}

describe('credentials: share tokens and IPFS-free rows', () => {
    it('gives every new credential its own random share token', async () => {
        await db.query('BEGIN');
        try {
            const a = await insertCredential(db, 'doc-1');
            const b = await insertCredential(db, 'doc-2');
            const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
            expect(a.share_token).toMatch(uuid);
            expect(b.share_token).toMatch(uuid);
            expect(a.share_token).not.toBe(b.share_token);
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('accepts a credential with no IPFS content (the pin trigger is gone)', async () => {
        await db.query('BEGIN');
        try {
            const row = await insertCredential(db, 'doc-3', {
                document_path: `${UNI_D}/abc.pdf`,
                document_sha256: 'a'.repeat(64),
                expires_at: '2030-01-01T00:00:00Z',
            });
            expect(row.ipfs_hash).toBeNull();
            const pins = await db.query(
                "SELECT to_regprocedure('public.register_credential_pins()') AS fn",
            );
            expect(pins.rows[0].fn).toBeNull();
            // The table itself is kept for a later cleanup migration.
            const table = await db.query("SELECT to_regclass('public.credential_pins') AS t");
            expect(table.rows[0].t).toBe('credential_pins');
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('rejects a document digest that is not 64 lowercase hex characters', async () => {
        await db.query('BEGIN');
        try {
            await expect(
                insertCredential(db, 'doc-4', { document_sha256: 'not-a-digest' }),
            ).rejects.toMatchObject({ code: '23514' });
        } finally {
            await db.query('ROLLBACK');
        }
    });
});

/**
 * The indexer and the issuing app can both write a credential's row, in
 * either order (review §3.11c). The indexer only inserts what is missing; the
 * app's upsert completes an index-only row instead of failing on token_id.
 */
describe('credentials: indexer and issuance write in either order', () => {
    /** What the indexer writes (service role): chain facts only, nothing on conflict. */
    const indexerInsert = (c: Client, tokenId: string, institutionId = UNI_D) =>
        c.query(
            `INSERT INTO public.credentials
                (token_id, institution_id, student_wallet_address, issuer_wallet_address,
                 blockchain_hash, metadata, issued_at, revoked)
             VALUES ($1, $2, 'GSTUDENT', 'GISSUER', 'tx-' || $1, '{}', now(), false)
             ON CONFLICT (token_id) DO NOTHING
             RETURNING share_token`,
            [tokenId, institutionId],
        );

    /** What the app's upsert sends through PostgREST. */
    const appUpsert = (c: Client, tokenId: string, institutionId = UNI_D) =>
        c.query(
            `INSERT INTO public.credentials
                (token_id, institution_id, blockchain_hash, metadata, metadata_schema_version,
                 hash_algorithm, document_path, document_sha256)
             VALUES ($1, $2, 'tx-app', '{"name":"issued"}', 2, 'sha256:canonical-json:v2',
                     'path/doc.pdf', $3)
             ON CONFLICT (token_id) DO UPDATE SET
                institution_id = EXCLUDED.institution_id,
                blockchain_hash = EXCLUDED.blockchain_hash,
                metadata = EXCLUDED.metadata,
                metadata_schema_version = EXCLUDED.metadata_schema_version,
                hash_algorithm = EXCLUDED.hash_algorithm,
                document_path = EXCLUDED.document_path,
                document_sha256 = EXCLUDED.document_sha256`,
            [tokenId, institutionId, 'a'.repeat(64)],
        );

    it('lets the issuing app complete a row the indexer wrote first, keeping its share token', async () => {
        await db.query('BEGIN');
        try {
            const indexed = await indexerInsert(db, 'race-2');
            const shareToken = indexed.rows[0].share_token;

            await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
                JSON.stringify({ sub: ISSUER_D, role: 'authenticated' }),
            ]);
            await db.query('SET LOCAL ROLE authenticated');
            await appUpsert(db, 'race-2');
            await db.query('RESET ROLE');

            const { rows } = await db.query(
                'SELECT share_token, metadata, document_sha256 FROM public.credentials WHERE token_id = $1',
                ['race-2'],
            );
            expect(rows).toEqual([
                {
                    share_token: shareToken,
                    metadata: { name: 'issued' },
                    document_sha256: 'a'.repeat(64),
                },
            ]);
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('never lets the indexer overwrite a row the issuing app wrote', async () => {
        await db.query('BEGIN');
        try {
            await appUpsert(db, 'race-3');
            const indexed = await indexerInsert(db, 'race-3');
            expect(indexed.rowCount).toBe(0);

            const { rows } = await db.query(
                'SELECT metadata, blockchain_hash FROM public.credentials WHERE token_id = $1',
                ['race-3'],
            );
            expect(rows).toEqual([{ metadata: { name: 'issued' }, blockchain_hash: 'tx-app' }]);
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('does not let another institution take over an index-only row', async () => {
        await db.query('BEGIN');
        try {
            await indexerInsert(db, 'race-4');
            await db.query("SELECT set_config('request.jwt.claims', $1, true)", [
                JSON.stringify({ sub: ISSUER_E, role: 'authenticated' }),
            ]);
            await db.query('SET LOCAL ROLE authenticated');
            await expect(appUpsert(db, 'race-4', UNI_E)).rejects.toMatchObject({ code: '42501' });
        } finally {
            await db.query('ROLLBACK');
        }
    });
});

describe('the credential-documents bucket is private', () => {
    it('exists and is not public', async () => {
        const { rows } = await db.query('SELECT public FROM storage.buckets WHERE id = $1', [
            BUCKET,
        ]);
        expect(rows).toEqual([{ public: false }]);
    });

    it.each([
        ['anon', null],
        ['authenticated', STUDENT_D],
    ] as const)('%s can neither upload to nor list it', async (role, sub) => {
        await expect(
            asRole(db, role, sub, (c) =>
                c.query("INSERT INTO storage.objects (bucket_id, name) VALUES ($1, 'x.pdf')", [
                    BUCKET,
                ]),
            ),
        ).rejects.toMatchObject({ code: '42501' });

        const visible = await asRole(
            db,
            role,
            sub,
            async (c) =>
                (await c.query('SELECT id FROM storage.objects WHERE bucket_id = $1', [BUCKET]))
                    .rowCount,
            (c) =>
                c
                    .query(
                        "INSERT INTO storage.objects (bucket_id, name) VALUES ($1, 'existing.pdf')",
                        [BUCKET],
                    )
                    .then(() => {}),
        );
        expect(visible).toBe(0);
    });

    it('the service role can store and read documents', async () => {
        const seen = await asRole(db, 'service_role', null, async (c) => {
            await c.query("INSERT INTO storage.objects (bucket_id, name) VALUES ($1, 'ok.pdf')", [
                BUCKET,
            ]);
            return (
                await c.query('SELECT name FROM storage.objects WHERE bucket_id = $1', [BUCKET])
            ).rows;
        });
        expect(seen).toEqual([{ name: 'ok.pdf' }]);
    });
});
