import { describe, expect, it } from 'vitest';
import { parseVerificationResponse } from '../src/hooks/useCredentialVerification';

/** The verify page's reading of the status-only API (review §3.11b). */
describe('parseVerificationResponse', () => {
    const payload = {
        credential: {
            tokenId: '7',
            status: 'expired',
            issuedAt: '2026-01-01T00:00:00.000Z',
            expiresAt: '2027-01-01T00:00:00.000Z',
            revoked: false,
            revokedAt: null,
            revocationSource: null,
            institutionName: 'Uni Example',
            institutionWallet: 'GISSUER',
            onChainHash: 'ab'.repeat(32),
        },
        verification: { verified: false, status: 'expired', issuerAuthorized: false },
    };

    it('maps every field of the status response', () => {
        expect(parseVerificationResponse(payload)).toEqual({
            token_id: '7',
            status: 'expired',
            issued_at: '2026-01-01T00:00:00.000Z',
            expires_at: '2027-01-01T00:00:00.000Z',
            revoked_at: null,
            revocation_source: null,
            institution_name: 'Uni Example',
            issuer_wallet_address: 'GISSUER',
            on_chain_hash: 'ab'.repeat(32),
            issuer_authorized: false,
            stale: false,
            checked_at: null,
            revocation_may_be_outdated: false,
        });
    });

    it.each([undefined, 'verified', 'VALID', ''])(
        'fails closed on a status of %s rather than showing a verified credential',
        (status) => {
            expect(() =>
                parseVerificationResponse({ ...payload, credential: { ...payload.credential, status } }),
            ).toThrow(/unexpected response/);
        },
    );

    it('keeps only the two known revocation sources', () => {
        const parsed = parseVerificationResponse({
            ...payload,
            credential: { ...payload.credential, status: 'revoked', revocationSource: 'someone' },
        });
        expect(parsed.revocation_source).toBeNull();
    });

    it('reports issuer authorization as unknown when it is missing', () => {
        expect(parseVerificationResponse({ credential: payload.credential }).issuer_authorized).toBeNull();
    });

    describe('freshness (issue #313)', () => {
        const valid = { ...payload.credential, status: 'valid' };
        const CHECKED = '2029-12-31T23:00:00.000Z';

        it('reads a live answer and its check time', () => {
            const parsed = parseVerificationResponse({
                credential: valid,
                verification: { stale: false, checkedAt: CHECKED },
            });
            expect(parsed).toMatchObject({ stale: false, checked_at: CHECKED, revocation_may_be_outdated: false });
        });

        it('reads a stale valid answer as possibly revoked since', () => {
            const parsed = parseVerificationResponse({
                credential: valid,
                verification: { stale: true, checkedAt: CHECKED, revocationStatusMayBeOutdated: true },
            });
            expect(parsed).toMatchObject({ status: 'valid', stale: true, checked_at: CHECKED, revocation_may_be_outdated: true });
        });

        it('assumes a stale unrevoked answer may be outdated unless told otherwise', () => {
            const parsed = parseVerificationResponse({ credential: valid, verification: { stale: true, checkedAt: CHECKED } });
            expect(parsed.revocation_may_be_outdated).toBe(true);
        });

        it('never doubts a stale revocation: revocation is permanent', () => {
            const parsed = parseVerificationResponse({
                credential: { ...valid, status: 'revoked' },
                verification: { stale: true, checkedAt: CHECKED, revocationStatusMayBeOutdated: true },
            });
            expect(parsed.revocation_may_be_outdated).toBe(false);
        });

        it.each([undefined, null, '', 'yesterday', 42])(
            'fails closed on a stale answer whose age is %s, rather than showing it undated',
            (checkedAt) => {
                expect(() =>
                    parseVerificationResponse({ credential: valid, verification: { stale: true, checkedAt } }),
                ).toThrow(/unexpected response/);
            },
        );

        it('treats an answer from an older server, with no freshness fields, as live', () => {
            expect(parseVerificationResponse({ credential: valid })).toMatchObject({
                stale: false,
                checked_at: null,
                revocation_may_be_outdated: false,
            });
        });
    });
});
