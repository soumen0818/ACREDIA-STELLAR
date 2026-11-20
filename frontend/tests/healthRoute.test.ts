/**
 * Issue #312 — public service health.
 * GET /api/health and the report behind it (src/lib/serviceHealth.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const SUPABASE_URL = 'https://secret-project-ref.supabase.co';
const RPC_URL = 'https://private-rpc.internal.example';
const REDIS_URL = 'https://hidden-redis.upstash.io';

vi.mock('@/lib/runtimeConfig', () => ({
    runtimeConfig: {
        supabase: { url: 'https://secret-project-ref.supabase.co', anonKey: 'anon-key' },
        isProduction: false,
        stellar: { sorobanRpcUrl: 'https://private-rpc.internal.example' },
        contracts: {},
        debug: { enableLogs: false },
    },
    serverRuntimeConfig: {
        admin: { emailAllowlist: [] },
        auth: { serviceRoleKey: '' },
        verification: { hashSecret: '' },
        debug: { enableLogs: false },
    },
}));

const enforceRateLimit = vi.fn();
vi.mock('@/lib/rateLimit', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/lib/rateLimit')>();
    return {
        ...actual,
        enforceRateLimit: (...args: Parameters<typeof actual.enforceRateLimit>) => enforceRateLimit(...args),
    };
});

const { GET } = await import('@/app/api/health/route');
const { resetServiceHealthCacheForTests, HEALTH_CACHE_SECONDS, overallState } = await import('@/lib/serviceHealth');

type Outcome = 'up' | 'down' | 'error' | 'unhealthy';

/** A fetch that answers each dependency according to `outcomes`. */
function stubDependencies(outcomes: Partial<Record<'rpc' | 'rest' | 'auth' | 'storage' | 'redis', Outcome>> = {}) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const key = url.startsWith(RPC_URL)
            ? 'rpc'
            : url.startsWith(REDIS_URL)
              ? 'redis'
              : url.includes('/rest/v1/')
                ? 'rest'
                : url.includes('/auth/v1/')
                  ? 'auth'
                  : 'storage';
        const outcome = outcomes[key] ?? 'up';

        if (outcome === 'error') {
            // What a real failure looks like: internal detail in the message.
            throw new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname} (pg 15.4, supabase-js 2.106)`);
        }
        if (outcome === 'down') {
            return new Response(`upstream ${new URL(url).hostname} 502 Bad Gateway`, { status: 502 });
        }
        if (key === 'rpc') {
            const status = outcome === 'unhealthy' ? 'unhealthy' : 'healthy';
            return Response.json({ jsonrpc: '2.0', id: 1, result: { status, latestLedger: 123, version: '22.1.0' } });
        }
        if (key === 'redis') return Response.json([{ result: 'PONG' }]);
        if (key === 'storage') return Response.json({ error: 'Unauthorized' }, { status: 400 });
        return Response.json({ ok: true, version: 'v2.170.0' });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

function request(ip = '203.0.113.7') {
    return new Request('http://localhost/api/health', { headers: { 'x-forwarded-for': ip } });
}

async function get() {
    // @ts-expect-error NextRequest vs Request
    const response = await GET(request());
    return { response, body: await response.json() };
}

beforeEach(() => {
    resetServiceHealthCacheForTests();
    enforceRateLimit.mockReset().mockResolvedValue(null);
    vi.stubEnv('UPSTASH_REDIS_REST_URL', REDIS_URL);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('GET /api/health', () => {
    it('reports every dependency as operational when all answer', async () => {
        const fetchMock = stubDependencies();
        const { response, body } = await get();

        expect(response.status).toBe(200);
        expect(body).toEqual({
            status: 'operational',
            checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
            dependencies: {
                blockchain: 'operational',
                database: 'operational',
                auth: 'operational',
                storage: 'operational',
                rateLimiting: 'operational',
            },
        });

        const urls = fetchMock.mock.calls.map(([url]) => String(url));
        expect(urls).toEqual(
            expect.arrayContaining([
                RPC_URL,
                `${SUPABASE_URL}/rest/v1/institutions?select=id&limit=1`,
                `${SUPABASE_URL}/auth/v1/health`,
                `${SUPABASE_URL}/storage/v1/bucket`,
                `${REDIS_URL}/pipeline`,
            ]),
        );
    });

    it('bounds every probe with a timeout and bypasses the fetch cache', async () => {
        const fetchMock = stubDependencies();
        await get();

        expect(fetchMock).toHaveBeenCalledTimes(5);
        for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
            expect(init.signal).toBeInstanceOf(AbortSignal);
            expect(init.cache).toBe('no-store');
        }
    });

    it('reports an outage with 503 when the chain cannot be read', async () => {
        stubDependencies({ rpc: 'error' });
        const { response, body } = await get();

        expect(response.status).toBe(503);
        expect(body.status).toBe('outage');
        expect(body.dependencies.blockchain).toBe('outage');
        expect(body.dependencies.database).toBe('operational');
    });

    it('treats an RPC that answers but is not healthy as an outage', async () => {
        stubDependencies({ rpc: 'unhealthy' });
        const { body } = await get();
        expect(body.dependencies.blockchain).toBe('outage');
    });

    it('reports a database outage with 503', async () => {
        stubDependencies({ rest: 'down' });
        const { response, body } = await get();
        expect(response.status).toBe(503);
        expect(body.dependencies.database).toBe('outage');
    });

    it('is degraded, not down, when only auth or storage fail', async () => {
        stubDependencies({ auth: 'down', storage: 'error' });
        const { response, body } = await get();

        expect(response.status).toBe(200);
        expect(body.status).toBe('degraded');
        expect(body.dependencies).toMatchObject({ auth: 'outage', storage: 'outage', blockchain: 'operational' });
    });

    it('accepts a storage answer short of a server error (the bucket is private)', async () => {
        stubDependencies({ storage: 'down' });
        expect((await get()).body.dependencies.storage).toBe('outage');

        resetServiceHealthCacheForTests();
        stubDependencies();
        expect((await get()).body.dependencies.storage).toBe('operational');
    });

    it('reports Redis loss as degraded rate limiting, since limits fall back to memory', async () => {
        stubDependencies({ redis: 'error' });
        const { response, body } = await get();

        expect(response.status).toBe(200);
        expect(body.status).toBe('degraded');
        expect(body.dependencies.rateLimiting).toBe('degraded');
    });

    it('reports rate limiting as degraded when Redis is not configured', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        stubDependencies();
        const { body } = await get();
        expect(body.dependencies.rateLimiting).toBe('degraded');
    });

    it('answers even when every dependency is down', async () => {
        stubDependencies({ rpc: 'error', rest: 'error', auth: 'error', storage: 'error', redis: 'error' });
        const { response, body } = await get();

        expect(response.status).toBe(503);
        expect(body.status).toBe('outage');
        expect(Object.values(body.dependencies)).toEqual(['outage', 'outage', 'outage', 'outage', 'degraded']);
    });

    it('reveals no hostnames, versions or error details', async () => {
        for (const outcome of ['up', 'down', 'error'] as const) {
            resetServiceHealthCacheForTests();
            stubDependencies({ rpc: outcome, rest: outcome, auth: outcome, storage: outcome, redis: outcome });
            const { response, body } = await get();
            // checkedAt is a timestamp, whose digits could match by chance.
            const text = JSON.stringify({ ...body, checkedAt: undefined });

            for (const leak of ['supabase', 'secret-project-ref', 'private-rpc', 'upstash', 'hidden-redis',
                'ENOTFOUND', '502', 'version', 'v2.170', '22.1.0', 'pg 15', 'latestLedger', 'anon-key', 'redis-token']) {
                expect(text, `${outcome}: leaks ${leak}`).not.toContain(leak);
            }
            expect(Object.keys(body).sort()).toEqual(['checkedAt', 'dependencies', 'status']);
            for (const value of [body.status, ...Object.values(body.dependencies)]) {
                expect(['operational', 'degraded', 'outage']).toContain(value);
            }
            expect(response.headers.get('server')).toBeNull();
        }
    });

    it('is rate-limited per client', async () => {
        stubDependencies();
        enforceRateLimit.mockResolvedValueOnce(
            NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '30' } }),
        );

        const { response } = await get();
        expect(response.status).toBe(429);
        expect(response.headers.get('Retry-After')).toBe('30');
        expect(enforceRateLimit).toHaveBeenCalledWith(
            expect.any(Request),
            expect.objectContaining({ prefix: 'health', windowSeconds: 60, maxRequests: expect.any(Number) }),
        );
    });

    it('does not probe the dependencies when the request is rate-limited', async () => {
        const fetchMock = stubDependencies();
        enforceRateLimit.mockResolvedValueOnce(NextResponse.json({}, { status: 429 }));
        await get();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('enforces the real limiter: the 31st request in a minute is refused', async () => {
        const { enforceRateLimit: realLimit, setRateLimitStoreForTests, createInMemoryRateLimitStore } =
            await vi.importActual<typeof import('@/lib/rateLimit')>('@/lib/rateLimit');
        setRateLimitStoreForTests(createInMemoryRateLimitStore());
        enforceRateLimit.mockImplementation(realLimit);
        stubDependencies();

        const statuses: number[] = [];
        for (let i = 0; i < 31; i++) {
            // @ts-expect-error NextRequest vs Request
            statuses.push((await GET(request('198.51.100.9'))).status);
        }
        expect(statuses.slice(0, 30).every((status) => status === 200)).toBe(true);
        expect(statuses[30]).toBe(429);
    });

    it('caches the report for about 30 seconds', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const fetchMock = stubDependencies();

        const first = await get();
        const second = await get();
        expect(fetchMock).toHaveBeenCalledTimes(5);
        expect(second.body.checkedAt).toBe(first.body.checkedAt);
        expect(first.response.headers.get('Cache-Control')).toBe(
            `public, max-age=${HEALTH_CACHE_SECONDS}, s-maxage=${HEALTH_CACHE_SECONDS}`,
        );

        vi.setSystemTime(Date.now() + (HEALTH_CACHE_SECONDS + 1) * 1000);
        await get();
        expect(fetchMock).toHaveBeenCalledTimes(10);
    });

    it('shares one round of probes between concurrent requests', async () => {
        const fetchMock = stubDependencies();
        await Promise.all([get(), get(), get()]);
        expect(fetchMock).toHaveBeenCalledTimes(5);
    });
});

describe('overallState', () => {
    const all = (state: 'operational' | 'degraded' | 'outage') => ({
        blockchain: state, database: state, auth: state, storage: state, rateLimiting: state,
    });

    it('is operational only when everything is', () => {
        expect(overallState(all('operational'))).toBe('operational');
        expect(overallState({ ...all('operational'), rateLimiting: 'degraded' })).toBe('degraded');
    });

    it('is an outage when verification or the database is down', () => {
        expect(overallState({ ...all('operational'), blockchain: 'outage' })).toBe('outage');
        expect(overallState({ ...all('operational'), database: 'outage' })).toBe('outage');
        expect(overallState({ ...all('operational'), storage: 'outage' })).toBe('degraded');
    });
});
