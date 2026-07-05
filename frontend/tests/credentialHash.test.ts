import { createHash } from 'crypto';
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import {
    CREDENTIAL_HASH_ALGORITHM,
    CREDENTIAL_METADATA_SCHEMA_VERSION,
    LEGACY_CREDENTIAL_HASH_ALGORITHM,
    LEGACY_CREDENTIAL_METADATA_SCHEMA_VERSION,
    buildCanonicalCredentialPayloadV1,
    canonicalJson,
    deriveCredentialHash,
    generateCanonicalCredentialHash,
    serializeCredentialMetadataForHash,
} from '../src/lib/credentialHash';

const metadata = {
    name: 'Degree - Alice Smith',
    description: 'Academic credential issued by Acredia Academy to Alice Smith',
    image: 'ipfs://file-cid',
    attributes: [{ trait_type: 'Credential Type', value: 'Degree' }],
    credentialData: {
        studentName: 'Alice Smith',
        studentWallet: 'GSTUDENTADDRESS',
        degree: 'BSc Computer Science',
        major: 'Software Engineering',
        gpa: undefined,
        issueDate: '2026-05-31',
        institutionName: 'Acredia Academy',
        credentialType: 'Degree',
        subjects: [
            {
                id: 'math-101',
                name: 'Mathematics',
                marks: 95,
                maxMarks: '100',
            },
        ],
    },
};

const canonicalVector =
    '{"credentialData":{"credentialType":"Degree","degree":"BSc Computer Science","gpa":null,"institutionName":"Acredia Academy","issueDate":"2026-05-31","major":"Software Engineering","studentName":"Alice Smith","studentWallet":"GSTUDENTADDRESS","subjects":[{"grade":null,"id":"math-101","marks":"95","maxMarks":"100","name":"Mathematics"}]},"description":"Academic credential issued by Acredia Academy to Alice Smith","image":"ipfs://file-cid","name":"Degree - Alice Smith","schemaVersion":1}';

const canonicalHashVector = 'feca52dc50aee21c1942333a13873250b5bda373e09a4e2aff29b80a44a78545';

describe('canonical credential metadata hashing', () => {
    it('serializes schema v1 payloads to a stable canonical test vector', () => {
        expect(serializeCredentialMetadataForHash(metadata)).toBe(canonicalVector);
    });

    it('hashes schema v1 payloads to the shared browser/server test vector', async () => {
        await expect(generateCanonicalCredentialHash(metadata)).resolves.toBe(canonicalHashVector);
        await expect(
            deriveCredentialHash(
                metadata,
                CREDENTIAL_METADATA_SCHEMA_VERSION,
                CREDENTIAL_HASH_ALGORITHM,
            ),
        ).resolves.toBe(canonicalHashVector);
    });

    it('keeps semantically equivalent metadata stable across key ordering and optional fields', async () => {
        const reordered = {
            credentialData: {
                subjects: [
                    {
                        maxMarks: 100,
                        marks: '95',
                        name: 'Mathematics',
                        id: 'math-101',
                        grade: undefined,
                    },
                ],
                credentialType: 'Degree',
                institutionName: 'Acredia Academy',
                issueDate: '2026-05-31',
                major: 'Software Engineering',
                degree: 'BSc Computer Science',
                studentWallet: 'GSTUDENTADDRESS',
                studentName: 'Alice Smith',
            },
            image: 'ipfs://file-cid',
            description: 'Academic credential issued by Acredia Academy to Alice Smith',
            name: 'Degree - Alice Smith',
        };

        await expect(generateCanonicalCredentialHash(reordered)).resolves.toBe(canonicalHashVector);
    });

    it('normalizes equivalent issue date representations in schema v1', async () => {
        const withIsoTimestamp = {
            ...metadata,
            credentialData: {
                ...metadata.credentialData,
                issueDate: '2026-05-31T00:00:00.000Z',
            },
        };

        const withDateObject = {
            ...metadata,
            credentialData: {
                ...metadata.credentialData,
                issueDate: new Date('2026-05-31T00:00:00.000Z'),
            },
        };

        await expect(generateCanonicalCredentialHash(withIsoTimestamp)).resolves.toBe(
            canonicalHashVector,
        );
        await expect(generateCanonicalCredentialHash(withDateObject)).resolves.toBe(
            canonicalHashVector,
        );
    });

    it('matches Node SHA-256 over the same canonical payload string', async () => {
        const payload = buildCanonicalCredentialPayloadV1(metadata);
        const serialized = canonicalJson(payload as any);
        const nodeHash = createHash('sha256').update(serialized).digest('hex');

        expect(serialized).toBe(canonicalVector);
        await expect(generateCanonicalCredentialHash(metadata)).resolves.toBe(nodeHash);
    });

    it('preserves legacy JSON.stringify hashing for unstamped credentials', async () => {
        const legacyHash = createHash('sha256').update(JSON.stringify(metadata)).digest('hex');

        await expect(deriveCredentialHash(metadata, null, null)).resolves.toBe(legacyHash);
        await expect(
            deriveCredentialHash(
                metadata,
                LEGACY_CREDENTIAL_METADATA_SCHEMA_VERSION,
                LEGACY_CREDENTIAL_HASH_ALGORITHM,
            ),
        ).resolves.toBe(legacyHash);
    });

    it('rejects unsupported stamped hash schemas instead of guessing', async () => {
        await expect(deriveCredentialHash(metadata, 99, CREDENTIAL_HASH_ALGORITHM)).rejects.toThrow(
            /Unsupported credential metadata hash schema/,
        );
    });
});
