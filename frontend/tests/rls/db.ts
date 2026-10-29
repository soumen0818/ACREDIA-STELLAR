import { Client } from 'pg';
import { expect, inject } from 'vitest';

/** The Postgres roles a Supabase request can run as. */
export type DbRole = 'anon' | 'authenticated' | 'service_role';

export async function connect(): Promise<Client> {
    const client = new Client({ connectionString: inject('rlsDatabaseUrl') });
    await client.connect();
    return client;
}

/**
 * Runs `fn` exactly as PostgREST would run a request from `role` with a JWT
 * for `sub`: inside a transaction, with `request.jwt.claims` set and the role
 * switched. The transaction is always rolled back, so tests never see each
 * other's writes.
 *
 * `asSuperuser` runs first, before the role switch, for tests that need to
 * change the setup (for example re-granting a privilege) for one case only.
 */
export async function asRole<T>(
    client: Client,
    role: DbRole,
    sub: string | null,
    fn: (client: Client) => Promise<T>,
    asSuperuser?: (client: Client) => Promise<void>,
): Promise<T> {
    await client.query('BEGIN');
    try {
        if (asSuperuser) await asSuperuser(client);
        const claims = sub ? { sub, role } : { role };
        await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
            JSON.stringify(claims),
        ]);
        // `role` is a DbRole literal, never user input.
        await client.query(`SET LOCAL ROLE ${role}`);
        return await fn(client);
    } finally {
        await client.query('ROLLBACK');
    }
}

/** Asserts a statement fails with Postgres "insufficient_privilege". */
export async function expectPermissionDenied(promise: Promise<unknown>): Promise<void> {
    await expect(promise).rejects.toMatchObject({ code: '42501' });
}
