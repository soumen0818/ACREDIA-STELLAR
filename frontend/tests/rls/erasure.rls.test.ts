import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, connect } from './db';

/**
 * Account erasure (migration 20261029020000_fix_account_erasure.sql, review
 * §3.10).
 *
 * Erasure is account-only: the login, the profile (email, name, notification
 * preferences) and the roster's link to the account. The roster record, its
 * credentials and the institution are retained, so a deleted account never
 * makes a genuine credential look forged.
 */

// Distinct from the ids in the other tests/rls files; they share one database.
const UNI_E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const STUDENT_USER = '81818181-8181-4181-8181-818181818181';
const POC_USER = '82828282-8282-4282-8282-828282828282';
const PLAIN_USER = '83838383-8383-4383-8383-838383838383';
const STUDENT_ROW = '84848484-8484-4484-8484-848484848484';
const STAFF_ACTIVE = '85858585-8585-4585-8585-858585858585'; // issuer, still active
const STAFF_INVITED = '86868686-8686-4686-8686-868686868686'; // invitation pending
const STAFF_REMOVED = '87878787-8787-4787-8787-878787878787'; // removed on the Team page
const REMOVED_AT = '2026-09-01T00:00:00.000Z';

const CREDENTIAL_METADATA = {
    credentialData: { studentName: 'Erin Student', degree: 'BSc Physics' },
};

let db: Client;

beforeAll(async () => {
    db = await connect();
    await db.query(
        `INSERT INTO auth.users (id, email) VALUES
            ($1, 'erin@student.test'), ($2, 'poc@uni-e.test'), ($3, 'plain@user.test'),
            ($4, 'active@uni-e.test'), ($5, 'invited@uni-e.test'), ($6, 'removed@uni-e.test')
         ON CONFLICT (id) DO NOTHING`,
        [STUDENT_USER, POC_USER, PLAIN_USER, STAFF_ACTIVE, STAFF_INVITED, STAFF_REMOVED],
    );
    await db.query(
        `INSERT INTO public.institutions (id, name, email, status, verified, auth_user_id)
         VALUES ($1, 'Uni E', 'poc@uni-e.test', 'verified', true, $2)
         ON CONFLICT (id) DO NOTHING`,
        [UNI_E, POC_USER],
    );
    await db.query(
        `INSERT INTO public.institution_users (institution_id, auth_user_id, role, status)
         VALUES ($1, $2, 'owner', 'active'), ($1, $3, 'issuer', 'active'), ($1, $4, 'issuer', 'invited')
         ON CONFLICT (institution_id, auth_user_id) DO NOTHING`,
        [UNI_E, POC_USER, STAFF_ACTIVE, STAFF_INVITED],
    );
    await db.query(
        `INSERT INTO public.institution_users
            (institution_id, auth_user_id, role, status, removed_at, removed_by)
         VALUES ($1, $2, 'issuer', 'deactivated', $3, $4)
         ON CONFLICT (institution_id, auth_user_id) DO NOTHING`,
        [UNI_E, STAFF_REMOVED, REMOVED_AT, POC_USER],
    );
    await db.query(
        `INSERT INTO public.students
            (id, auth_user_id, name, email, institution_id, status, provisioning_origin)
         VALUES ($1, $2, 'Erin Student', 'erin@student.test', $3, 'active', 'institution')
         ON CONFLICT (id) DO NOTHING`,
        [STUDENT_ROW, STUDENT_USER, UNI_E],
    );
    await db.query(
        `INSERT INTO public.credentials
            (student_id, institution_id, token_id, ipfs_hash, blockchain_hash, metadata)
         VALUES ($1, $2, 'erasure-1', 'bafyerasure', 'txerasure', $3)
         ON CONFLICT (token_id) DO NOTHING`,
        [STUDENT_ROW, UNI_E, JSON.stringify(CREDENTIAL_METADATA)],
    );
});

afterAll(async () => {
    await db?.end();
});

/** Creates an erasure request for `userId` and processes it, as the API route does. */
async function erase(c: Client, userId: string): Promise<string> {
    const { rows } = await c.query(
        "INSERT INTO public.erasure_requests (auth_user_id, status) VALUES ($1, 'processing') RETURNING id",
        [userId],
    );
    await c.query('SELECT public.process_erasure($1)', [rows[0].id]);
    return rows[0].id as string;
}

describe('process_erasure(): account-level data is removed', () => {
    it('succeeds for a student and deletes their profile', async () => {
        const result = await asRole(db, 'service_role', null, async (c) => {
            const requestId = await erase(c, STUDENT_USER);
            const profile = await c.query('SELECT 1 FROM public.profiles WHERE id = $1', [
                STUDENT_USER,
            ]);
            const request = await c.query(
                'SELECT status, completed_at FROM public.erasure_requests WHERE id = $1',
                [requestId],
            );
            return { profiles: profile.rowCount, request: request.rows[0] };
        });
        expect(result.profiles).toBe(0);
        expect(result.request.status).toBe('completed');
        expect(result.request.completed_at).not.toBeNull();
    });

    it('succeeds for a user who has nothing but a profile', async () => {
        const profiles = await asRole(db, 'service_role', null, async (c) => {
            await erase(c, PLAIN_USER);
            return (await c.query('SELECT 1 FROM public.profiles WHERE id = $1', [PLAIN_USER]))
                .rowCount;
        });
        expect(profiles).toBe(0);
    });

    it('cannot process the same request twice', async () => {
        await expect(
            asRole(db, 'service_role', null, async (c) => {
                const requestId = await erase(c, PLAIN_USER);
                await c.query('SELECT public.process_erasure($1)', [requestId]);
            }),
        ).rejects.toThrow(/not found or already processed/);
    });
});

describe('process_erasure(): institution records are retained', () => {
    it("keeps the student's roster record, only unlinking it from the account", async () => {
        const row = await asRole(db, 'service_role', null, async (c) => {
            await erase(c, STUDENT_USER);
            const { rows } = await c.query(
                'SELECT name, email, status, auth_user_id FROM public.students WHERE id = $1',
                [STUDENT_ROW],
            );
            return rows[0];
        });
        expect(row).toEqual({
            name: 'Erin Student',
            email: 'erin@student.test',
            status: 'active',
            auth_user_id: null,
        });
    });

    it('leaves credential metadata untouched, so verification still matches the chain', async () => {
        const metadata = await asRole(db, 'service_role', null, async (c) => {
            await erase(c, STUDENT_USER);
            const { rows } = await c.query(
                "SELECT metadata FROM public.credentials WHERE token_id = 'erasure-1'",
            );
            return rows[0].metadata;
        });
        expect(metadata).toEqual(CREDENTIAL_METADATA);
    });

    it("never renames or empties an institution when its contact's account is erased", async () => {
        const institution = await asRole(db, 'service_role', null, async (c) => {
            await erase(c, POC_USER);
            const { rows } = await c.query(
                'SELECT name, email FROM public.institutions WHERE id = $1',
                [UNI_E],
            );
            return rows[0];
        });
        expect(institution).toEqual({ name: 'Uni E', email: 'poc@uni-e.test' });
    });
});

describe('erasure records outlive the account', () => {
    it('keeps the completed request, with its account id, after the auth account is deleted', async () => {
        // Run as the database owner: deleting from auth.users is what the
        // API route's auth.admin.deleteUser() does in Supabase.
        await db.query('BEGIN');
        try {
            const requestId = await erase(db, STUDENT_USER);
            await db.query('DELETE FROM auth.users WHERE id = $1', [STUDENT_USER]);

            const { rows } = await db.query(
                'SELECT auth_user_id, status FROM public.erasure_requests WHERE id = $1',
                [requestId],
            );
            expect(rows).toEqual([{ auth_user_id: STUDENT_USER, status: 'completed' }]);

            const roster = await db.query(
                'SELECT auth_user_id FROM public.students WHERE id = $1',
                [STUDENT_ROW],
            );
            expect(roster.rows[0].auth_user_id).toBeNull();
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('has no foreign key from erasure_requests to auth.users', async () => {
        const { rows } = await db.query(
            `SELECT conname FROM pg_constraint
             WHERE contype = 'f'
               AND conrelid = 'public.erasure_requests'::regclass
               AND confrelid = 'auth.users'::regclass`,
        );
        expect(rows).toEqual([]);
    });
});

describe('membership history outlives the account', () => {
    /** Deletes the auth account (as auth.admin.deleteUser does) and returns the membership row. */
    async function membershipAfterDeleting(userId: string) {
        await db.query('BEGIN');
        try {
            const { rows: before } = await db.query(
                'SELECT id FROM public.institution_users WHERE auth_user_id = $1',
                [userId],
            );
            await db.query('DELETE FROM auth.users WHERE id = $1', [userId]);
            const { rows } = await db.query(
                `SELECT auth_user_id, role, status, is_active, removed_at, removed_by
                 FROM public.institution_users WHERE id = $1`,
                [before[0].id],
            );
            const { rows: active } = await db.query(
                "SELECT count(*)::int AS n FROM public.institution_users WHERE institution_id = $1 AND status = 'active'",
                [UNI_E],
            );
            return { row: rows[0], activeMembers: active[0].n as number };
        } finally {
            await db.query('ROLLBACK');
        }
    }

    it('keeps an active member’s row, unlinked and deactivated, so they no longer count', async () => {
        const { row, activeMembers } = await membershipAfterDeleting(STAFF_ACTIVE);
        expect(row).toMatchObject({
            auth_user_id: null,
            role: 'issuer',
            status: 'deactivated',
            is_active: false,
        });
        expect(row.removed_at).not.toBeNull();
        // Only the POC owner remains active.
        expect(activeMembers).toBe(1);
    });

    it('deactivates a pending invitation whose account is deleted', async () => {
        const { row } = await membershipAfterDeleting(STAFF_INVITED);
        expect(row).toMatchObject({ auth_user_id: null, status: 'deactivated', is_active: false });
    });

    it('keeps when and by whom an already-removed member was removed', async () => {
        const { row } = await membershipAfterDeleting(STAFF_REMOVED);
        expect(row).toMatchObject({
            auth_user_id: null,
            status: 'deactivated',
            removed_by: POC_USER,
        });
        expect(new Date(row.removed_at).toISOString()).toBe(REMOVED_AT);
    });

    it('defines every foreign key to auth.users as intended', async () => {
        const { rows } = await db.query<{
            table_name: string;
            column_name: string;
            on_delete: string;
        }>(
            `SELECT c.conrelid::regclass::text AS table_name, a.attname AS column_name,
                    CASE c.confdeltype WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                         WHEN 'r' THEN 'RESTRICT' ELSE 'NO ACTION' END AS on_delete
             FROM pg_constraint c
             JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
             WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass
               AND c.conrelid IN ('public.institution_users'::regclass, 'public.erasure_requests'::regclass)
             ORDER BY 1, 2`,
        );
        expect(rows).toEqual([
            { table_name: 'institution_users', column_name: 'auth_user_id', on_delete: 'SET NULL' },
            { table_name: 'institution_users', column_name: 'invited_by', on_delete: 'SET NULL' },
            { table_name: 'institution_users', column_name: 'removed_by', on_delete: 'SET NULL' },
        ]);
    });
});

describe('the support runbook SQL (docs/support-procedures.md §4)', () => {
    // The SQL editor runs as the database owner, so these run as `db`.
    it('erases an account the way §4.2 step 3 describes', async () => {
        await db.query('BEGIN');
        try {
            const { rows } = await db.query(
                "INSERT INTO public.erasure_requests (auth_user_id, status) VALUES ($1, 'processing') RETURNING id",
                [STAFF_ACTIVE],
            );
            await db.query('SELECT public.process_erasure($1)', [rows[0].id]);
            const profile = await db.query('SELECT 1 FROM public.profiles WHERE id = $1', [
                STAFF_ACTIVE,
            ]);
            expect(profile.rowCount).toBe(0);
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('retries a failed request the way §4.1 describes', async () => {
        await db.query('BEGIN');
        try {
            const { rows } = await db.query(
                "INSERT INTO public.erasure_requests (auth_user_id, status, failure_reason) VALUES ($1, 'failed', 'boom') RETURNING id",
                [STUDENT_USER],
            );
            const id = rows[0].id;
            await db.query(
                "UPDATE public.erasure_requests SET status = 'processing', failure_reason = NULL WHERE id = $1",
                [id],
            );
            await db.query('SELECT public.process_erasure($1)', [id]);
            const { rows: after } = await db.query(
                'SELECT status FROM public.erasure_requests WHERE id = $1',
                [id],
            );
            expect(after[0].status).toBe('completed');
        } finally {
            await db.query('ROLLBACK');
        }
    });
});
