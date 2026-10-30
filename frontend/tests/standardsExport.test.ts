import { describe, expect, it } from 'vitest';
import { buildStandardsExportDocument, getLinkedInShareUrl } from '../src/lib/standardsExport';
import { buildAcrediaVerifiableCredential } from '../src/lib/verifiableCredential';
import { CREDENTIAL_METADATA_SCHEMA_VERSION_V2 } from '../src/lib/credentialHash';

describe('buildStandardsExportDocument', () => {
    const explorerBaseUrl = 'https://stellar.expert/explorer/testnet';

    it('re-serves the exact stored V2 metadata (byte-identical core) with a non-hashed on-chain anchor attached', async () => {
        const storedMetadata = buildAcrediaVerifiableCredential(
            {
                studentName: 'Ada Lovelace',
                studentWallet: 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD',
                degree: 'Bachelor of Science in Computer Science',
                issueDate: '2024-01-15',
                credentialType: 'diploma',
                institutionName: 'Acredia Academy',
                institutionWallet: 'GAcrediaIssuerWallet0000000000000000000000000000001',
            },
            explorerBaseUrl,
            { id: `urn:sha256:${'ab'.repeat(32)}`, description: 'SHA-256 of the source document.' },
        );

        const doc = await buildStandardsExportDocument({
            tokenId: '123',
            metadata: storedMetadata,
            metadataSchemaVersion: CREDENTIAL_METADATA_SCHEMA_VERSION_V2,
            hashAlgorithm: 'sha256:canonical-json:v2',
            blockchainHash: 'e2e-tx-hash-123',
        });

        // The core VC fields are exactly what was stored/hashed — not a rebuild.
        expect(doc.id).toBe(storedMetadata.id);
        expect(doc.issuer).toEqual(storedMetadata.issuer);
        expect(doc.credentialSubject).toEqual(storedMetadata.credentialSubject);

        expect(doc.onChainAnchor.tokenId).toBe('123');
        expect(doc.onChainAnchor.transactionHash).toBe('e2e-tx-hash-123');
        expect(doc.onChainAnchor.hashCoversThisDocument).toBe(true);
        expect(doc.onChainAnchor.credentialHash).toMatch(/^[0-9a-f]{64}$/);
        expect(doc.credentialStatus.type).toBe('StellarSorobanRevocationStatus2024');
    });

    it('reconstructs a best-effort VC for legacy/curated rows and is honest that the hash does not cover it', async () => {
        const doc = await buildStandardsExportDocument({
            tokenId: '123',
            studentName: 'Ada Lovelace',
            studentWallet: 'GBSVJNVIAGQEAK3WAAVGXSMT7BMLI4SHAJWKKMRCMJIYG7XESR4ANDZD',
            institutionName: 'Acredia Academy',
            issuerWallet: 'GAcrediaIssuerWallet0000000000000000000000000000001',
            degree: 'Bachelor of Science in Computer Science',
            credentialType: 'diploma',
            issueDate: '2024-01-15',
            blockchainHash: 'e2e-tx-hash-123',
        });

        expect(doc.type).toContain('VerifiableCredential');
        expect(doc.type).toContain('OpenBadgeCredential');
        expect(doc.issuer.name).toBe('Acredia Academy');
        expect(doc.credentialSubject.achievement.name).toBe('Bachelor of Science in Computer Science');
        expect(doc.onChainAnchor.hashCoversThisDocument).toBe(false);
        // No proof is fabricated — a real cryptographic proof type would be
        // actively misleading here since no signature is actually verifiable.
        expect((doc as unknown as Record<string, unknown>).proof).toBeUndefined();
    });

    it('trusts a caller-supplied on-chain hash (e.g. from the public verify API) over recomputing one', async () => {
        const doc = await buildStandardsExportDocument({
            tokenId: '123',
            onChainHash: 'f'.repeat(64),
            hashAlgorithm: 'sha256:canonical-json:v2',
            degree: 'Bachelor of Science in Computer Science',
            institutionName: 'Acredia Academy',
        });

        expect(doc.onChainAnchor.credentialHash).toBe('f'.repeat(64));
    });

    it('links the export to the holder’s share page when the share token is known (review §3.11b)', async () => {
        const share = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
        const withShare = await buildStandardsExportDocument({ tokenId: '123', shareToken: share });
        const withoutShare = await buildStandardsExportDocument({ tokenId: '123' });

        expect(withShare.onChainAnchor.verifyUrl).toBe(`/credentials/${share}`);
        expect(withoutShare.onChainAnchor.verifyUrl).toBe('/verify?token=123');
    });

    it('generates a properly formatted LinkedIn add certification URL', () => {
        const url = getLinkedInShareUrl({
            title: 'Bachelor of Science in Computer Science',
            institutionName: 'Acredia Academy',
            issueDate: '2024-01-15',
            tokenId: '123',
            certUrl: 'https://acredia.test/credentials/123',
        });

        expect(url).toContain('https://www.linkedin.com/profile/add?');
        expect(url).toContain('Bachelor+of+Science');
        expect(url).toContain('certId=123');
    });
});
