import { describe, expect, it } from 'vitest';
import { parseShareResponse } from '../src/lib/sharedCredentialView';

/** The share page's reading of `/api/credentials/share/:shareToken` (review §3.11b). */

const SHARE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const details = {
    studentName: 'Ada Lovelace',
    credentialType: 'diploma',
    degree: 'BSc Computer Science',
    major: null,
    gpa: '3.9',
    issueDate: '2026-06-01',
    institutionName: 'Uni Example (as written)',
    subjects: [],
};

function payload(overrides: { credential?: object; verification?: object } = {}) {
    return {
        credential: {
            tokenId: '7',
            status: 'valid',
            issuedAt: '2026-06-01T09:00:00.000Z',
            expiresAt: null,
            revokedAt: null,
            revocationSource: null,
            institutionName: 'Uni Example',
            institutionWallet: 'GISSUER',
            studentWallet: 'GSTUDENT',
            onChainHash: 'ab'.repeat(32),
            transactionHash: 'tx-7',
            details,
            metadata: { id: 'urn:uuid:1' },
            metadataSchemaVersion: 2,
            hashAlgorithm: 'sha256:canonical-json:v2',
            document: { url: 'https://storage.test/signed', sha256: 'd'.repeat(64), expiresInSeconds: 300 },
            documentStatus: 'available',
            ...overrides.credential,
        },
        verification: { verified: true, contentMatches: true, issuerAuthorized: true, ...overrides.verification },
    };
}

describe('parseShareResponse', () => {
    it('builds the card from verified content', () => {
        const view = parseShareResponse(SHARE, payload());

        expect(view.status.status).toBe('valid');
        expect(view.card).toEqual({
            shareToken: SHARE,
            tokenId: '7',
            status: 'valid',
            issuedAt: '2026-06-01T09:00:00.000Z',
            expiresAt: null,
            revocationSource: null,
            institutionName: 'Uni Example',
            issuerWallet: 'GISSUER',
            studentWallet: 'GSTUDENT',
            onChainHash: 'ab'.repeat(32),
            transactionHash: 'tx-7',
            details,
            metadata: { id: 'urn:uuid:1' },
            metadataSchemaVersion: 2,
            hashAlgorithm: 'sha256:canonical-json:v2',
            document: { url: 'https://storage.test/signed', sha256: 'd'.repeat(64) },
            documentStatus: 'available',
        });
    });

    it('builds no card when the content did not match the chain', () => {
        const view = parseShareResponse(
            SHARE,
            payload({ verification: { verified: false, contentMatches: false } }),
        );
        expect(view.card).toBeNull();
        expect(view.status.token_id).toBe('7');
    });

    it('builds no card when contentMatches is missing or not strictly true', () => {
        for (const contentMatches of [undefined, 'true', 1]) {
            expect(parseShareResponse(SHARE, payload({ verification: { contentMatches } })).card).toBeNull();
        }
    });

    it('builds no card when no details were sent', () => {
        expect(parseShareResponse(SHARE, payload({ credential: { details: null } })).card).toBeNull();
    });

    it('fails closed on an unrecognised status', () => {
        expect(() => parseShareResponse(SHARE, payload({ credential: { status: 'ok' } }))).toThrow(
            /unexpected response/,
        );
    });

    it('falls back to the name written in the credential when no institution is registered', () => {
        const view = parseShareResponse(SHARE, payload({ credential: { institutionName: null } }));
        expect(view.card?.institutionName).toBe('Uni Example (as written)');
    });

    it('drops an incomplete document and normalises its status', () => {
        const view = parseShareResponse(
            SHARE,
            payload({ credential: { document: { url: 'x' }, documentStatus: 'weird' } }),
        );
        expect(view.card).toMatchObject({ document: null, documentStatus: 'none' });
    });
});
