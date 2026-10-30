import { defineConfig, devices } from '@playwright/test';

const webServerEnv = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://placeholder.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'placeholder',
    SUPABASE_SERVICE_ROLE_KEY: 'placeholder-service-role-key',
    NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT: 'CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK',
    NEXT_PUBLIC_CREDENTIAL_REGISTRY_CONTRACT: 'CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK',
    NEXT_PUBLIC_CHAIN_ID: 'testnet',
    NEXT_PUBLIC_NETWORK_NAME: 'testnet',
    NEXT_PUBLIC_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    NEXT_PUBLIC_ENABLE_DEBUG_LOGS: 'false',
    ADMIN_EMAIL_ALLOWLIST: 'admin@acredia.test',
    // Enables E2E test mode (fake session, signer and ledger) for this dev
    // server only; it can never be on in a production build (src/lib/e2e.ts).
    NEXT_PUBLIC_E2E: 'true',
};

// Deliberately not 3000: that port is shared with roughly every other web
// project on a developer's machine, and `reuseExistingServer` would happily
// attach to one of them and audit it as if it were Acredia
// (ACREDIA-STELLAR#271). 3199 is unremarkable enough to be free and
// project-specific enough to stay that way; `PLAYWRIGHT_PORT` overrides it
// when even that collides.
const PORT = process.env.PLAYWRIGHT_PORT ?? '3199';
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
    testDir: './tests/playwright',
    // Runs before any spec and refuses to continue unless the base URL is
    // actually serving Acredia. The port default above makes a collision
    // unlikely; this makes an undetected one impossible.
    globalSetup: './tests/playwright/global-setup.ts',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
    },
    webServer: {
        command: `npm run dev -- --port ${PORT}`,
        url: BASE_URL,
        // CI always starts its own server: a reused one there could only come
        // from a leaked process on a shared runner, which is never what we
        // want to audit. Locally, reuse stays on for the fast edit-run loop —
        // the identity guard above is what makes that safe.
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: webServerEnv,
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
