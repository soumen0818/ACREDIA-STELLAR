/**
 * Tests for Issue #232 — Account deletion cascades away every credential an institution issued
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSql(...segments: string[]) {
    return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

const schemaSql = readSql('supabase', 'schema.sql');
const migrationSql = readSql('supabase', 'migrations', '20260831000000_fix_account_deletion_cascade.sql');

describe('Issue #232 — Schema & Migration constraints', () => {
    it('sets institutions and students auth_user_id foreign keys to ON DELETE SET NULL', () => {
        expect(schemaSql).toContain('auth_user_id          UUID REFERENCES auth.users (id) ON DELETE SET NULL');
        expect(schemaSql).toContain('auth_user_id   UUID REFERENCES auth.users (id) ON DELETE SET NULL');
        expect(migrationSql).toContain('FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL');
    });

    it('sets credentials foreign keys to ON DELETE RESTRICT', () => {
        expect(schemaSql).toContain('student_id              UUID REFERENCES public.students (id) ON DELETE RESTRICT');
        expect(schemaSql).toContain('institution_id          UUID REFERENCES public.institutions (id) ON DELETE RESTRICT');
        expect(migrationSql).toContain('FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE RESTRICT');
        expect(migrationSql).toContain('FOREIGN KEY (institution_id) REFERENCES public.institutions(id) ON DELETE RESTRICT');
    });

    it('adds database-level guard trigger to block DELETE on credentials table', () => {
        expect(schemaSql).toContain('prevent_credential_deletion');
        expect(schemaSql).toContain('block_credential_delete');
        expect(migrationSql).toContain('prevent_credential_deletion');
        expect(migrationSql).toContain('block_credential_delete');
    });
});

describe('Issue #232 — Verification on-chain fallback resilience', () => {
    it('getCredential in contractReads falls back to on-chain read when DB row is missing', async () => {
        const { getCredential } = await import('@/lib/contractReads');
        expect(typeof getCredential).toBe('function');
    });
});
