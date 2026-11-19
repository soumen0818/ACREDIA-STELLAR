import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * src/lib/issuerRegistry.ts: the public issuer registry, shared by
 * GET /api/issuers and the server-rendered /issuers page (review §4.5).
 */

const config = vi.hoisted(() => ({ supabase: { url: 'https://test.supabase.co', anonKey: 'test-anon-key' } }));
const captureException = vi.hoisted(() => vi.fn());

vi.mock('../src/lib/runtimeConfig', () => ({ runtimeConfig: config }));
vi.mock('../src/lib/debug', () => ({ captureException }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

const { createClient } = await import('@supabase/supabase-js');
const { fetchVerifiedIssuers, loadVerifiedIssuersForPage, ISSUER_REGISTRY_REVALIDATE_SECONDS } = await import(
    '../src/lib/issuerRegistry'
);

const ROW = {
    id: 'inst-1',
    name: 'Acredia Academy',
    wallet_address: 'GAcrediaIssuerWallet0000000000000000000000000000001',
    authorization_tx_hash: 'a'.repeat(64),
    created_at: '2026-10-01T00:00:00.000Z',
};

/** A Supabase client stand-in that records the query it was given. */
function client(result: { data: unknown; error: unknown }) {
    const calls: Record<string, unknown[]> = {};
    const builder = {
        select: (...args: unknown[]) => ((calls.select = args), builder),
        eq: (...args: unknown[]) => ((calls.eq = args), builder),
        order: async (...args: unknown[]) => ((calls.order = args), result),
    };
    return { calls, client: { from: (...args: unknown[]) => ((calls.from = args), builder) } };
}

beforeEach(() => {
    vi.mocked(createClient).mockReset();
    captureException.mockReset();
    config.supabase = { url: 'https://test.supabase.co', anonKey: 'test-anon-key' };
});

describe('fetchVerifiedIssuers', () => {
    it('reads verified institutions, newest first, without personal columns', async () => {
        const { calls, client: db } = client({ data: [ROW], error: null });
        const issuers = await fetchVerifiedIssuers(db as never);

        expect(calls.from).toEqual(['institutions']);
        expect(calls.eq).toEqual(['verified', true]);
        expect(calls.order).toEqual(['created_at', { ascending: false }]);
        expect(String(calls.select?.[0])).not.toMatch(/email/);
        expect(issuers).toEqual([
            {
                id: 'inst-1',
                name: 'Acredia Academy',
                wallet_address: ROW.wallet_address,
                authorization_tx_hash: ROW.authorization_tx_hash,
                verified_at: ROW.created_at,
            },
        ]);
    });

    it('throws a database error', async () => {
        const { client: db } = client({ data: null, error: new Error('db down') });
        await expect(fetchVerifiedIssuers(db as never)).rejects.toThrow('db down');
    });
});

describe('loadVerifiedIssuersForPage', () => {
    it('returns the registry for the page to render', async () => {
        vi.mocked(createClient).mockReturnValue(client({ data: [ROW], error: null }).client as never);
        expect(await loadVerifiedIssuersForPage()).toHaveLength(1);
    });

    it('caches the read for five minutes and bounds it with a timeout', async () => {
        vi.mocked(createClient).mockReturnValue(client({ data: [], error: null }).client as never);
        await loadVerifiedIssuersForPage();

        const options = vi.mocked(createClient).mock.calls[0][2] as { global: { fetch: typeof fetch } };
        const realFetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]'));
        vi.stubGlobal('fetch', realFetch);
        try {
            await options.global.fetch('https://test.supabase.co/rest/v1/institutions', { method: 'GET' });
        } finally {
            vi.unstubAllGlobals();
        }

        const init = realFetch.mock.calls[0][1] as RequestInit & { next?: { revalidate?: number } };
        expect(ISSUER_REGISTRY_REVALIDATE_SECONDS).toBe(300);
        expect(init.next).toEqual({ revalidate: 300 });
        expect(init.signal).toBeInstanceOf(AbortSignal);
        expect(init.method).toBe('GET');
    });

    it('returns null, and reports it, when the database fails, so the page loads the list in the browser', async () => {
        vi.mocked(createClient).mockReturnValue(client({ data: null, error: new Error('db down') }).client as never);

        expect(await loadVerifiedIssuersForPage()).toBeNull();
        expect(captureException).toHaveBeenCalledOnce();
    });

    it('returns null without Supabase configuration', async () => {
        config.supabase = { url: '', anonKey: '' };

        expect(await loadVerifiedIssuersForPage()).toBeNull();
        expect(createClient).not.toHaveBeenCalled();
    });
});
