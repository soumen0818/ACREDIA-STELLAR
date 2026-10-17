import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A small in-memory stand-in for the Supabase client, covering the PostgREST
 * builder surface the institution-membership code uses: filtered selects
 * (with `count`/`head`), inserts, updates, upserts, `rpc`, and the two auth
 * calls that send invitation emails.
 *
 * Rows live in plain arrays per table, so a test can seed state, run the code
 * under test, and assert on what the "database" now holds — closer to the real
 * contract than per-call mocks, without a live database.
 */
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Filter = (row: Row) => boolean;

let idCounter = 0;
export const fakeId = () => `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`;

export interface FakeSupabaseOptions {
    rpc?: (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown };
    inviteUserByEmail?: (email: string) => { data: { user: { id: string } | null }; error: { message: string } | null };
    resetPasswordForEmail?: (email: string) => { data: object | null; error: { message: string } | null };
}

export function createFakeSupabase(tables: Tables, options: FakeSupabaseOptions = {}) {
    const inviteUserByEmail = vi.fn(async (email: string) =>
        options.inviteUserByEmail
            ? options.inviteUserByEmail(email)
            : { data: { user: { id: fakeId() } }, error: null },
    );
    const resetPasswordForEmail = vi.fn(async (email: string) =>
        options.resetPasswordForEmail ? options.resetPasswordForEmail(email) : { data: {}, error: null },
    );
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) =>
        options.rpc ? options.rpc(name, args) : { data: null, error: { message: `no rpc ${name}` } },
    );

    const from = (table: string) => {
        tables[table] ??= [];
        const filters: Filter[] = [];
        let mode: 'select' | 'update' | 'insert' | 'upsert' = 'select';
        let payload: Row | Row[] | null = null;
        let countOnly = false;
        let limit: number | null = null;

        const matching = () => tables[table].filter((row) => filters.every((f) => f(row)));

        const execute = () => {
            if (mode === 'insert' || mode === 'upsert') {
                const rows = (Array.isArray(payload) ? payload : [payload]).map((row) => ({
                    id: fakeId(),
                    created_at: new Date().toISOString(),
                    ...row,
                }));
                tables[table].push(...rows);
                return { data: rows, error: null, count: null };
            }
            if (mode === 'update') {
                const rows = matching();
                rows.forEach((row) => Object.assign(row, payload));
                return { data: rows, error: null, count: null };
            }
            let rows = matching();
            if (limit !== null) rows = rows.slice(0, limit);
            return { data: countOnly ? null : rows, error: null, count: rows.length };
        };

        const builder: Record<string, unknown> = {
            select: (_columns?: string, opts?: { count?: string; head?: boolean }) => {
                countOnly = Boolean(opts?.head);
                return builder;
            },
            eq: (column: string, value: unknown) => {
                filters.push((row) => row[column] === value);
                return builder;
            },
            neq: (column: string, value: unknown) => {
                filters.push((row) => row[column] !== value);
                return builder;
            },
            in: (column: string, values: unknown[]) => {
                filters.push((row) => values.includes(row[column]));
                return builder;
            },
            is: (column: string, value: unknown) => {
                filters.push((row) => (row[column] ?? null) === value);
                return builder;
            },
            contains: () => builder,
            order: () => builder,
            limit: (n: number) => {
                limit = n;
                return builder;
            },
            insert: (rows: Row | Row[]) => {
                mode = 'insert';
                payload = rows;
                return builder;
            },
            upsert: (rows: Row | Row[]) => {
                mode = 'upsert';
                payload = rows;
                return builder;
            },
            update: (values: Row) => {
                mode = 'update';
                payload = values;
                return builder;
            },
            maybeSingle: async () => {
                const { data } = execute();
                return { data: (data as Row[] | null)?.[0] ?? null, error: null };
            },
            single: async () => {
                const { data } = execute();
                const row = (data as Row[] | null)?.[0] ?? null;
                return { data: row, error: row ? null : { message: 'no rows' } };
            },
            then: (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) => {
                try {
                    resolve(execute());
                } catch (error) {
                    reject?.(error);
                }
            },
        };

        return builder;
    };

    const client = {
        from: vi.fn(from),
        rpc,
        auth: {
            admin: { inviteUserByEmail },
            resetPasswordForEmail,
        },
    };

    return {
        client: client as unknown as SupabaseClient,
        tables,
        inviteUserByEmail,
        resetPasswordForEmail,
        rpc,
    };
}
