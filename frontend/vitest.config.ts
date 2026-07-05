import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
        globals: true,
        coverage: {
            reporter: ['text', 'json-summary', 'lcov'],
            reportOnFailure: true,
            thresholds: {
                lines: 55,
                functions: 55,
                branches: 55,
                statements: 55,
            },
        },
    },
});
