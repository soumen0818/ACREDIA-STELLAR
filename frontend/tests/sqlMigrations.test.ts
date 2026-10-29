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

/**
 * The SQL of every migration after `migration` in schema.sql, with `--`
 * comments removed, so a guard sees only statements a later migration runs.
 */
function sqlAfterMigration(schema: string, migration: string): string {
    const marker = `-- migration: ${migration}`;
    const at = schema.indexOf(marker);
    if (at === -1) throw new Error(`${migration} is missing from schema.sql`);
    const next = schema.indexOf('-- migration: ', at + marker.length);
    return next === -1 ? '' : schema.slice(next).replace(/--.*$/gm, '');
}

// Review §3.2: direct writes to public.students are locked down. The real
// behavior is proven against Postgres in tests/rls/students.rls.test.ts
// (`npm run test:rls`); these checks are the fast, Docker-free guard that a
// later migration does not quietly undo it.
describe('students direct-write lockdown', () => {
    const migration = '20261029000000_lock_down_student_writes.sql';
    const lockdown = readSql('supabase', 'migrations', migration);
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
        expect(schema).toContain(`-- migration: ${migration}`);
    });

    it('is not undone by a later migration in schema.sql', () => {
        const later = sqlAfterMigration(schema, migration);

        // No write policy on students may be (re)created after the lockdown...
        expect(later).not.toMatch(
            /CREATE POLICY\s+"[^"]+"\s+ON public\.students\s+FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i,
        );
        // ...and no write privilege may be granted back to client roles.
        expect(later).not.toMatch(
            /GRANT\s+[^;]*\b(INSERT|UPDATE|DELETE|TRUNCATE|ALL)\b[^;]*\bON\s+(TABLE\s+)?public\.students\b[^;]*\bTO\b[^;]*\b(anon|authenticated|PUBLIC)\b/i,
        );
    });
});

// Review §3.9: internal SECURITY DEFINER functions are service-role only, and
// the RLS policy helpers stay executable. Proven against Postgres in
// tests/rls/functions.rls.test.ts; these are the fast, Docker-free guards.
describe('function EXECUTE lockdown', () => {
    const migration = '20261029010000_lock_down_function_execute.sql';
    const lockdown = readSql('supabase', 'migrations', migration);
    const schema = readSql('supabase', 'schema.sql');
    const internal = [
        'next_job',
        'process_erasure',
        'run_retention_purge',
        'purge_old_verification_logs',
        'purge_old_contact_messages',
        'retention_status',
        'request_erasure',
    ];
    const policyHelpers = ['is_admin', 'user_institution_ids', 'user_issuer_institution_ids'];
    const callsAny = (sql: string, names: string[]) =>
        names.some((fn) => new RegExp(`\\b${fn}\\s*\\(`).test(sql));

    it('revokes internal functions from clients and keeps policy helpers executable', () => {
        const revoke = lockdown.match(
            /REVOKE EXECUTE ON FUNCTION([\s\S]*?)FROM PUBLIC, anon, authenticated;/,
        );
        const keep = lockdown.match(
            /GRANT EXECUTE ON FUNCTION([\s\S]*?)TO anon, authenticated, service_role;/,
        );
        expect(revoke).not.toBeNull();
        expect(keep).not.toBeNull();
        for (const fn of internal) expect(revoke![1]).toContain(`public.${fn}(`);
        for (const fn of policyHelpers) expect(keep![1]).toContain(`public.${fn}(`);
        expect(lockdown).toContain(
            'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;',
        );
        expect(lockdown).toContain(
            'ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;',
        );
    });

    it('is included in the generated schema.sql', () => {
        expect(schema).toContain(`-- migration: ${migration}`);
    });

    it('is not undone by a later migration in schema.sql', () => {
        const statements = sqlAfterMigration(schema, migration).split(';');

        // No internal function may be granted back to a client role...
        const regrants = statements.filter(
            (sql) =>
                /\bGRANT\s+(EXECUTE|ALL)\b/i.test(sql) &&
                /\bTO\b[\s\S]*\b(anon|authenticated|PUBLIC)\b/i.test(sql) &&
                callsAny(sql, internal),
        );
        // ...and no policy helper may be revoked from one.
        const helperRevokes = statements.filter(
            (sql) =>
                /\bREVOKE\s+(EXECUTE|ALL)\b/i.test(sql) &&
                /\bFROM\b[\s\S]*\b(anon|authenticated|PUBLIC)\b/i.test(sql) &&
                callsAny(sql, policyHelpers),
        );
        expect(regrants).toEqual([]);
        expect(helperRevokes).toEqual([]);
    });
});

// Review §3.10: erasure is account-only, and erasure records and membership
// history outlive the account. Proven against Postgres in
// tests/rls/erasure.rls.test.ts; these are the fast, Docker-free guards.
describe('account erasure fix', () => {
    const migration = '20261029020000_fix_account_erasure.sql';
    const fix = readSql('supabase', 'migrations', migration).replace(/--.*$/gm, '');
    const schema = readSql('supabase', 'schema.sql');

    it('keeps erasure records and membership rows when an account is deleted', () => {
        expect(fix).toContain('ALTER TABLE public.erasure_requests DROP CONSTRAINT');
        expect(fix).toMatch(
            /FOREIGN KEY \(auth_user_id\) REFERENCES auth\.users \(id\) ON DELETE SET NULL/,
        );
        expect(fix).toContain('CREATE TRIGGER trg_deactivate_unlinked_membership');
    });

    it('is included in the generated schema.sql', () => {
        expect(schema).toContain(`-- migration: ${migration}`);
    });

    it('is not undone by a later migration in schema.sql', () => {
        const cascades = sqlAfterMigration(schema, migration)
            .split(';')
            .filter(
                (sql) =>
                    /\b(erasure_requests|institution_users)\b/.test(sql) &&
                    /REFERENCES\s+auth\.users\b/i.test(sql) &&
                    /ON\s+DELETE\s+CASCADE/i.test(sql),
            );
        expect(cascades).toEqual([]);
    });
});
