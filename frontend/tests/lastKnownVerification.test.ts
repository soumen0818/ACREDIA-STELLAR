/**
 * Issue #313 — the last known verification answer, kept in Upstash Redis for
 * outages (src/lib/verificationCache.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getLastKnownVerification,
    LAST_KNOWN_TTL_SECONDS,
    setLastKnownVerification,
    type LastKnownVerification,
} from '../src/lib/verificationCache';

const REDIS = 'https://redis.test';

function record(overrides: Partial<LastKnownVerification> = {}): LastKnownVerification {
    return {
        onChain: {
            tokenId: '7',
            student: 'GSTUDENT',
            issuer: 'GISSUER',
            hash: 'ab'.repeat(32),
            issuedAt: 1_780_000_000,
            expiresAt: null,
            revoked: false,
        },
        revoked: false,
        issuerAuthorized: true,
        checkedAt: 1_900_000_000_000,
        ...overrides,
    };
}

/** An in-memory Upstash REST API: GET /get/:key and POST /set/:key. */
function stubRedis(initial: Record<string, string> = {}) {
    const store = new Map(Object.entries(initial));
    const ttls = new Map<string, number>();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const [, op, rawKey] = url.pathname.split('/');
        const key = decodeURIComponent(rawKey);
        if (op === 'get') return Response.json({ result: store.get(key) ?? null });
        if (op === 'set') {
            const [value, , ttl] = JSON.parse(String(init?.body)) as [string, string, number];
            store.set(key, value);
            ttls.set(key, ttl);
            return Response.json({ result: 'OK' });
        }
        return new Response('unknown', { status: 400 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return { store, ttls, fetchMock };
}

beforeEach(() => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', REDIS);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('last known verification', () => {
    it('round-trips a record, kept for the documented window', async () => {
        const { ttls } = stubRedis();
        await setLastKnownVerification('7', record());

        await expect(getLastKnownVerification('7')).resolves.toEqual(record());
        expect(ttls.get('verify:last-known:7')).toBe(LAST_KNOWN_TTL_SECONDS);
    });

    it('is null when nothing was recorded', async () => {
        stubRedis();
        await expect(getLastKnownVerification('7')).resolves.toBeNull();
    });

    it('stays revoked once seen revoked, even if an older "not revoked" write lands last', async () => {
        const { store } = stubRedis();
        // Two requests race: the revoked read is written first, the older
        // unrevoked one second.
        await setLastKnownVerification('7', record({ revoked: true, checkedAt: 2 }));
        await setLastKnownVerification('7', record({ revoked: false, checkedAt: 1 }));

        expect(JSON.parse(store.get('verify:last-known:7') as string).revoked).toBe(false);
        await expect(getLastKnownVerification('7')).resolves.toMatchObject({ revoked: true });
    });

    it('never sets the revoked-seen flag for an unrevoked credential', async () => {
        const { store } = stubRedis();
        await setLastKnownVerification('7', record());
        expect(store.has('verify:revoked-seen:7')).toBe(false);
    });

    it.each([
        ['unparseable JSON', '{nope'],
        ['a missing checkedAt', JSON.stringify({ ...record(), checkedAt: undefined })],
        ['a non-numeric checkedAt', JSON.stringify({ ...record(), checkedAt: '2030-01-01' })],
        ['a missing revocation flag', JSON.stringify({ ...record(), revoked: undefined })],
        ['a missing on-chain hash', JSON.stringify({ ...record(), onChain: { ...record().onChain, hash: '' } })],
        ['no on-chain record', JSON.stringify({ ...record(), onChain: null })],
    ])('ignores a record with %s rather than serve it', async (_name, raw) => {
        stubRedis({ 'verify:last-known:7': raw });
        await expect(getLastKnownVerification('7')).resolves.toBeNull();
    });

    it('is null, not an error, when Redis is unreachable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
        await expect(getLastKnownVerification('7')).resolves.toBeNull();
        await expect(setLastKnownVerification('7', record())).resolves.toBeUndefined();
    });

    it('is null when Redis is not configured', async () => {
        vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(getLastKnownVerification('7')).resolves.toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
