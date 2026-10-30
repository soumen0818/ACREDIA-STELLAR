import { describe, expect, it } from 'vitest';
import {
    CREDENTIAL_HASH_ALGORITHM_V1,
    CREDENTIAL_HASH_ALGORITHM_V2,
    CREDENTIAL_METADATA_SCHEMA_VERSION_V1,
    CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
    deriveCredentialHash,
} from '../src/lib/credentialHash';
import { documentEvidenceId } from '../src/lib/credentialDocuments';
import { isShareToken, shareUrl, verifyStoredCredential } from '../src/lib/sharedCredential';
import { buildAcrediaVerifiableCredential } from '../src/lib/verifiableCredential';

/** The share page's proof that stored content is what was anchored (review §3.11b). */

const STUDENT = 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD';
const DIGEST = 'd'.repeat(64);

function issuedCredential(withDocument = true) {
    return buildAcrediaVerifiableCredential(
        {
            studentName: 'Ada Lovelace',
            studentWallet: STUDENT,
            degree: 'BSc Computer Science',
            major: 'Algorithms',
            gpa: '3.9',
            issueDate: '2026-06-01',
            credentialType: 'diploma',
            institutionName: 'Uni Example',
            institutionWallet: 'GISSUER',
            subjects: [{ id: 's1', name: 'Analysis', marks: '90', maxMarks: '100', grade: 'A' }],
        },
        'https://stellar.expert/explorer/testnet',
        withDocument ? { id: documentEvidenceId(DIGEST), description: 'Original document' } : null,
    );
}

async function anchor(metadata: unknown) {
    return deriveCredentialHash(metadata, CREDENTIAL_METADATA_SCHEMA_VERSION_V2, CREDENTIAL_HASH_ALGORITHM_V2);
}

function check(metadata: unknown, onChainHash: string, overrides: Record<string, unknown> = {}) {
    return verifyStoredCredential({
        metadata,
        schemaVersion: CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
        hashAlgorithm: CREDENTIAL_HASH_ALGORITHM_V2,
        onChainHash,
        onChainStudent: STUDENT,
        ...overrides,
    });
}

describe('verifyStoredCredential', () => {
    it('returns the anchored details and document digest when the hash matches', async () => {
        const metadata = issuedCredential();
        const result = await check(metadata, await anchor(metadata));

        expect(result).toEqual({
            ok: true,
            details: {
                studentName: 'Ada Lovelace',
                credentialType: 'diploma',
                degree: 'BSc Computer Science',
                major: 'Algorithms',
                gpa: '3.9',
                issueDate: '2026-06-01',
                institutionName: 'Uni Example',
                subjects: [{ name: 'Analysis', marks: '90', maxMarks: '100', grade: 'A' }],
            },
            documentSha256: DIGEST,
        });
    });

    it('rejects content edited after issuance', async () => {
        const metadata = issuedCredential();
        const onChainHash = await anchor(metadata);
        metadata.credentialData.gpa = '4.0';

        expect(await check(metadata, onChainHash)).toEqual({ ok: false, reason: 'hash_mismatch' });
    });

    it('rejects a swapped document digest, which the hash covers', async () => {
        const metadata = issuedCredential();
        const onChainHash = await anchor(metadata);
        metadata.evidence[0].id = documentEvidenceId('e'.repeat(64));

        expect(await check(metadata, onChainHash)).toEqual({ ok: false, reason: 'hash_mismatch' });
    });

    it('never shows fields the hash does not cover', async () => {
        // Extra keys do not change the canonical hash, so they must not reach
        // the page: display comes from the canonical payload only.
        const metadata = issuedCredential();
        const onChainHash = await anchor(metadata);
        const edited = {
            ...metadata,
            credentialData: {
                ...metadata.credentialData,
                honours: 'First Class (forged)',
                // Canonicalisation keeps only the date part of `<date>T…`,
                // so this edit hashes the same as the original.
                issueDate: '2026-06-01T00:00:00Z with First Class Honours (forged)',
            },
            displayName: 'Mallory',
        };

        const result = await check(edited, onChainHash);

        expect(result.ok).toBe(true);
        expect(JSON.stringify(result)).not.toMatch(/forged|Mallory/);
        expect(result.ok && result.details.issueDate).toBe('2026-06-01');
    });

    it('rejects content that names a different holder than the contract', async () => {
        const metadata = issuedCredential();
        const result = await check(metadata, await anchor(metadata), {
            onChainStudent: 'GOTHERHOLDER',
        });

        expect(result).toEqual({ ok: false, reason: 'holder_mismatch' });
    });

    it('accepts only the current schema and hash algorithm', async () => {
        const metadata = issuedCredential();
        const onChainHash = await anchor(metadata);

        for (const [schemaVersion, hashAlgorithm] of [
            [CREDENTIAL_METADATA_SCHEMA_VERSION_V1, CREDENTIAL_HASH_ALGORITHM_V1],
            [CREDENTIAL_METADATA_SCHEMA_VERSION_V2, CREDENTIAL_HASH_ALGORITHM_V1],
            [null, null],
        ] as const) {
            expect(await check(metadata, onChainHash, { schemaVersion, hashAlgorithm })).toEqual({
                ok: false,
                reason: 'unsupported_schema',
            });
        }
    });

    it('reports no document when none was attached', async () => {
        const metadata = issuedCredential(false);
        const result = await check(metadata, await anchor(metadata));

        expect(result).toMatchObject({ ok: true, documentSha256: null });
    });
});

describe('share tokens', () => {
    it('accepts the UUIDs the database generates, in either case', () => {
        expect(isShareToken('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
        expect(isShareToken('3F2504E0-4F89-41D3-9A0C-0305E82C3301')).toBe(true);
    });

    it.each(['1', '42', '', 'not-a-token', '3f2504e0-4f89-41d3-9a0c-0305e82c330', `${'a'.repeat(36)}`])(
        'rejects %j',
        (value) => {
            expect(isShareToken(value)).toBe(false);
        },
    );

    it('builds the public share URL', () => {
        expect(shareUrl('https://acredia.example', 'abc')).toBe('https://acredia.example/credentials/abc');
    });
});
