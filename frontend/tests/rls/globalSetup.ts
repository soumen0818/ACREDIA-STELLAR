import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';

/**
 * Global setup for the database RLS tests (`npm run test:rls`).
 *
 * Gives the tests a real Postgres with the production schema applied:
 *   - CI sets RLS_DATABASE_URL to a postgres service container;
 *   - locally, a throwaway container is started here and removed afterwards.
 *
 * Kept in sync with the CI service image in .github/workflows/ci.yml.
 */
export const POSTGRES_IMAGE =
    'postgres:16@sha256:9e2cf6287f25c3151f4c9421ccce2b17f3e60061c111a29165e0d2cdd9ff0a97';

declare module 'vitest' {
    export interface ProvidedContext {
        rlsDatabaseUrl: string;
    }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function readRepoFile(...segments: string[]): string {
    return readFileSync(join(process.cwd(), ...segments), 'utf8');
}

/**
 * This setup creates roles and applies the whole schema, so it must never be
 * pointed at a real Supabase project by mistake.
 */
function assertLocalDatabase(url: string): void {
    const { hostname } = new URL(url);
    if (!LOCAL_HOSTS.has(hostname)) {
        throw new Error(
            `RLS_DATABASE_URL must point at a local, disposable database (got host "${hostname}").`,
        );
    }
}

function startContainer(): { url: string; containerId: string } {
    let containerId: string;
    try {
        containerId = execFileSync(
            'docker',
            [
                'run',
                '--detach',
                '--rm',
                '--env',
                'POSTGRES_PASSWORD=rls',
                '--publish',
                '127.0.0.1::5432',
                POSTGRES_IMAGE,
            ],
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
    } catch (error) {
        throw new Error(
            'test:rls needs Docker (to start a throwaway Postgres) or RLS_DATABASE_URL ' +
                'pointing at a local Postgres 16. Starting the Docker container failed.',
            { cause: error },
        );
    }

    const hostPort = execFileSync('docker', ['port', containerId, '5432/tcp'], {
        encoding: 'utf8',
    })
        .trim()
        .split('\n')[0];

    return { url: `postgres://postgres:rls@${hostPort}/postgres`, containerId };
}

async function waitForContainer(containerId: string): Promise<void> {
    // The image's entrypoint first starts a temporary socket-only server to
    // run its init scripts, then restarts. Checking over TCP waits for the
    // real server rather than that temporary one.
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            execFileSync(
                'docker',
                ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-q'],
                {
                    stdio: 'ignore',
                },
            );
            return;
        } catch {
            await sleep(1000);
        }
    }
    throw new Error('Postgres container did not become ready within 60 seconds.');
}

export default async function setup(project: TestProject) {
    let url = process.env.RLS_DATABASE_URL;
    let containerId: string | null = null;

    if (url) {
        assertLocalDatabase(url);
    } else {
        ({ url, containerId } = startContainer());
        await waitForContainer(containerId);
    }

    const client = new Client({ connectionString: url });
    try {
        await client.connect();
        await client.query(readRepoFile('tests', 'rls', 'fixtures', 'supabase-stub.sql'));

        // schema.sql promises it is safe to re-run; applying it twice proves
        // that for every migration in it, including new ones.
        const schema = readRepoFile('supabase', 'schema.sql');
        await client.query(schema);
        await client.query(schema);
    } catch (error) {
        if (containerId) execFileSync('docker', ['stop', containerId], { stdio: 'ignore' });
        throw error;
    } finally {
        await client.end();
    }

    project.provide('rlsDatabaseUrl', url);

    return () => {
        if (containerId) execFileSync('docker', ['stop', containerId], { stdio: 'ignore' });
    };
}
