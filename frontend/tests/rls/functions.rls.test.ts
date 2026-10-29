import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asRole, connect, expectPermissionDenied } from './db';

/**
 * Function EXECUTE privileges
 * (migration 20261029010000_lock_down_function_execute.sql, review §3.9).
 *
 * Supabase grants EXECUTE on every new public function to anon and
 * authenticated, so any SECURITY DEFINER function was callable by anyone
 * through /rest/v1/rpc. These tests pin which functions clients may call,
 * that the RLS policy helpers keep working, and that new functions start
 * locked down.
 */

// Distinct from the ids in students.rls.test.ts; both files share one database.
const UNI_X = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UNI_Y = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STAFF_X = '44444444-4444-4444-8444-444444444444'; // issuer at Uni X
const MEMBER_Y = '55555555-5555-4555-8555-555555555555'; // read-only member at Uni Y
const ISSUER_Y = '66666666-6666-4666-8666-666666666666'; // issuer at Uni Y

/** Called only by the service role (server routes, worker) or pg_cron. */
const INTERNAL_FUNCTIONS = [
    'public.next_job(text, text)',
    'public.process_erasure(uuid)',
    'public.run_retention_purge()',
    'public.purge_old_verification_logs()',
    'public.purge_old_contact_messages()',
    'public.retention_status()',
    'public.request_erasure()',
];

/**
 * The only SECURITY DEFINER functions clients may execute. Each needs a
 * reason; adding one here is a security decision, so review it as one.
 */
const CLIENT_EXECUTABLE_ALLOWLIST: Record<string, string> = {
    'is_admin()': 'called by 23 RLS policies, evaluated as the querying user',
    'user_institution_ids(uuid)': 'called by RLS policies; answers only for the caller',
    'user_issuer_institution_ids(uuid)': 'called by RLS policies; answers only for the caller',
};

let db: Client;

beforeAll(async () => {
    db = await connect();
    await db.query(
        `INSERT INTO auth.users (id, email) VALUES
            ($1, 'staff@uni-x.test'), ($2, 'member@uni-y.test'), ($3, 'issuer@uni-y.test')
         ON CONFLICT (id) DO NOTHING`,
        [STAFF_X, MEMBER_Y, ISSUER_Y],
    );
    await db.query(
        `INSERT INTO public.institutions (id, name, email, status, verified) VALUES
            ($1, 'Uni X', 'x@uni.test', 'verified', true),
            ($2, 'Uni Y', 'y@uni.test', 'verified', true)
         ON CONFLICT (id) DO NOTHING`,
        [UNI_X, UNI_Y],
    );
    await db.query(
        `INSERT INTO public.institution_users (institution_id, auth_user_id, role, status) VALUES
            ($1, $2, 'issuer', 'active'),
            ($3, $4, 'viewer', 'active'),
            ($3, $5, 'issuer', 'active')
         ON CONFLICT (institution_id, auth_user_id) DO NOTHING`,
        [UNI_X, STAFF_X, UNI_Y, MEMBER_Y, ISSUER_Y],
    );
});

afterAll(async () => {
    await db?.end();
});

async function canExecute(role: string, fn: string): Promise<boolean> {
    const { rows } = await db.query<{ ok: boolean }>(
        'SELECT has_function_privilege($1, $2::regprocedure, $3) AS ok',
        [role, fn, 'EXECUTE'],
    );
    return rows[0].ok;
}

describe('internal functions are not callable by clients', () => {
    it.each(
        INTERNAL_FUNCTIONS.flatMap((fn) => [
            ['anon', fn],
            ['authenticated', fn],
        ]),
    )('%s cannot execute %s', async (role, fn) => {
        expect(await canExecute(role, fn)).toBe(false);
    });

    it.each(INTERNAL_FUNCTIONS)('service_role can execute %s', async (fn) => {
        expect(await canExecute('service_role', fn)).toBe(true);
    });

    it('an anonymous caller can no longer pull jobs off the email queue', async () => {
        // The reproduced leak: this returned the job (with a student's email)
        // and left it 'processing' so the real worker skipped it.
        await expectPermissionDenied(
            asRole(
                db,
                'anon',
                null,
                (c) => c.query("SELECT * FROM public.next_job('send_email')"),
                (c) =>
                    c
                        .query(
                            `INSERT INTO public.jobs (name, payload)
                             VALUES ('send_email', '{"to":"alice@student.test"}')`,
                        )
                        .then(() => {}),
            ),
        );
    });

    it.each([
        ['authenticated', "SELECT public.process_erasure('00000000-0000-4000-8000-000000000000')"],
        ['anon', 'SELECT public.run_retention_purge()'],
        ['authenticated', 'SELECT * FROM public.retention_status()'],
        ['authenticated', 'SELECT public.request_erasure()'],
    ] as const)('%s is refused: %s', async (role, sql) => {
        const sub = role === 'anon' ? null : STAFF_X;
        await expectPermissionDenied(asRole(db, role, sub, (c) => c.query(sql)));
    });

    it('the email worker (service role) still claims queued jobs', async () => {
        const job = await asRole(
            db,
            'service_role',
            null,
            async (c) => {
                const { rows } = await c.query("SELECT * FROM public.next_job('send_email', 'w1')");
                return rows[0];
            },
            (c) =>
                c
                    .query(
                        `INSERT INTO public.jobs (name, payload)
                         VALUES ('send_email', '{"to":"alice@student.test"}')`,
                    )
                    .then(() => {}),
        );
        expect(job).toMatchObject({ name: 'send_email', status: 'processing', locked_by: 'w1' });
    });

    it('a direct database session (as pg_cron runs) can still run the retention purge', async () => {
        await db.query('BEGIN');
        try {
            await expect(db.query('SELECT public.run_retention_purge()')).resolves.toBeDefined();
        } finally {
            await db.query('ROLLBACK');
        }
    });
});

describe('RLS policy helpers stay callable', () => {
    it.each(
        Object.keys(CLIENT_EXECUTABLE_ALLOWLIST).flatMap((fn) => [
            ['anon', fn],
            ['authenticated', fn],
        ]),
    )('%s can execute %s', async (role, fn) => {
        expect(await canExecute(role, `public.${fn}`)).toBe(true);
    });

    it('anonymous reads of policy-protected tables still work (the public issuer registry)', async () => {
        // Revoking is_admin() from anon makes this fail with
        // "permission denied for function is_admin".
        await expect(
            asRole(db, 'anon', null, (c) => c.query('SELECT count(*) FROM public.institutions')),
        ).resolves.toBeDefined();
    });
});

describe('membership helpers answer only for the caller', () => {
    const ids = (
        role: 'anon' | 'authenticated' | 'service_role',
        sub: string | null,
        sql: string,
        params: unknown[] = [],
    ) =>
        asRole(db, role, sub, async (c) => {
            const { rows } = await c.query<{ id: string }>(sql, params);
            return rows.map((row) => row.id);
        });

    it('returns the caller’s own institutions, with or without an explicit id', async () => {
        expect(
            await ids('authenticated', STAFF_X, 'SELECT public.user_institution_ids() AS id'),
        ).toEqual([UNI_X]);
        expect(
            await ids('authenticated', STAFF_X, 'SELECT public.user_institution_ids($1) AS id', [
                STAFF_X,
            ]),
        ).toEqual([UNI_X]);
        expect(
            await ids(
                'authenticated',
                STAFF_X,
                'SELECT public.user_issuer_institution_ids() AS id',
            ),
        ).toEqual([UNI_X]);
    });

    // ISSUER_Y really is a member and an issuer at Uni Y, so an empty answer
    // means the lookup was refused, not that there was nothing to find.
    it.each([
        ['an authenticated user', 'authenticated', STAFF_X],
        ['an anonymous caller', 'anon', null],
    ] as const)('returns nothing when %s asks about another user', async (_label, role, sub) => {
        expect(
            await ids(role, sub, 'SELECT public.user_institution_ids($1) AS id', [ISSUER_Y]),
        ).toEqual([]);
        expect(
            await ids(role, sub, 'SELECT public.user_issuer_institution_ids($1) AS id', [ISSUER_Y]),
        ).toEqual([]);
    });

    it('still answers for any user when called by the service role', async () => {
        expect(
            await ids('service_role', null, 'SELECT public.user_institution_ids($1) AS id', [
                ISSUER_Y,
            ]),
        ).toEqual([UNI_Y]);
        expect(
            await ids('service_role', null, 'SELECT public.user_issuer_institution_ids($1) AS id', [
                ISSUER_Y,
            ]),
        ).toEqual([UNI_Y]);
    });

    it('still answers for any user in a direct database session (no JWT)', async () => {
        const { rows } = await db.query<{ id: string }>(
            'SELECT public.user_issuer_institution_ids($1) AS id',
            [ISSUER_Y],
        );
        expect(rows.map((row) => row.id)).toEqual([UNI_Y]);
    });

    it('a read-only member is not an issuer', async () => {
        expect(
            await ids(
                'authenticated',
                MEMBER_Y,
                'SELECT public.user_issuer_institution_ids() AS id',
            ),
        ).toEqual([]);
        expect(
            await ids('authenticated', MEMBER_Y, 'SELECT public.user_institution_ids() AS id'),
        ).toEqual([UNI_Y]);
    });
});

describe('every client-executable SECURITY DEFINER function is on the allowlist', () => {
    it('matches the allowlist exactly', async () => {
        // Trigger functions are excluded: Postgres refuses to call them
        // directly. Extension-owned functions are excluded as not ours.
        const { rows } = await db.query<{ fn: string }>(
            `SELECT p.oid::regprocedure::text AS fn
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public'
               AND p.prosecdef
               AND p.prorettype <> 'trigger'::regtype
               AND NOT EXISTS (
                   SELECT 1 FROM pg_depend d
                   WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
               )
               AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                    OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
             ORDER BY 1`,
        );
        expect(rows.map((row) => row.fn)).toEqual(Object.keys(CLIENT_EXECUTABLE_ALLOWLIST).sort());
    });
});

describe('functions created after this migration', () => {
    it('are not executable by clients by default, but are by the service role', async () => {
        await db.query('BEGIN');
        try {
            await db.query(
                'CREATE FUNCTION public.__rls_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$',
            );
            expect(await canExecute('anon', 'public.__rls_probe()')).toBe(false);
            expect(await canExecute('authenticated', 'public.__rls_probe()')).toBe(false);
            expect(await canExecute('service_role', 'public.__rls_probe()')).toBe(true);
        } finally {
            await db.query('ROLLBACK');
        }
    });

    it('still fire as triggers for a user without EXECUTE on them', async () => {
        const stamped = await asRole(
            db,
            'authenticated',
            STAFF_X,
            async (c) => {
                const { rows } = await c.query<{ stamp: string }>(
                    'INSERT INTO public.__rls_probe_t DEFAULT VALUES RETURNING stamp',
                );
                return rows[0].stamp;
            },
            async (c) => {
                await c.query(
                    'CREATE TABLE public.__rls_probe_t (id serial PRIMARY KEY, stamp text)',
                );
                await c.query(`CREATE FUNCTION public.__rls_probe_stamp() RETURNS trigger
                               LANGUAGE plpgsql AS $$ BEGIN NEW.stamp := 'fired'; RETURN NEW; END $$`);
                await c.query(`CREATE TRIGGER __rls_probe_trg BEFORE INSERT ON public.__rls_probe_t
                               FOR EACH ROW EXECUTE FUNCTION public.__rls_probe_stamp()`);
                const { rows } = await c.query<{ ok: boolean }>(
                    "SELECT has_function_privilege('authenticated', 'public.__rls_probe_stamp()', 'EXECUTE') AS ok",
                );
                // The premise: the firing role really lacks EXECUTE.
                expect(rows[0].ok).toBe(false);
            },
        );
        expect(stamped).toBe('fired');
    });
});
