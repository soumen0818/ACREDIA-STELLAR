import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { client, mockAuth } = vi.hoisted(() => {
    const insert = vi.fn(async () => ({ error: null }));
    return {
        client: {
            rpc: vi.fn(async () => ({ data: true, error: null })),
            from: vi.fn(() => ({ insert })),
        },
        mockAuth: vi.fn((): { ok: boolean; status?: number; error?: string } => ({ ok: true })),
    };
});
vi.mock('../src/lib/serverAuth', () => ({ getServiceRoleClient: () => client }));
vi.mock('../src/lib/cronAuth', () => ({ authorizeCronRequest: mockAuth }));
vi.mock('../src/lib/runtimeConfig', () => ({ runtimeConfig: { stellar: {}, contracts: {} } }));
vi.mock('../src/lib/debug', () => ({
    captureException: vi.fn(),
    structuredLog: vi.fn(),
    recordMetric: vi.fn(),
}));

import { GET } from '../src/app/api/cron/ttl-keeper/route';

afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
});

describe('TTL keeper route failure accounting', () => {
    it('refuses an unauthenticated cron request before taking a lock', async () => {
        mockAuth.mockReturnValueOnce({ ok: false, status: 401, error: 'Unauthorized' });
        const response = await GET(new NextRequest('http://localhost/api/cron/ttl-keeper'));
        expect(response.status).toBe(401);
        expect(client.rpc).not.toHaveBeenCalled();
    });

    it('records missing signer configuration as failed, never skipped or succeeded', async () => {
        vi.stubEnv('TTL_KEEPER_ACCOUNT_PUBLIC', '');
        vi.stubEnv('TTL_KEEPER_ACCOUNT_SECRET', '');
        const response = await GET(new NextRequest('http://localhost/api/cron/ttl-keeper'));
        expect(response.status).toBe(500);
        expect((await response.json()).success).toBe(false);
        expect(client.from).toHaveBeenCalledWith('cron_run_log');
        const insert = client.from.mock.results[0].value.insert;
        expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(client.rpc).toHaveBeenCalledWith('release_ttl_keeper_lock', expect.any(Object));
    });

    it('rejects an overlapping invocation', async () => {
        client.rpc.mockResolvedValueOnce({ data: false, error: null });
        const response = await GET(new NextRequest('http://localhost/api/cron/ttl-keeper'));
        expect(response.status).toBe(409);
        expect(client.from).not.toHaveBeenCalled();
    });
});
