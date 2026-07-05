import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime config environment validation', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        delete process.env.NEXT_PHASE;
        vi.unstubAllEnvs();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.resetModules();
        vi.unstubAllEnvs();
    });

    it('throws a clear error when required runtime values are missing', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');

        await expect(import('../src/lib/runtimeConfig')).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    });

    it('exposes a typed server runtime config for admin and pinata settings', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');

        const { serverRuntimeConfig } = await import('../src/lib/runtimeConfig');

        expect(serverRuntimeConfig.admin.emailAllowlist).toEqual([]);
        expect(serverRuntimeConfig.debug.enableLogs).toBe(false);
    });
});
