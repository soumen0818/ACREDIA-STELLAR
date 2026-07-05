import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sqlDir = join(process.cwd(), 'sql');

function readSql(name: string) {
    return readFileSync(join(sqlDir, name), 'utf8');
}

// The schema is now consolidated into a single idempotent setup file.
const setup = readSql('FULL_SETUP.sql');
const baseSchema = readSql('database_schema.sql');

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

    it('stores credential hash schema metadata in base and full schemas', () => {
        for (const sql of [baseSchema, setup]) {
            expect(sql).toContain('metadata_schema_version INTEGER NOT NULL DEFAULT 1');
            expect(sql).toContain(
                "hash_algorithm          TEXT NOT NULL DEFAULT 'sha256:canonical-json:v1'",
            );
        }
    });

    it('indexes privacy-safe verification audit aggregates', () => {
        for (const sql of [baseSchema, setup]) {
            expect(sql).toContain('idx_verification_logs_created_at');
            expect(sql).toContain('idx_verification_logs_result_type');
            expect(sql).toContain("verification_result->>'result_type'");
        }
    });

    it('stamps legacy credential rows before enforcing hash metadata requirements', () => {
        expect(setup).toContain("WHEN hash_algorithm = 'sha256:canonical-json:v1' THEN 1");
        expect(setup).toContain('ELSE 0');
        expect(setup).toContain("WHEN metadata_schema_version = 0 THEN 'sha256:json-stringify'");
        expect(setup).toContain('ALTER COLUMN metadata_schema_version SET NOT NULL');
        expect(setup).toContain('ALTER COLUMN hash_algorithm SET NOT NULL');
    });
});
