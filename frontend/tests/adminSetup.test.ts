import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as adminAccess from '../src/lib/adminAccess';
import * as supabaseModule from '../src/lib/supabase';
import { adminSetupRequirements } from '../src/lib/adminAccess';
import { isTrustedAdminEmail } from '../src/lib/serverAuth';

describe('closed provisioning (Issue #239)', () => {
    it('exposes no client path that can create an account', () => {
        expect('signUp' in supabaseModule).toBe(false);
        // The authHelpers/dbHelpers objects were removed (review §3.3); among
        // them was a client-side `createStudent` insert.
        expect('authHelpers' in supabaseModule).toBe(false);
        expect('dbHelpers' in supabaseModule).toBe(false);
    });

    it('no longer clamps a self-asserted signup role, because none is accepted', () => {
        // The normalizer existed only to stop a stranger claiming 'admin' at
        // signup. With signup gone, the role comes from the provisioner.
        expect('normalizePublicSignupRole' in adminAccess).toBe(false);
    });

    it('has removed the public registration route', () => {
        expect(existsSync(join(process.cwd(), 'src', 'app', 'auth', 'register'))).toBe(false);
    });

    it('redirects stale registration links instead of leaving them dead', () => {
        const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

        expect(config).toContain("source: '/auth/register'");
        expect(config).toContain("destination: '/contact'");
        // Temporary: the path must not be cached as permanently moved.
        expect(config).toMatch(/source: '\/auth\/register',[\s\S]*?permanent: false/);
    });

    it('keeps credential verification reachable with no account', () => {
        expect(existsSync(join(process.cwd(), 'src', 'app', 'verify'))).toBe(true);
    });
});

describe('admin setup hardening', () => {

    it('documents the trusted admin setup requirements', () => {
        expect(adminSetupRequirements()).toEqual([
            'ADMIN_EMAIL_ALLOWLIST',
            'SUPABASE_SERVICE_ROLE_KEY',
        ]);
    });

    it('requires admins to be explicitly allowlisted', () => {
        const allowlist = 'admin@example.com, owner@example.com';

        expect(isTrustedAdminEmail('admin@example.com', allowlist)).toBe(true);
        expect(isTrustedAdminEmail('OWNER@example.com', allowlist)).toBe(true);
        expect(isTrustedAdminEmail('attacker@example.com', allowlist)).toBe(false);
    });

    it('fails closed when no admin allowlist is configured', () => {
        expect(isTrustedAdminEmail('admin@example.com', '')).toBe(false);
    });
});
