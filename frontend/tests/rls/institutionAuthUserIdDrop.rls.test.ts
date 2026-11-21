import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, connect } from './db';

/**
 * Dropping `institutions.auth_user_id` (Issue #308), against the real schema.
 *
 * PL/pgSQL bodies are not dependency-tracked, so `DROP COLUMN` succeeds even
 * when a function still writes the column, and the function only fails when
 * called. That is exactly what happened to `change_institution_member()`, the
 * RPC behind "remove member" and "change role". These tests call it.
 */

// Distinct from the ids in the other RLS test files; they share one database.
const UNI = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const OWNER_A = '77777777-7777-4777-8777-777777777701';
const OWNER_B = '77777777-7777-4777-8777-777777777702';
const ISSUER = '77777777-7777-4777-8777-777777777703';

let db: Client;
let memberIds: Record<string, string>;

beforeAll(async () => {
    db = await connect();
    await db.query(
        `INSERT INTO auth.users (id, email) VALUES
            ($1, 'owner-a@uni-308.test'), ($2, 'owner-b@uni-308.test'), ($3, 'issuer@uni-308.test')
         ON CONFLICT (id) DO NOTHING`,
        [OWNER_A, OWNER_B, ISSUER],
    );
    await db.query(
        `INSERT INTO public.institutions (id, name, email, status, verified)
         VALUES ($1, 'Uni 308', 'contact@uni-308.test', 'verified', true)
         ON CONFLICT (id) DO NOTHING`,
        [UNI],
    );
    const { rows } = await db.query<{ id: string; auth_user_id: string }>(
        `INSERT INTO public.institution_users (institution_id, auth_user_id, role, status) VALUES
            ($1, $2, 'owner', 'active'),
            ($1, $3, 'owner', 'active'),
            ($1, $4, 'issuer', 'active')
         ON CONFLICT (institution_id, auth_user_id) DO UPDATE SET status = EXCLUDED.status
         RETURNING id, auth_user_id`,
        [UNI, OWNER_A, OWNER_B, ISSUER],
    );
    memberIds = Object.fromEntries(rows.map((row) => [row.auth_user_id, row.id]));
});

afterAll(async () => {
    await db?.end();
});

/** Calls the RPC as the server routes do (service role), in a rolled-back transaction. */
function changeMember(memberId: string, action: 'remove' | 'set_role', role: string | null = null) {
    return asRole(db, 'service_role', null, async (c) => {
        const { rows } = await c.query<{ status: string; role: string }>(
            'SELECT status, role FROM public.change_institution_member($1, $2, $3, $4, $5)',
            [UNI, memberId, action, role, OWNER_A],
        );
        return rows[0];
    });
}

describe('institutions.auth_user_id is gone (#308)', () => {
    it('is not a column of institutions any more', async () => {
        const { rowCount } = await db.query(
            `SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'`,
        );
        expect(rowCount).toBe(0);
    });

    it('is not written by any function body, which DROP COLUMN cannot check', async () => {
        const { rows } = await db.query<{ fn: string }>(
            `SELECT p.oid::regprocedure::text AS fn
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.prosrc ~* 'public\\.institutions\\s*(\\(|SET\\b|WHERE\\b)[^;]*\\mauth_user_id\\M'`,
        );
        expect(rows.map((row) => row.fn)).toEqual([]);
    });
});

describe('change_institution_member() after the drop', () => {
    it('removes an owner while another owner remains', async () => {
        await expect(changeMember(memberIds[OWNER_B], 'remove')).resolves.toMatchObject({ status: 'deactivated' });
    });

    it('demotes an owner to issuer while another owner remains', async () => {
        await expect(changeMember(memberIds[OWNER_B], 'set_role', 'issuer')).resolves.toMatchObject({
            role: 'issuer',
            status: 'active',
        });
    });

    it('removes an issuer', async () => {
        await expect(changeMember(memberIds[ISSUER], 'remove')).resolves.toMatchObject({ status: 'deactivated' });
    });

    it('still refuses to remove the last owner', async () => {
        // Remove B first, then try A, in one transaction.
        const attempt = asRole(db, 'service_role', null, async (c) => {
            await c.query('SELECT public.change_institution_member($1, $2, $3, NULL, NULL)', [
                UNI,
                memberIds[OWNER_B],
                'remove',
            ]);
            await c.query('SELECT public.change_institution_member($1, $2, $3, NULL, NULL)', [
                UNI,
                memberIds[OWNER_A],
                'remove',
            ]);
        });
        await expect(attempt).rejects.toMatchObject({ message: 'last_owner' });
    });
});

describe('the drop migration protects access on its own', () => {
    const migration = readFileSync(
        join(process.cwd(), 'supabase', 'migrations', '20261121000000_drop_institutions_auth_user_id.sql'),
        'utf8',
    )
        // Run inside this test's transaction so it can be rolled back.
        .replace(/^\s*BEGIN;\s*$/m, '')
        .replace(/^\s*COMMIT;\s*$/m, '');

    const LEGACY_UNI = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
    const REMOVED_UNI = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
    const LEGACY_LOGIN = '77777777-7777-4777-8777-777777777704'; // only ever in the old column
    const REMOVED_LOGIN = '77777777-7777-4777-8777-777777777705'; // old column, but was removed

    it('backfills exactly the logins the old fallback admitted, then drops the column', async () => {
        await db.query('BEGIN');
        try {
            // Recreate the pre-#308 state.
            await db.query('ALTER TABLE public.institutions ADD COLUMN auth_user_id UUID');
            await db.query(
                `INSERT INTO auth.users (id, email) VALUES ($1, 'legacy@uni.test'), ($2, 'removed@uni.test')`,
                [LEGACY_LOGIN, REMOVED_LOGIN],
            );
            await db.query(
                `INSERT INTO public.institutions (id, name, email, status, verified, auth_user_id) VALUES
                    ($1, 'Legacy Uni', 'legacy-uni@uni.test', 'verified', true, $2),
                    ($3, 'Removed Uni', 'removed-uni@uni.test', 'verified', true, $4)`,
                [LEGACY_UNI, LEGACY_LOGIN, REMOVED_UNI, REMOVED_LOGIN],
            );
            await db.query(
                `INSERT INTO public.institution_users (institution_id, auth_user_id, role, status)
                 VALUES ($1, $2, 'owner', 'deactivated')`,
                [REMOVED_UNI, REMOVED_LOGIN],
            );

            await db.query(migration);

            const { rows } = await db.query<{ auth_user_id: string; institution_id: string; role: string; status: string }>(
                `SELECT auth_user_id, institution_id, role, status FROM public.institution_users
                 WHERE auth_user_id = ANY ($1::uuid[]) ORDER BY auth_user_id`,
                [[LEGACY_LOGIN, REMOVED_LOGIN]],
            );
            expect(rows).toEqual([
                // Kept access: the old fallback admitted them, now through membership.
                { auth_user_id: LEGACY_LOGIN, institution_id: LEGACY_UNI, role: 'owner', status: 'active' },
                // Not given access back: the old fallback already refused a removed member.
                { auth_user_id: REMOVED_LOGIN, institution_id: REMOVED_UNI, role: 'owner', status: 'deactivated' },
            ]);

            const { rowCount } = await db.query(
                `SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'institutions' AND column_name = 'auth_user_id'`,
            );
            expect(rowCount).toBe(0);
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('is a no-op when re-applied after the column is gone', async () => {
        await db.query('BEGIN');
        try {
            await expect(db.query(migration)).resolves.toBeDefined();
        } finally {
            await db.query('ROLLBACK');
        }
    });
});
