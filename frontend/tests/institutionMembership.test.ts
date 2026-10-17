import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
    canManageMembers,
    canWrite,
    isMemberOfInstitution,
    resolveInstitutionForUser,
    resolveInstitutionIdForUser,
    resolveInstitutionOwnerId,
} from '../src/lib/institutionMembership';

type Row = Record<string, unknown>;

/**
 * Minimal in-memory stand-in for the PostgREST query builder, supporting the
 * subset the resolver uses. Rows are filtered by the accumulated `eq`/`in`
 * predicates, which is what makes cross-institution isolation testable without
 * a live database.
 */
function makeClient(tables: Record<string, Row[]>): SupabaseClient {
    const from = (table: string) => {
        let rows = [...(tables[table] ?? [])];

        const builder: Record<string, unknown> = {
            select: () => builder,
            order: () => builder,
            limit: (n: number) => {
                rows = rows.slice(0, n);
                return builder;
            },
            eq: (column: string, value: unknown) => {
                rows = rows.filter((row) => row[column] === value);
                return builder;
            },
            in: (column: string, values: unknown[]) => {
                rows = rows.filter((row) => values.includes(row[column]));
                return builder;
            },
            maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
            single: async () => ({ data: rows[0] ?? null, error: null }),
        };

        return builder;
    };

    return { from } as unknown as SupabaseClient;
}

const INST_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const INST_B = 'bbbbbbbb-0000-0000-0000-000000000002';
const USER_A = 'user-a';
const USER_B = 'user-b';

describe('resolveInstitutionForUser', () => {
    it('resolves an active membership to its institution and role', async () => {
        const client = makeClient({
            institution_users: [
                { institution_id: INST_A, auth_user_id: USER_A, role: 'owner', status: 'active' },
            ],
            institutions: [],
        });

        const membership = await resolveInstitutionForUser(client, USER_A);

        expect(membership).toEqual({
            institutionId: INST_A,
            role: 'owner',
            status: 'active',
        });
    });

    it('resolves a second member of the same institution — the point of the change', async () => {
        const client = makeClient({
            institution_users: [
                { institution_id: INST_A, auth_user_id: USER_A, role: 'owner', status: 'active' },
                { institution_id: INST_A, auth_user_id: USER_B, role: 'issuer', status: 'active' },
            ],
            institutions: [],
        });

        const first = await resolveInstitutionForUser(client, USER_A);
        const second = await resolveInstitutionForUser(client, USER_B);

        expect(first?.institutionId).toBe(INST_A);
        expect(second?.institutionId).toBe(INST_A);
        expect(second?.role).toBe('issuer');
    });

    it('denies a member who has not accepted their invite yet', async () => {
        const client = makeClient({
            institution_users: [
                { institution_id: INST_A, auth_user_id: USER_A, role: 'owner', status: 'invited' },
            ],
            institutions: [],
        });

        expect(await resolveInstitutionForUser(client, USER_A)).toBeNull();
    });

    it('denies a deactivated member, so offboarding actually revokes access', async () => {
        const client = makeClient({
            institution_users: [
                {
                    institution_id: INST_A,
                    auth_user_id: USER_A,
                    role: 'owner',
                    status: 'deactivated',
                },
            ],
            institutions: [],
        });

        expect(await resolveInstitutionForUser(client, USER_A)).toBeNull();
    });

    it('falls back to the deprecated column so a pre-backfill institution keeps access', async () => {
        const client = makeClient({
            institution_users: [],
            institutions: [{ id: INST_A, auth_user_id: USER_A }],
        });

        const membership = await resolveInstitutionForUser(client, USER_A);

        expect(membership).toEqual({
            institutionId: INST_A,
            role: 'owner',
            status: 'active',
        });
    });

    it('does not let a removed POC regain access through the legacy column (Issue #307)', async () => {
        // The original POC was removed from the Team page, but the deprecated
        // single-login column still names them. Before the fix, the fallback
        // resolved them straight back to `owner`.
        const client = makeClient({
            institution_users: [
                { institution_id: INST_A, auth_user_id: USER_A, role: 'owner', status: 'deactivated' },
            ],
            institutions: [{ id: INST_A, auth_user_id: USER_A }],
        });

        expect(await resolveInstitutionForUser(client, USER_A)).toBeNull();
        expect(await isMemberOfInstitution(client, USER_A, INST_A)).toBe(false);
    });

    it('does not let a pending invitee act through the legacy column before accepting', async () => {
        const client = makeClient({
            institution_users: [
                { institution_id: INST_A, auth_user_id: USER_A, role: 'owner', status: 'invited' },
            ],
            institutions: [{ id: INST_A, auth_user_id: USER_A }],
        });

        expect(await resolveInstitutionForUser(client, USER_A)).toBeNull();
    });

    it('returns null for a user with no membership and no legacy row', async () => {
        const client = makeClient({ institution_users: [], institutions: [] });

        expect(await resolveInstitutionForUser(client, USER_A)).toBeNull();
        expect(await resolveInstitutionIdForUser(client, USER_A)).toBeNull();
    });
});

describe('cross-institution isolation', () => {
    const client = makeClient({
        institution_users: [
            { institution_id: INST_A, auth_user_id: USER_A, role: 'owner', status: 'active' },
            { institution_id: INST_B, auth_user_id: USER_B, role: 'owner', status: 'active' },
        ],
        institutions: [
            { id: INST_A, auth_user_id: USER_A },
            { id: INST_B, auth_user_id: USER_B },
        ],
    });

    it("never resolves one institution's member onto another institution", async () => {
        expect((await resolveInstitutionForUser(client, USER_A))?.institutionId).toBe(INST_A);
        expect((await resolveInstitutionForUser(client, USER_B))?.institutionId).toBe(INST_B);
    });

    it('rejects a membership check against an institution the user does not belong to', async () => {
        expect(await isMemberOfInstitution(client, USER_A, INST_A)).toBe(true);
        expect(await isMemberOfInstitution(client, USER_A, INST_B)).toBe(false);
        expect(await isMemberOfInstitution(client, USER_B, INST_A)).toBe(false);
    });

    it('does not let a deactivated member of another institution slip through', async () => {
        const withDeactivated = makeClient({
            institution_users: [
                {
                    institution_id: INST_B,
                    auth_user_id: USER_A,
                    role: 'issuer',
                    status: 'deactivated',
                },
            ],
            institutions: [],
        });

        expect(await isMemberOfInstitution(withDeactivated, USER_A, INST_B)).toBe(false);
    });
});

describe('server-side role enforcement', () => {
    it('permits writes only for roles that may issue', () => {
        expect(canWrite('owner')).toBe(true);
        expect(canWrite('issuer')).toBe(true);
        expect(canWrite('viewer')).toBe(false);
        expect(canWrite('member')).toBe(false);
    });

    it('maps the legacy role vocabulary onto the same capabilities', () => {
        expect(canWrite('poc')).toBe(true);
        expect(canWrite('admin')).toBe(true);
    });

    it('restricts member management to owners', () => {
        expect(canManageMembers('owner')).toBe(true);
        expect(canManageMembers('poc')).toBe(true);
        expect(canManageMembers('issuer')).toBe(false);
        expect(canManageMembers('viewer')).toBe(false);
    });
});

describe('resolveInstitutionOwnerId', () => {
    it('prefers the active owner membership', async () => {
        const client = makeClient({
            institution_users: [
                { institution_id: INST_A, auth_user_id: USER_A, role: 'owner', status: 'active' },
            ],
        });

        expect(await resolveInstitutionOwnerId(client, INST_A, 'legacy-user')).toBe(USER_A);
    });

    it('falls back to the deprecated column when no owner membership exists', async () => {
        const client = makeClient({ institution_users: [] });

        expect(await resolveInstitutionOwnerId(client, INST_A, 'legacy-user')).toBe('legacy-user');
    });
});

describe('membership migration', () => {
    const migration = readFileSync(
        join(process.cwd(), 'supabase', 'migrations', '20260808000000_institution_membership.sql'),
        'utf8',
    );

    it('is idempotent and transactional', () => {
        expect(migration).toContain('BEGIN;');
        expect(migration).toContain('COMMIT;');
        expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.institution_users');
        expect(migration).toContain('ADD COLUMN IF NOT EXISTS status');
        expect(migration).toContain('ADD COLUMN IF NOT EXISTS invited_by');
        expect(migration).toContain('ON CONFLICT (institution_id, auth_user_id) DO NOTHING');
    });

    it('constrains role and status to the documented vocabularies', () => {
        expect(migration).toMatch(/CHECK \(status IN \('invited', 'active', 'deactivated'\)\)/);
        expect(migration).toMatch(/CHECK \(role IN \('owner', 'issuer', 'viewer'/);
    });

    it('backfills an owner for every institution that had a single login', () => {
        expect(migration).toContain('INSERT INTO public.institution_users');
        expect(migration).toContain("SELECT id, auth_user_id, 'owner', 'active', true");
        expect(migration).toContain('WHERE auth_user_id IS NOT NULL');
    });

    it('stops an auth-user deletion from cascading away the institution', () => {
        expect(migration).toContain('DROP CONSTRAINT IF EXISTS institutions_auth_user_id_fkey');
        expect(migration).toMatch(
            /FOREIGN KEY \(auth_user_id\) REFERENCES auth\.users \(id\) ON DELETE SET NULL/,
        );
        // The membership row itself is what should disappear with the user.
        expect(migration).toMatch(
            /auth_user_id\s+UUID NOT NULL REFERENCES auth\.users \(id\) ON DELETE CASCADE/,
        );
    });

    it('deprecates rather than drops the single-login column', () => {
        expect(migration).toContain('ALTER COLUMN auth_user_id DROP NOT NULL');
        expect(migration).toContain('DEPRECATED (Issue #238)');
        expect(migration).not.toMatch(/ALTER TABLE public\.institutions\s+DROP COLUMN auth_user_id/);
    });

    it('routes every institution-scoped policy through membership', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.user_institution_ids');
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.user_issuer_institution_ids');

        // No rewritten policy may still compare against the deprecated column.
        const policies = migration.split('CREATE POLICY').slice(1);
        expect(policies.length).toBeGreaterThan(0);
        for (const policy of policies) {
            expect(policy).not.toMatch(/auth\.uid\(\) = auth_user_id/);
            expect(policy).not.toMatch(/WHERE auth_user_id = auth\.uid\(\)/);
        }
    });

    it('drops the self-insert policy that the removed signup flow depended on', () => {
        expect(migration).toContain(
            'DROP POLICY IF EXISTS "Institutions can insert own data" ON public.institutions;',
        );
        expect(migration).not.toContain('CREATE POLICY "Institutions can insert own data"');
    });

    it('keeps is_active and status from disagreeing about access', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.sync_institution_user_status');
        expect(migration).toContain('trg_sync_institution_user_status');
    });
});
