import { describe, expect, it } from 'vitest';
import { adminSetupRequirements, normalizePublicSignupRole } from '../src/lib/adminAccess';
import { isTrustedAdminEmail } from '../src/lib/serverAuth';

describe('admin setup hardening', () => {
    it('does not allow public signup metadata to create admin users', () => {
        expect(normalizePublicSignupRole('admin')).toBe('student');
        expect(normalizePublicSignupRole('student')).toBe('student');
        expect(normalizePublicSignupRole(undefined)).toBe('student');
    });

    it('still allows institution self-registration metadata', () => {
        expect(normalizePublicSignupRole('institution')).toBe('institution');
    });

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
