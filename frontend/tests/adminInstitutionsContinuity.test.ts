import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, fakeId, type Tables } from './helpers/fakeSupabase';

/**
 * The admin risk list of single-member institutions (Issue #307), and the
 * migration behind the self-service guard.
 */

const { mockRequireAdminRequest, mockGetServiceRoleClient } = vi.hoisted(() => ({
    mockRequireAdminRequest: vi.fn(),
    mockGetServiceRoleClient: vi.fn(),
}));

vi.mock('../src/lib/serverAuth', () => ({
    requireAdminRequest: mockRequireAdminRequest,
    getServiceRoleClient: mockGetServiceRoleClient,
}));
vi.mock('../src/lib/rateLimit', () => ({ enforceRateLimit: vi.fn(async () => null) }));

import { GET, POST } from '../src/app/api/admin/institutions/route';

const SOLO = fakeId();
const COVERED = fakeId();
const ORPHANED = fakeId();
let tables: Tables;

beforeEach(() => {
    vi.clearAllMocks();
    mockRequireAdminRequest.mockResolvedValue({ ok: true, userId: 'admin-1' });
    tables = {
        institutions: [
            { id: SOLO, name: 'Solo College', email: 'solo@x.test', status: 'verified' },
            { id: COVERED, name: 'Covered University', email: 'covered@x.test', status: 'verified' },
            { id: ORPHANED, name: 'Orphaned Institute', email: 'orphan@x.test', status: 'suspended' },
        ],
        credentials: [],
        institution_users: [
            { institution_id: SOLO, role: 'owner', status: 'active' },
            { institution_id: SOLO, role: 'issuer', status: 'invited', invite_expires_at: '2999-01-01T00:00:00Z' },
            { institution_id: COVERED, role: 'owner', status: 'active' },
            { institution_id: COVERED, role: 'poc', status: 'active' },
        ],
        admin_audit_logs: [
            {
                action: 'deactivate_account',
                target_institution_id: ORPHANED,
                created_at: '2026-10-10T00:00:00Z',
                details: { institution_left_without_members: true, institution_left_without_issuers: true },
            },
        ],
    };
    mockGetServiceRoleClient.mockReturnValue(createFakeSupabase(tables).client);
});

describe('GET /api/admin/institutions — continuity', () => {
    it('reports each institution’s continuity, including the erasure that orphaned one', async () => {
        const response = await GET(new NextRequest('https://acredia.test/api/admin/institutions'));
        const body = await response.json();
        const byName = Object.fromEntries(
            body.institutions.map((i: { name: string }) => [i.name, i]),
        );

        expect(response.status).toBe(200);
        expect(byName['Solo College'].continuity).toMatchObject({
            level: 'single_issuer',
            activeIssuers: 1,
            pendingInvites: 1,
        });
        expect(byName['Covered University'].continuity).toMatchObject({ level: 'healthy', activeOwners: 2 });
        expect(byName['Orphaned Institute']).toMatchObject({
            continuity: { level: 'no_issuers', activeMembers: 0 },
            memberLossAt: '2026-10-10T00:00:00Z',
        });
        expect(byName['Solo College'].memberLossAt).toBeNull();
    });
});

describe('POST /api/admin/institutions — provisioning record', () => {
    it('records the provisioning origin and gives the POC membership its own invite window', async () => {
        const db = createFakeSupabase(tables);
        (db.client.auth.admin as unknown as Record<string, unknown>).createUser = vi.fn(async () => ({
            data: { user: { id: 'poc-user' } },
            error: null,
        }));
        (db.client.auth.admin as unknown as Record<string, unknown>).generateLink = vi.fn(async () => ({
            data: { properties: { action_link: 'https://link' } },
            error: null,
        }));
        mockGetServiceRoleClient.mockReturnValue(db.client);

        const response = await POST(
            new NextRequest('https://acredia.test/api/admin/institutions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'New University',
                    pocName: 'Pat Contact',
                    pocEmail: 'pat@new.test',
                    walletAddress: 'GD4CT6FQBUTCG7A3X3QAYXZSZLLJYPMKJNIBD7UCTLKV7MX4XK66OIHU',
                }),
            }),
        );

        expect(response.status).toBe(201);
        expect(tables.institutions.at(-1)).toMatchObject({ provisioning_origin: 'admin' });
        expect(tables.institution_users.at(-1)).toMatchObject({
            auth_user_id: 'poc-user',
            role: 'owner',
            status: 'invited',
            invite_expires_at: expect.any(String),
        });
    });
});

describe('migration 20261017000000_institution_member_continuity', () => {
    const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
    const read = (name: string) => readFileSync(path.join(migrationsDir, name), 'utf8');
    const migration = read('20261017000000_institution_member_continuity.sql');

    it('guards member changes in one locked, service-role-only function', () => {
        expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.change_institution_member/);
        expect(migration).toMatch(/FOR UPDATE;/);
        expect(migration).toMatch(/RAISE EXCEPTION 'last_owner'/);
        expect(migration).toMatch(/RAISE EXCEPTION 'last_issuer'/);
        expect(migration).toMatch(
            /REVOKE ALL ON FUNCTION public\.change_institution_member\([^)]*\)\s+FROM PUBLIC, anon, authenticated;/,
        );
    });

    it('defines the final audit vocabulary validated, after earlier ones that tolerate re-runs', () => {
        // The latest definition must validate every row …
        const finalDefinition = migration.slice(migration.indexOf('ADD CONSTRAINT admin_audit_logs_action_check'));
        expect(finalDefinition.slice(0, finalDefinition.indexOf(';'))).not.toMatch(/NOT VALID/);
        for (const action of ['invite_member', 'resend_member_invite', 'remove_member', 'change_member_role']) {
            expect(finalDefinition).toContain(`'${action}'`);
        }
        // … while older, narrower ones must not abort a schema.sql re-run.
        for (const older of [
            '20260807000000_institution_provisioning.sql',
            '20260809000000_triage_self_signups.sql',
            '20260810000000_student_provisioning_and_claim.sql',
        ]) {
            expect(read(older), older).toMatch(/\)\s*NOT VALID;/);
        }
    });

    it('never reclassifies an admin-provisioned institution as a self-signup on a re-run', () => {
        expect(read('20260809000000_triage_self_signups.sql')).toMatch(
            /created_by_admin_id IS NOT NULL OR invited_at IS NOT NULL/,
        );
        expect(migration).toMatch(/SET provisioning_origin = 'admin'\s+WHERE provisioning_origin IS NULL/);
    });
});
