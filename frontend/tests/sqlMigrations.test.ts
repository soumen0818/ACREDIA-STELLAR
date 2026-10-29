import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSql(...segments: string[]) {
    return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

// The schema is consolidated into a single idempotent Supabase migration
// file; there is no separate database_schema.sql anymore (it was folded in).
const setup = readSql('supabase', 'migrations', '20260730000000_initial_schema.sql');

describe('database migration policy model', () => {
    it('keeps the consolidated schema free of permissive public policies', () => {
        expect(setup).not.toMatch(/CREATE POLICY\s+"Anyone can insert institutions"/i);
        expect(setup).not.toMatch(/CREATE POLICY\s+"Anyone can insert students"/i);
        expect(setup).not.toMatch(/CREATE POLICY\s+"Anyone can view verification logs"/i);
        expect(setup).not.toMatch(/CREATE POLICY\s+"Anyone can insert verification logs"/i);
        expect(setup).not.toMatch(/CREATE POLICY\s+"Public can count institutions"/i);
        expect(setup).not.toMatch(/CREATE POLICY\s+"Public can count students"/i);
        expect(setup).not.toMatch(
            /CREATE POLICY\s+"Public can view credentials for verification"/i,
        );

        const truthyChecks = setup.match(/WITH\s+CHECK\s*\(\s*true\s*\)/gi) ?? [];
        expect(truthyChecks.length).toBe(0);
        expect(setup).toContain('DROP POLICY IF EXISTS "Anyone can insert verification logs"');
        expect(setup).toContain('CREATE POLICY "Admin can insert verification logs"');
    });

    it('keeps signup mirror triggers in the canonical schema path', () => {
        expect(setup).toContain('CREATE OR REPLACE FUNCTION public.handle_new_user()');
        expect(setup).toContain('CREATE OR REPLACE FUNCTION public.handle_new_student_user()');
        expect(setup).toContain('CREATE OR REPLACE FUNCTION public.handle_new_institution_user()');
        expect(setup).toContain('CREATE TRIGGER on_auth_user_created_student');
        expect(setup).toContain('CREATE TRIGGER on_auth_user_created_institution');
        expect(setup).toContain('SECURITY DEFINER SET search_path = public');
    });

    it('defines the production RLS policy set', () => {
        expect(setup).toContain(
            'DROP POLICY IF EXISTS "Public can view credentials for verification"',
        );
        expect(setup).toContain('DROP POLICY IF EXISTS "Public can count institutions"');
        expect(setup).toContain('CREATE POLICY "Institutions can insert own data"');
        expect(setup).toContain('CREATE POLICY "Admin can view all credentials"');
        expect(setup).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
    });

    it('is safe to re-run (idempotent guards present)', () => {
        expect(setup).toContain('CREATE TABLE IF NOT EXISTS public.profiles');
        expect(setup).toContain('CREATE TABLE IF NOT EXISTS public.credentials');
        expect(setup).toMatch(/DROP TRIGGER IF EXISTS on_auth_user_created\b/);
        expect(setup).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    });

    it('stores credential hash schema metadata', () => {
        expect(setup).toContain('metadata_schema_version INTEGER NOT NULL DEFAULT 1');
        expect(setup).toContain(
            "hash_algorithm          TEXT NOT NULL DEFAULT 'sha256:canonical-json:v1'",
        );
    });

    it('indexes privacy-safe verification audit aggregates', () => {
        expect(setup).toContain('idx_verification_logs_created_at');
        expect(setup).toContain('idx_verification_logs_result_type');
        expect(setup).toContain("verification_result->>'result_type'");
    });

    it('stamps legacy credential rows before enforcing hash metadata requirements', () => {
        expect(setup).toContain("WHEN hash_algorithm = 'sha256:canonical-json:v1' THEN 1");
        expect(setup).toContain('ELSE 0');
        expect(setup).toContain("WHEN metadata_schema_version = 0 THEN 'sha256:json-stringify'");
        expect(setup).toContain('ALTER COLUMN metadata_schema_version SET NOT NULL');
        expect(setup).toContain('ALTER COLUMN hash_algorithm SET NOT NULL');
    });

    it('defines POC handover, admin audit logs, and institution multi-user tables', () => {
        const handoverMigration = readSql(
            'supabase',
            'migrations',
            '20260806000000_poc_handover_and_audit.sql',
        );

        expect(handoverMigration).toContain('CREATE TABLE IF NOT EXISTS public.admin_audit_logs');
        expect(handoverMigration).toContain('CREATE TABLE IF NOT EXISTS public.institution_users');
        expect(handoverMigration).toContain('ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true');
        expect(handoverMigration).toContain('CREATE POLICY "Admin can view admin audit logs"');
        expect(handoverMigration).toContain('CREATE POLICY "Institution members can view colleagues"');
    });
});

// Review §3.2: direct writes to public.students are locked down. The real
// behavior is proven against Postgres in tests/rls/students.rls.test.ts
// (`npm run test:rls`); these checks are the fast, Docker-free guard that a
// later migration does not quietly undo it.
describe('students direct-write lockdown', () => {
    const lockdown = readSql(
        'supabase',
        'migrations',
        '20261029000000_lock_down_student_writes.sql',
    );
    const schema = readSql('supabase', 'schema.sql');
    const writePolicies = [
        'Students can update own data',
        'Institutions can insert own students',
        'Institutions can update own students',
        'Admin can update students',
    ];

    it('drops every direct-write policy and revokes write privileges', () => {
        for (const policy of writePolicies) {
            expect(lockdown).toContain(`DROP POLICY IF EXISTS "${policy}" ON public.students;`);
        }
        expect(lockdown).toContain(
            'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.students FROM anon, authenticated;',
        );
    });

    it('is included in the generated schema.sql', () => {
        expect(schema).toContain('-- migration: 20261029000000_lock_down_student_writes.sql');
    });

    it('is not undone by a later migration in schema.sql', () => {
        const lockdownAt = schema.indexOf(
            '-- migration: 20261029000000_lock_down_student_writes.sql',
        );
        const after = schema.slice(lockdownAt);

        // No write policy on students may be (re)created after the lockdown...
        expect(after).not.toMatch(
            /CREATE POLICY\s+"[^"]+"\s+ON public\.students\s+FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i,
        );
        // ...and no write privilege may be granted back to client roles.
        expect(after).not.toMatch(
            /GRANT\s+[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*\bON\s+(TABLE\s+)?public\.students\b[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i,
        );
    });
});
