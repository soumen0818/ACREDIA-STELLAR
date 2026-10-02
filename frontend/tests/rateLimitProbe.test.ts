import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeRateLimiterHealth } from '../src/lib/rateLimit';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('live rate-limit health probe', () => {
    it('reports unconfigured Redis without making a request', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        expect(await probeRateLimiterHealth()).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('requires a successful PONG from the configured backend', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example/');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [{ result: 'PONG' }] });
        vi.stubGlobal('fetch', fetchMock);
        expect(await probeRateLimiterHealth()).toBe(true);
        expect(fetchMock).toHaveBeenCalledWith('https://redis.example/pipeline', expect.objectContaining({
            method: 'POST', body: JSON.stringify([['PING']]), cache: 'no-store',
        }));
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [{ error: 'unauthorized' }] });
        expect(await probeRateLimiterHealth()).toBe(false);
    });

    it('reports an outage as unhealthy', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example');
        vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network outage')));
        expect(await probeRateLimiterHealth()).toBe(false);
    });
});
