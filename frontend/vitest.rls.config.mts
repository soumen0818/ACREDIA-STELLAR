import { defineConfig } from 'vitest/config';

// Database RLS tests (`npm run test:rls`). They need a real Postgres, so they
// run separately from `npm test`; see tests/rls/globalSetup.ts.
export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        environment: 'node',
        include: ['tests/rls/**/*.test.ts'],
        globalSetup: ['tests/rls/globalSetup.ts'],
        globals: true,
        // One shared database: run files one at a time.
        fileParallelism: false,
        // Starting a container and applying the schema can take a while.
        hookTimeout: 120_000,
        testTimeout: 30_000,
    },
});
