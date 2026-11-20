import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetRateLimitStore } from '@/lib/rateLimit';
import { BlockchainUnavailableError, type OnChainCredential } from '@/lib/contractReads';

/**
 * Status-only verification by token ID (review §3.11b): the contract decides
 * the answer, the database only supplies display labels, and nothing
 * personal is returned.
 */

const db = vi.hoisted(() => ({
    credentialRow: null as Record<string, unknown> | null,
    institutionRow: null as Record<string, unknown> | null,
    logInsert: vi.fn(),
}));

const chain = vi.hoisted(() => ({
    getCredentialFromChain: vi.fn(),
    isRevokedFromChain: vi.fn(),
    isAuthorizedIssuerOnChain: vi.fn(),
}));

const cache = vi.hoisted(() => ({
    getCachedImmutableData: vi.fn(),
    setCachedImmutableData: vi.fn(),
    getCachedRevocationStatus: vi.fn(),
    setCachedRevocationStatus: vi.fn(),
    getCachedIssuerAuthorization: vi.fn(),
    setCachedIssuerAuthorization: vi.fn(),
    getLastKnownVerification: vi.fn(),
    setLastKnownVerification: vi.fn(),
}));

vi.mock('@/lib/serverAuth', () => ({
    getServiceRoleClient: () => ({
        from: (table: string) => ({
            select: () => ({
                eq: () => ({
                    maybeSingle: async () => ({
                        data: table === 'institutions' ? db.institutionRow : db.credentialRow,
                        error: null,
                    }),
                }),
            }),
            insert: db.logInsert,
        }),
    }),
}));

vi.mock('@/lib/contractReads', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/contractReads')>()),
    ...chain,
}));

vi.mock('@/lib/verificationCache', () => ({
    ...cache,
    RESPONSE_CACHE_MAX_AGE_SECONDS: 45,
    REVOCATION_TTL_SECONDS: 45,
}));

import { GET } from '@/app/api/verify/[token]/route';

const NOW = Date.UTC(2030, 0, 1) / 1000;

function onChainCredential(overrides: Partial<OnChainCredential> = {}): OnChainCredential {
    return {
        tokenId: '7',
        student: 'GSTUDENT',
        issuer: 'GISSUER',
        hash: 'ab'.repeat(32),
        issuedAt: NOW - 86_400,
        expiresAt: null,
        revoked: false,
        ...overrides,
    };
}

let ip = 0;
async function verify(token = '7') {
    ip += 1;
    const response = await GET(
        new NextRequest(`http://localhost/api/verify/${token}`, {
            headers: { 'x-forwarded-for': `192.0.2.${ip % 250}` },
        }),
        { params: Promise.resolve({ token }) },
    );
    return { response, payload: await response.json() };
}

function loggedResult() {
    return db.logInsert.mock.calls.at(-1)?.[0]?.verification_result;
}

beforeEach(() => {
    vi.clearAllMocks();
    resetRateLimitStore();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    db.credentialRow = { id: 'cred-7', revoked_at: null, revocation_source: null };
    db.institutionRow = { name: 'Uni Example' };
    db.logInsert.mockResolvedValue({ error: null });
    chain.getCredentialFromChain.mockResolvedValue(onChainCredential());
    chain.isRevokedFromChain.mockResolvedValue(false);
    chain.isAuthorizedIssuerOnChain.mockResolvedValue(true);
    cache.getCachedImmutableData.mockResolvedValue(null);
    cache.getCachedRevocationStatus.mockResolvedValue(null);
    cache.getCachedIssuerAuthorization.mockResolvedValue(null);
    cache.getLastKnownVerification.mockResolvedValue(null);
    cache.setLastKnownVerification.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('GET /api/verify/:tokenId — status from the contract', () => {
    it('reports a valid credential with issuer, dates and status only', async () => {
        const { response, payload } = await verify();

        expect(response.status).toBe(200);
        expect(payload.credential).toEqual({
            tokenId: '7',
            status: 'valid',
            issuedAt: new Date((NOW - 86_400) * 1000).toISOString(),
            expiresAt: null,
            revoked: false,
            revokedAt: null,
            revocationSource: null,
            institutionName: 'Uni Example',
            institutionWallet: 'GISSUER',
            onChainHash: 'ab'.repeat(32),
        });
        expect(payload.verification).toMatchObject({
            verified: true,
            status: 'valid',
            revoked: false,
            expired: false,
            issuerAuthorized: true,
        });
        expect(chain.isAuthorizedIssuerOnChain).toHaveBeenCalledWith('GISSUER');
        expect(loggedResult()).toMatchObject({ result_type: 'verified', status_code: 200 });
    });

    it('returns nothing that identifies the holder', async () => {
        const { payload } = await verify();
        const body = JSON.stringify(payload);

        expect(body).not.toContain('GSTUDENT');
        for (const field of ['studentWallet', 'studentName', 'degree', 'major', 'blockchainHash', 'ipfsHash']) {
            expect(payload.credential).not.toHaveProperty(field);
        }
    });

    it('takes revocation from the contract, not the database row', async () => {
        chain.isRevokedFromChain.mockResolvedValue(true);
        db.credentialRow = { id: 'cred-7', revoked_at: '2029-12-01T00:00:00Z', revocation_source: 'issuer' };

        const { payload } = await verify();

        expect(payload.credential).toMatchObject({
            status: 'revoked',
            revoked: true,
            revokedAt: '2029-12-01T00:00:00Z',
            revocationSource: 'issuer',
        });
        expect(payload.verification.verified).toBe(false);
        expect(loggedResult()).toMatchObject({ result_type: 'revoked' });
    });

    it('ignores revocation labels in the database while the contract says not revoked', async () => {
        // An edited row must not change the answer, in either direction.
        db.credentialRow = { id: 'cred-7', revoked_at: '2029-12-01T00:00:00Z', revocation_source: 'platform' };

        const { payload } = await verify();

        expect(payload.credential).toMatchObject({
            status: 'valid',
            revoked: false,
            revokedAt: null,
            revocationSource: null,
        });
    });

    it('verifies from the chain alone when the database has no row', async () => {
        db.credentialRow = null;
        db.institutionRow = null;

        const { response, payload } = await verify();

        expect(response.status).toBe(200);
        expect(payload.credential).toMatchObject({ status: 'valid', institutionName: null });
        expect(db.logInsert.mock.calls.at(-1)?.[0]).toMatchObject({ credential_id: null });
    });

    it('returns 404 when the contract has no such token, whatever the database holds', async () => {
        chain.getCredentialFromChain.mockResolvedValue(null);

        const { response, payload } = await verify();

        expect(response.status).toBe(404);
        expect(payload).toEqual({ success: false, error: 'Credential not found' });
        expect(loggedResult()).toMatchObject({ result_type: 'not_found', chain: { found: false } });
    });

    it('expires from the expiry second onwards, as the contract does', async () => {
        chain.getCredentialFromChain.mockResolvedValue(onChainCredential({ expiresAt: NOW + 1 }));
        expect((await verify()).payload.credential.status).toBe('valid');

        chain.getCredentialFromChain.mockResolvedValue(onChainCredential({ expiresAt: NOW }));
        const { payload } = await verify();

        expect(payload.credential).toMatchObject({
            status: 'expired',
            expiresAt: new Date(NOW * 1000).toISOString(),
            revoked: false,
        });
        expect(payload.verification).toMatchObject({ verified: false, expired: true });
        expect(loggedResult()).toMatchObject({ result_type: 'expired' });
    });

    it('reports revocation over expiry', async () => {
        chain.getCredentialFromChain.mockResolvedValue(onChainCredential({ expiresAt: NOW - 10 }));
        chain.isRevokedFromChain.mockResolvedValue(true);

        expect((await verify()).payload.credential.status).toBe('revoked');
    });

    it.each(['abc', '-1', '1.5', '0x10', '18446744073709551616', '1'.repeat(21)])(
        'rejects the token ID %s with 400 before touching the chain',
        async (token) => {
            const { response, payload } = await verify(token);

            expect(response.status).toBe(400);
            expect(payload).toEqual({ success: false, error: 'Invalid token ID' });
            expect(chain.getCredentialFromChain).not.toHaveBeenCalled();
        },
    );

    it('accepts the largest u64 token ID', async () => {
        chain.getCredentialFromChain.mockResolvedValue(null);
        const { response } = await verify('18446744073709551615');
        expect(response.status).toBe(404);
        expect(chain.getCredentialFromChain).toHaveBeenCalledWith('18446744073709551615');
    });

    it('fails closed with 503 when revocation cannot be read', async () => {
        chain.isRevokedFromChain.mockRejectedValue(new BlockchainUnavailableError('rpc down'));

        const { response, payload } = await verify();

        expect(response.status).toBe(503);
        expect(payload).toEqual({ success: false, error: 'Blockchain verification unavailable' });
    });

    it('fails closed with 503 when issuer authorization cannot be read', async () => {
        chain.isAuthorizedIssuerOnChain.mockRejectedValue(new BlockchainUnavailableError('rpc down'));

        expect((await verify()).response.status).toBe(503);
    });
});

describe('GET /api/verify/:tokenId — caching', () => {
    it('serves the cached record but still re-checks revocation and issuer, and re-evaluates expiry', async () => {
        // Cached while valid; the clock has since passed its expiry.
        cache.getCachedImmutableData.mockResolvedValue({
            onChain: onChainCredential({ expiresAt: NOW - 1 }),
        });

        const { payload } = await verify();

        expect(chain.getCredentialFromChain).not.toHaveBeenCalled();
        expect(cache.setCachedImmutableData).not.toHaveBeenCalled();
        expect(chain.isRevokedFromChain).toHaveBeenCalledWith('7');
        expect(chain.isAuthorizedIssuerOnChain).toHaveBeenCalledWith('GISSUER');
        expect(payload.credential.status).toBe('expired');
    });

    it('ignores the revoked flag inside a cached record', async () => {
        // The record was cached after revocation, but is_revoked now says no.
        cache.getCachedImmutableData.mockResolvedValue({
            onChain: onChainCredential({ revoked: true }),
        });

        expect((await verify()).payload.credential.status).toBe('valid');
    });

    it('caches a freshly read record, revocation and issuer answer', async () => {
        await verify();

        expect(cache.setCachedImmutableData).toHaveBeenCalledWith('7', {
            onChain: onChainCredential(),
        });
        expect(cache.setCachedRevocationStatus).toHaveBeenCalledWith('7', false);
        expect(cache.setCachedIssuerAuthorization).toHaveBeenCalledWith('GISSUER', true);
    });

    it('does not cache a missing credential', async () => {
        chain.getCredentialFromChain.mockResolvedValue(null);
        await verify();
        expect(cache.setCachedImmutableData).not.toHaveBeenCalled();
    });

    it('uses cached revocation and issuer answers without reading the chain', async () => {
        cache.getCachedRevocationStatus.mockResolvedValue(true);
        cache.getCachedIssuerAuthorization.mockResolvedValue(false);

        const { payload } = await verify();

        expect(chain.isRevokedFromChain).not.toHaveBeenCalled();
        expect(chain.isAuthorizedIssuerOnChain).not.toHaveBeenCalled();
        expect(payload.credential.status).toBe('revoked');
        expect(payload.verification.issuerAuthorized).toBe(false);
    });
});

/**
 * Issue #313: when every RPC endpoint fails, the last known answer is served,
 * dated and flagged; without one, the outage is reported as such. The rule:
 * "we cannot check right now" is never shown as invalid, and never as valid
 * without saying how old the answer is.
 */
describe('GET /api/verify/:tokenId — outages', () => {
    const CHECKED_AT = (NOW - 3_600) * 1000; // an hour before the outage

    function lastKnown(overrides: Record<string, unknown> = {}) {
        return { onChain: onChainCredential(), revoked: false, issuerAuthorized: true, checkedAt: CHECKED_AT, ...overrides };
    }

    function chainDown() {
        chain.getCredentialFromChain.mockRejectedValue(new BlockchainUnavailableError('every endpoint failed'));
    }

    it('answers live with checkedAt now and stale false', async () => {
        const { response, payload } = await verify();

        expect(response.status).toBe(200);
        expect(payload.verification).toMatchObject({
            stale: false,
            checkedAt: new Date(NOW * 1000).toISOString(),
            revocationStatusMayBeOutdated: false,
            issuerStatusMayBeOutdated: false,
        });
        expect(response.headers.get('Cache-Control')).toContain('public, s-maxage=45');
    });

    it('dates a live answer built from the short cache by the cache bound, never later', async () => {
        cache.getCachedRevocationStatus.mockResolvedValue(false);
        const { payload } = await verify();
        expect(payload.verification.checkedAt).toBe(new Date((NOW - 45) * 1000).toISOString());
    });

    it('records the live answer as the last known one', async () => {
        await verify();
        expect(cache.setLastKnownVerification).toHaveBeenCalledWith('7', {
            onChain: onChainCredential(),
            revoked: false,
            issuerAuthorized: true,
            checkedAt: NOW * 1000,
        });
    });

    it('does not rewrite the last known answer when nothing was read live', async () => {
        cache.getCachedRevocationStatus.mockResolvedValue(false);
        cache.getCachedIssuerAuthorization.mockResolvedValue(true);
        await verify();
        expect(cache.setLastKnownVerification).not.toHaveBeenCalled();
    });

    it('still answers when recording the last known answer fails', async () => {
        cache.setLastKnownVerification.mockImplementation(() => {
            throw new Error('redis exploded');
        });
        const { response, payload } = await verify();
        expect(response.status).toBe(200);
        expect(payload.verification.verified).toBe(true);
    });

    it('serves a stale valid answer dated and flagged, never as a live confirmation', async () => {
        chainDown();
        cache.getLastKnownVerification.mockResolvedValue(lastKnown());

        const { response, payload } = await verify();

        expect(response.status).toBe(200);
        expect(payload.credential).toMatchObject({ status: 'valid', revoked: false });
        expect(payload.verification).toMatchObject({
            verified: false,
            status: 'valid',
            stale: true,
            checkedAt: new Date(CHECKED_AT).toISOString(),
            revocationStatusMayBeOutdated: true,
            issuerStatusMayBeOutdated: true,
        });
        // Never stored, so recovery is seen on the next request.
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(loggedResult()).toMatchObject({ result_type: 'verified', status_code: 200, error_category: 'stale_answer' });
    });

    it('serves a stale revoked answer as revoked, with its revocation status not in doubt', async () => {
        chainDown();
        cache.getLastKnownVerification.mockResolvedValue(lastKnown({ revoked: true }));
        db.credentialRow = { id: 'cred-7', revoked_at: '2029-12-01T00:00:00Z', revocation_source: 'issuer' };

        const { response, payload } = await verify();

        expect(response.status).toBe(200);
        expect(payload.credential).toMatchObject({ status: 'revoked', revoked: true, revocationSource: 'issuer' });
        expect(payload.verification).toMatchObject({
            verified: false,
            stale: true,
            // Revocation is permanent on the contract.
            revocationStatusMayBeOutdated: false,
        });
    });

    it('re-evaluates expiry against the clock for a stale answer', async () => {
        chainDown();
        cache.getLastKnownVerification.mockResolvedValue(lastKnown({ onChain: onChainCredential({ expiresAt: NOW - 1 }) }));

        const { payload } = await verify();
        expect(payload.credential.status).toBe('expired');
        expect(payload.verification).toMatchObject({ stale: true, expired: true, verified: false });
    });

    it.each([
        ['the record read', () => chain.getCredentialFromChain.mockRejectedValue(new BlockchainUnavailableError('timeout of 4000 ms exceeded'))],
        ['the revocation read', () => chain.isRevokedFromChain.mockRejectedValue(new BlockchainUnavailableError('rpc 503'))],
        ['the issuer read', () => chain.isAuthorizedIssuerOnChain.mockRejectedValue(new BlockchainUnavailableError('rpc 503'))],
    ])('falls back to the last known answer when %s fails', async (_name, fail) => {
        fail();
        cache.getLastKnownVerification.mockResolvedValue(lastKnown());

        const { response, payload } = await verify();
        expect(response.status).toBe(200);
        expect(payload.verification.stale).toBe(true);
    });

    it('reports a total outage with no last known answer as 503, never as invalid', async () => {
        chainDown();

        const { response, payload } = await verify();

        expect(response.status).toBe(503);
        expect(payload).toEqual({ success: false, error: 'Blockchain verification unavailable' });
        expect(loggedResult()).toMatchObject({ result_type: 'chain_unavailable', status_code: 503 });
    });

    it('reports an outage as 503 when the last known answer cannot be read either', async () => {
        chainDown();
        cache.getLastKnownVerification.mockRejectedValue(new Error('redis down'));

        expect((await verify()).response.status).toBe(503);
    });

    it('never answers "not found" from the cache: a missing credential is only said live', async () => {
        chain.getCredentialFromChain.mockResolvedValue(null);
        cache.getLastKnownVerification.mockResolvedValue(lastKnown());

        const { response } = await verify();
        expect(response.status).toBe(404);
        expect(cache.getLastKnownVerification).not.toHaveBeenCalled();
    });

    it('does not paper over a configuration error with an old answer', async () => {
        const { ContractConfigurationError } = await import('@/lib/contractReads');
        chain.getCredentialFromChain.mockRejectedValue(new ContractConfigurationError());
        cache.getLastKnownVerification.mockResolvedValue(lastKnown());

        const { response } = await verify();
        expect(response.status).toBe(500);
        expect(cache.getLastKnownVerification).not.toHaveBeenCalled();
    });
});
