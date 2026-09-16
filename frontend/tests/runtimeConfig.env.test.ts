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

    it('logs a clear error and degrades gracefully when required runtime values are missing', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Importing must NOT throw: a missing public value should never crash the
        // whole app (which would show the global error screen in the browser or
        // fail the production build). It degrades to empty values instead.
        const mod = await import('../src/lib/runtimeConfig');

        expect(mod.runtimeConfig.supabase.url).toBe('');
        expect(mod.runtimeConfig.supabase.anonKey).toBe('');
        expect(mod.runtimeConfig.isProduction).toBe(true);

        // The misconfiguration is still surfaced loudly and actionably.
        expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/NEXT_PUBLIC_SUPABASE_URL/));

        errorSpy.mockRestore();
    });

    it('exposes a typed server runtime config for admin and pinata settings', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');

        const { serverRuntimeConfig } = await import('../src/lib/runtimeConfig');

        expect(serverRuntimeConfig.admin.emailAllowlist).toEqual([]);
        expect(serverRuntimeConfig.debug.enableLogs).toBe(false);
    });

    it('enforces single-switch network profiles for testnet/mainnet defaults', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
        vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'mainnet');
        vi.stubEnv('NEXT_PUBLIC_HORIZON_URL', 'https://horizon-testnet.stellar.org');

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mod = await import('../src/lib/runtimeConfig');

        // Falls back instead of crashing app boot, but surfaces the profile violation.
        expect(mod.runtimeConfig.stellar.kind).toBe('testnet');
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringMatching(/cannot override the mainnet profile/),
        );

        errorSpy.mockRestore();
    });

    it('rejects server-only secret names in NEXT_PUBLIC variables', async () => {
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
        vi.stubEnv('NEXT_PUBLIC_PINATA_JWT', 'eyJ.fake.jwt');

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const mod = await import('../src/lib/runtimeConfig');

        // App boot degrades safely while logging the exact misconfiguration.
        expect(mod.runtimeConfig.supabase.url).toBe('https://example.supabase.co');
        expect(errorSpy).toHaveBeenCalledWith(
            expect.stringMatching(/Server-only secrets must never be exposed via NEXT_PUBLIC_\*/),
        );

        errorSpy.mockRestore();
    });
    // ── Mainnet safety ────────────────────────────────────────────────────────
    it('refuses to boot on mainnet with the known testnet contract', async () => {
        // Degrading past this would let the app issue and verify real
        // credentials against a testnet contract while appearing healthy —
        // the worst failure mode for a product whose value is trust.
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'mainnet');
        // A complete, otherwise-valid mainnet config, so the failure can only
        // come from the testnet-contract guard and not from a missing value.
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'sb_publishable_example');
        vi.stubEnv(
            'NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT',
            'CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK',
        );
        vi.stubEnv(
            'NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT',
            'CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK',
        );

        await expect(import('../src/lib/runtimeConfig')).rejects.toThrow(
            /Cannot use the known testnet contract/i,
        );
    });

    it('still degrades gracefully for merely-missing configuration', async () => {
        // The mainnet guard must not turn every config problem into a hard
        // crash — a missing Supabase URL should still render a navigable app
        // rather than a white screen.
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');

        const mod = await import('../src/lib/runtimeConfig');
        expect(mod.runtimeConfig.supabase.url).toBe('');
    });
});

describe('network endpoint defaults', () => {
    // A wrong default here is invisible until cutover day, when every contract
    // read fails at once. `soroban-mainnet.stellar.org` shipped as the mainnet
    // default and does not resolve — it was never a real host.
    it('uses reachable, correctly-named Soroban RPC hosts', async () => {
        const { NETWORK_ENDPOINTS } = await import('../src/lib/runtimeConfig');

        expect(NETWORK_ENDPOINTS.mainnet.sorobanRpcUrl).toBe('https://mainnet.sorobanrpc.com');
        expect(NETWORK_ENDPOINTS.testnet.sorobanRpcUrl).toBe(
            'https://soroban-testnet.stellar.org',
        );

        // The host that never existed must not come back.
        for (const profile of Object.values(NETWORK_ENDPOINTS)) {
            expect(profile.sorobanRpcUrl).not.toContain('soroban-mainnet.stellar.org');
        }
    });

    it('keeps mainnet on the public network passphrase and explorer path', async () => {
        const { NETWORK_ENDPOINTS } = await import('../src/lib/runtimeConfig');
        expect(NETWORK_ENDPOINTS.mainnet.networkPassphrase).toBe(
            'Public Global Stellar Network ; September 2015',
        );
        // stellar.expert uses "public", not "mainnet", in its explorer paths.
        expect(NETWORK_ENDPOINTS.mainnet.networkName).toBe('public');
        expect(NETWORK_ENDPOINTS.mainnet.explorerBaseUrl).toContain('/explorer/public');
    });
});
