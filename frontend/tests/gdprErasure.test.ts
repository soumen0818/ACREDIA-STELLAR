/**
 * Tests for Issue #160 — Privacy & Compliance (GDPR): Erasure, Policy, ToS
 *
 * These tests follow the same pattern as sqlMigrations.test.ts:
 *   - Validate SQL DDL contains required objects (table, functions, policies)
 *   - The /api/account/erase route itself is tested in accountErasure.test.ts
 *   - Validate that the full setup file now includes the erasure_requests table
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// SQL content tests
// ---------------------------------------------------------------------------

function readSql(...segments: string[]) {
    return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

const gdprErasure = readSql('supabase', 'migrations', '20260801000000_gdpr_erasure.sql');
// The schema is consolidated into a single idempotent Supabase migration
// file; there is no separate database_schema.sql anymore (it was folded in).
const fullSetup = readSql('supabase', 'migrations', '20260730000000_initial_schema.sql');

describe('gdpr_erasure.sql — DDL structure', () => {
    it('creates the erasure_requests table with required columns', () => {
        expect(gdprErasure).toContain('CREATE TABLE IF NOT EXISTS public.erasure_requests');
        expect(gdprErasure).toContain('auth_user_id');
        expect(gdprErasure).toContain('requested_at');
        expect(gdprErasure).toContain('completed_at');
        expect(gdprErasure).toContain("CHECK (status IN ('pending', 'processing', 'completed', 'failed'))");
    });

    it('creates the request_erasure() function with SECURITY DEFINER', () => {
        expect(gdprErasure).toContain('CREATE OR REPLACE FUNCTION public.request_erasure()');
        expect(gdprErasure).toContain('SECURITY DEFINER');
        expect(gdprErasure).toContain('GRANT EXECUTE ON FUNCTION public.request_erasure() TO authenticated');
    });

    it('creates the process_erasure() function and revokes public access', () => {
        expect(gdprErasure).toContain('CREATE OR REPLACE FUNCTION public.process_erasure(p_request_id uuid)');
        expect(gdprErasure).toContain('REVOKE ALL ON FUNCTION public.process_erasure(uuid) FROM PUBLIC');
        // Must NOT grant to authenticated — only callable by service_role
        expect(gdprErasure).not.toContain('GRANT EXECUTE ON FUNCTION public.process_erasure');
    });

    // The original process_erasure() set NOT NULL emails to NULL (so it
    // failed for every user) and redacted credentials and institutions. It is
    // replaced by an account-only version (review §3.10); its behaviour is
    // proven against Postgres in tests/rls/erasure.rls.test.ts.
    it('process_erasure() is replaced by the account-only version', () => {
        // Comments explain the old bug, so check the SQL statements only.
        const fix = readSql(
            'supabase',
            'migrations',
            '20261029020000_fix_account_erasure.sql',
        ).replace(/--.*$/gm, '');
        expect(fix).toContain('CREATE OR REPLACE FUNCTION public.process_erasure(p_request_id uuid)');
        expect(fix).toContain('DELETE FROM public.profiles');
        expect(fix).toContain('SET auth_user_id = NULL');
        expect(fix).not.toMatch(/UPDATE public\.credentials/);
        expect(fix).not.toMatch(/UPDATE public\.institutions/);
        expect(fix).not.toContain("'[deleted]'");
    });

    it('creates the purge_old_verification_logs() function', () => {
        expect(gdprErasure).toContain('CREATE OR REPLACE FUNCTION public.purge_old_verification_logs()');
        expect(gdprErasure).toContain("INTERVAL '90 days'");
        expect(gdprErasure).toContain('REVOKE ALL ON FUNCTION public.purge_old_verification_logs() FROM PUBLIC');
    });

    it('documents retention policy on verification_logs via COMMENT', () => {
        expect(gdprErasure).toContain('COMMENT ON TABLE public.verification_logs');
        expect(gdprErasure).toContain('90 days');
        expect(gdprErasure).toContain('purge_old_verification_logs');
    });

    it('documents on-chain immutability rationale on credentials table', () => {
        expect(gdprErasure).toContain('COMMENT ON TABLE public.credentials');
        expect(gdprErasure).toContain('Art. 17(3)(b) GDPR');
    });

    it('adds RLS policies for erasure_requests', () => {
        expect(gdprErasure).toContain('CREATE POLICY "Users can view own erasure requests"');
        expect(gdprErasure).toContain('CREATE POLICY "Admin can view all erasure requests"');
        // No open insert/update policy — users cannot directly modify request status
        expect(gdprErasure).not.toMatch(/CREATE POLICY "Users can insert/i);
        expect(gdprErasure).not.toMatch(/CREATE POLICY "Users can update/i);
    });

    it('is idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS guards present)', () => {
        expect(gdprErasure).toContain('CREATE TABLE IF NOT EXISTS public.erasure_requests');
        expect(gdprErasure).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
        expect(gdprErasure).toContain('DROP POLICY IF EXISTS "Users can view own erasure requests"');
    });
});

describe('consolidated migration — includes erasure_requests', () => {
    it('includes the erasure_requests table definition', () => {
        expect(fullSetup).toContain('CREATE TABLE IF NOT EXISTS public.erasure_requests');
    });

    it('includes erasure_requests RLS policies', () => {
        expect(fullSetup).toContain('CREATE POLICY "Users can view own erasure requests"');
        expect(fullSetup).toContain('CREATE POLICY "Admin can view all erasure requests"');
    });

    it('drops legacy erasure policies before recreating (idempotent)', () => {
        expect(fullSetup).toContain('DROP POLICY IF EXISTS "Users can view own erasure requests"');
        expect(fullSetup).toContain('DROP POLICY IF EXISTS "Admin can view all erasure requests"');
    });

    it('has updated 90-day retention COMMENT on verification_logs', () => {
        expect(fullSetup).toContain('90 days');
        expect(fullSetup).toContain('purge_old_verification_logs');
    });
});
