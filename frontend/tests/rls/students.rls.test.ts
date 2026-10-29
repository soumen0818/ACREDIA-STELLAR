import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, connect, expectPermissionDenied } from './db';

/**
 * Direct writes to public.students are locked down
 * (migration 20261029000000_lock_down_student_writes.sql, review §3.2).
 *
 * Runs against a real Postgres with supabase/schema.sql applied, as each
 * Supabase role, so these tests prove what the database actually allows
 * rather than what the migration text says.
 */

const UNI_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UNI_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ALICE_USER = '11111111-1111-4111-8111-111111111111'; // student at Uni A
const BOB_USER = '22222222-2222-4222-8222-222222222222'; // Bob's account, not yet linked
const CAROL_USER = '33333333-3333-4333-8333-333333333333'; // student at Uni B
const STAFF_USER = '99999999-9999-4999-8999-999999999999'; // issuer-role member of Uni A
const ADMIN_USER = 'adadadad-adad-4ada-8ada-adadadadadad'; // platform admin

const ALICE = '5a5a5a5a-0000-4000-8000-000000000001';
const BOB = '5b5b5b5b-0000-4000-8000-000000000002'; // on Uni A's roster, not yet claimed
const CAROL = '5c5c5c5c-0000-4000-8000-000000000003';

const ATTACKER_WALLET = 'GATTACKERWALLETXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

let db: Client;

beforeAll(async () => {
    db = await connect();
    await db.query(
        `INSERT INTO auth.users (id, email) VALUES
            ($1, 'alice@student.test'), ($2, 'carol@student.test'),
            ($3, 'staff@uni-a.test'),   ($4, 'admin@acredia.test'),
            ($5, 'bob@student.test')
         ON CONFLICT (id) DO NOTHING`,
        [ALICE_USER, CAROL_USER, STAFF_USER, ADMIN_USER, BOB_USER],
    );
    // The on_auth_user_created trigger has already given every new user a
    // 'student' profile, so promote the admin rather than insert one.
    await db.query(
        `INSERT INTO public.profiles (id, email, role) VALUES ($1, 'admin@acredia.test', 'admin')
         ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
        [ADMIN_USER],
    );
    await db.query(
        `INSERT INTO public.institutions (id, name, email, status, verified) VALUES
            ($1, 'Uni A', 'a@uni.test', 'verified', true),
            ($2, 'Uni B', 'b@uni.test', 'verified', true)
         ON CONFLICT (id) DO NOTHING`,
        [UNI_A, UNI_B],
    );
    await db.query(
        `INSERT INTO public.institution_users (institution_id, auth_user_id, role, status)
         VALUES ($1, $2, 'issuer', 'active')`,
        [UNI_A, STAFF_USER],
    );
    await db.query(
        `INSERT INTO public.students
            (id, auth_user_id, name, email, institution_id, status, provisioning_origin) VALUES
            ($1, $2,   'Alice', 'alice@student.test', $5, 'deactivated', 'institution'),
            ($3, NULL, 'Bob',   'bob@student.test',   $5, 'invited',     'institution'),
            ($4, $6,   'Carol', 'carol@student.test', $7, 'active',      'institution')
         ON CONFLICT (id) DO NOTHING`,
        [ALICE, ALICE_USER, BOB, CAROL, UNI_A, CAROL_USER, UNI_B],
    );
});

afterAll(async () => {
    await db?.end();
});

describe('students: a student cannot write their own row', () => {
    // Each column below was writable before the migration; the first three
    // are the reproduced attacks (self-reactivation, roster hopping, wallet
    // squatting that redirects another student's credentials).
    it.each([
        ['status', 'active'],
        ['institution_id', UNI_B],
        ['wallet_address', ATTACKER_WALLET],
        ['auth_user_id', CAROL_USER],
        ['name', 'Renamed'],
        ['email', 'new@student.test'],
        ['student_ref', 'S-0001'],
    ])('rejects UPDATE of %s', async (column, value) => {
        await expectPermissionDenied(
            asRole(db, 'authenticated', ALICE_USER, (c) =>
                // `column` comes from the fixed list above, never user input.
                c.query(`UPDATE public.students SET ${column} = $1 WHERE id = $2`, [value, ALICE]),
            ),
        );
    });

    it('rejects INSERT of a row for themselves', async () => {
        await expectPermissionDenied(
            asRole(db, 'authenticated', ALICE_USER, (c) =>
                c.query(
                    `INSERT INTO public.students (auth_user_id, name, email, institution_id, status)
                     VALUES ($1, 'Alice 2', 'alice2@student.test', $2, 'active')`,
                    [ALICE_USER, UNI_B],
                ),
            ),
        );
    });

    it('rejects DELETE of their own row', async () => {
        await expectPermissionDenied(
            asRole(db, 'authenticated', ALICE_USER, (c) =>
                c.query('DELETE FROM public.students WHERE id = $1', [ALICE]),
            ),
        );
    });
});

describe('students: institution staff cannot write the table directly', () => {
    it("rejects linking an unclaimed student's row to the staff member's own login", async () => {
        await expectPermissionDenied(
            asRole(db, 'authenticated', STAFF_USER, (c) =>
                c.query('UPDATE public.students SET auth_user_id = $1 WHERE id = $2', [
                    STAFF_USER,
                    BOB,
                ]),
            ),
        );
    });

    it('rejects inserting a student (bypassing API validation and the audit log)', async () => {
        await expectPermissionDenied(
            asRole(db, 'authenticated', STAFF_USER, (c) =>
                c.query(
                    `INSERT INTO public.students (name, email, institution_id, status, provisioning_origin)
                     VALUES ('Ghost', 'ghost@nowhere.test', $1, 'active', 'institution')`,
                    [UNI_A],
                ),
            ),
        );
    });
});

describe('students: admins and anonymous callers cannot write directly', () => {
    it('rejects an admin UPDATE', async () => {
        await expectPermissionDenied(
            asRole(db, 'authenticated', ADMIN_USER, (c) =>
                c.query("UPDATE public.students SET status = 'active' WHERE id = $1", [ALICE]),
            ),
        );
    });

    it.each([
        [
            'INSERT',
            `INSERT INTO public.students (name, email, status) VALUES ('Anon', 'anon@x.test', 'active')`,
        ],
        ['UPDATE', `UPDATE public.students SET status = 'active'`],
        ['DELETE', 'DELETE FROM public.students'],
        ['TRUNCATE', 'TRUNCATE public.students'],
    ])('rejects anon %s', async (_label, sql) => {
        await expectPermissionDenied(asRole(db, 'anon', null, (c) => c.query(sql)));
    });

    it('rejects authenticated TRUNCATE, which would bypass RLS', async () => {
        await expectPermissionDenied(
            asRole(db, 'authenticated', ALICE_USER, (c) => c.query('TRUNCATE public.students')),
        );
    });
});

describe('students: RLS still blocks writes if the privileges are ever re-granted', () => {
    // Defense in depth: the revoke is the first layer, the dropped policies
    // the second. Re-grant UPDATE for this transaction only and check that no
    // policy lets a row through.
    it.each([
        ['the student on their own row', ALICE_USER, ALICE],
        ['issuer staff on their own roster', STAFF_USER, BOB],
        ['an admin', ADMIN_USER, ALICE],
    ])('updates zero rows for %s', async (_label, user, studentId) => {
        const result = await asRole(
            db,
            'authenticated',
            user,
            (c) =>
                c.query("UPDATE public.students SET status = 'active' WHERE id = $1", [studentId]),
            (c) => c.query('GRANT UPDATE ON public.students TO authenticated').then(() => {}),
        );
        expect(result.rowCount).toBe(0);
    });
});

describe('students: reads are unchanged', () => {
    const visibleNames = async (role: 'anon' | 'authenticated', user: string | null) =>
        asRole(db, role, user, async (c) => {
            const { rows } = await c.query<{ name: string }>(
                'SELECT name FROM public.students ORDER BY name',
            );
            return rows.map((row) => row.name);
        });

    it('a student sees only their own row', async () => {
        expect(await visibleNames('authenticated', ALICE_USER)).toEqual(['Alice']);
    });

    it("institution staff see their institution's roster only", async () => {
        expect(await visibleNames('authenticated', STAFF_USER)).toEqual(['Alice', 'Bob']);
    });

    it('an admin sees every student', async () => {
        expect(await visibleNames('authenticated', ADMIN_USER)).toEqual(['Alice', 'Bob', 'Carol']);
    });

    it('an anonymous caller sees nothing', async () => {
        expect(await visibleNames('anon', null)).toEqual([]);
    });
});

describe('students: server-side writes still work', () => {
    // Every API route that writes students uses the service role.
    it('service_role can insert, update and delete', async () => {
        await asRole(db, 'service_role', null, async (c) => {
            const inserted = await c.query(
                `INSERT INTO public.students (name, email, institution_id, status, provisioning_origin)
                 VALUES ('Dana', 'dana@student.test', $1, 'invited', 'institution') RETURNING id`,
                [UNI_A],
            );
            const id = inserted.rows[0].id as string;

            // What /api/student/provision does when Bob signs in.
            const linked = await c.query(
                'UPDATE public.students SET auth_user_id = $1, status = $2 WHERE id = $3',
                [BOB_USER, 'active', BOB],
            );
            expect(linked.rowCount).toBe(1);

            const deleted = await c.query('DELETE FROM public.students WHERE id = $1', [id]);
            expect(deleted.rowCount).toBe(1);
        });
    });

    it('deleting an auth user still clears students.auth_user_id (ON DELETE SET NULL)', async () => {
        await db.query('BEGIN');
        try {
            await db.query('DELETE FROM auth.users WHERE id = $1', [CAROL_USER]);
            const { rows } = await db.query(
                'SELECT auth_user_id FROM public.students WHERE id = $1',
                [CAROL],
            );
            expect(rows[0].auth_user_id).toBeNull();
        } finally {
            await db.query('ROLLBACK');
        }
    });

    // KNOWN BUG, pre-existing (review §3.10): process_erasure() sets
    // students.email and profiles.email to NULL, but both columns are NOT
    // NULL, so erasure fails for every user. This pins today's exact failure.
    //
    // It still proves this migration did not break erasure: the error is a
    // not-null violation (23502) raised by the students UPDATE inside the
    // SECURITY DEFINER function, not a permission error (42501), so the
    // function still reaches and writes the table.
    //
    // When §3.10 is fixed this test fails; change it to assert that the
    // student row is redacted.
    it('process_erasure() reaches the students write (pinned known bug: NOT NULL email)', async () => {
        await expect(
            asRole(db, 'service_role', null, async (c) => {
                const request = await c.query(
                    'INSERT INTO public.erasure_requests (auth_user_id) VALUES ($1) RETURNING id',
                    [ALICE_USER],
                );
                await c.query('SELECT public.process_erasure($1)', [request.rows[0].id]);
            }),
        ).rejects.toMatchObject({
            code: '23502',
            table: 'students',
            column: 'email',
        });
    });
});

describe('students: final policy and privilege state', () => {
    it('only the three read policies remain', async () => {
        const { rows } = await db.query<{ policyname: string; cmd: string }>(
            `SELECT policyname, cmd FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'students'
             ORDER BY policyname`,
        );
        expect(rows).toEqual([
            { policyname: 'Admin can view all students', cmd: 'SELECT' },
            { policyname: 'Institutions can view own students', cmd: 'SELECT' },
            { policyname: 'Students can view own data', cmd: 'SELECT' },
        ]);
    });

    it.each(['anon', 'authenticated'])(
        '%s keeps SELECT but has no write privilege',
        async (role) => {
            const { rows } = await db.query<{ privilege: string; granted: boolean }>(
                `SELECT p AS privilege, has_table_privilege($1, 'public.students', p) AS granted
             FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`,
                [role],
            );
            expect(Object.fromEntries(rows.map((r) => [r.privilege, r.granted]))).toEqual({
                SELECT: true,
                INSERT: false,
                UPDATE: false,
                DELETE: false,
                TRUNCATE: false,
            });
        },
    );

    it('service_role keeps every privilege', async () => {
        const { rows } = await db.query<{ granted: boolean }>(
            `SELECT bool_and(has_table_privilege('service_role', 'public.students', p)) AS granted
             FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) AS p`,
        );
        expect(rows[0].granted).toBe(true);
    });
});
