import { describe, expect, it } from 'vitest';
import {
    attachOnChainAnchor,
    buildAcrediaVerifiableCredential,
    OBV3_CONTEXT,
    VC_CONTEXT_V1,
    type BuildVerifiableCredentialInput,
} from '../src/lib/verifiableCredential';
import { documentEvidenceId } from '../src/lib/credentialDocuments';
import { validateVerifiableCredential } from '../src/lib/schemas';
import { generateCanonicalCredentialHash } from '../src/lib/credentialHash';

const explorerBaseUrl = 'https://stellar.expert/explorer/testnet';

const baseInput: BuildVerifiableCredentialInput = {
    studentName: 'Ada Lovelace',
    studentWallet: 'GSTUDENTADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    degree: 'BSc Computer Science',
    major: 'Software Engineering',
    gpa: '3.9',
    issueDate: '2026-05-31',
    credentialType: 'degree',
    institutionName: 'Acredia Academy',
    institutionWallet: 'GISSUERADDRESSXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    subjects: [{ id: 'math-101', name: 'Mathematics', marks: '95', maxMarks: '100', grade: 'A' }],
};

const DOCUMENT_SHA256 = 'ab'.repeat(32);
const documentEvidence = {
    id: documentEvidenceId(DOCUMENT_SHA256),
    description: 'SHA-256 of the source document, held privately.',
};

describe('buildAcrediaVerifiableCredential', () => {
    it('produces a document that validates as a VerifiableCredential / OpenBadgeCredential', () => {
        const vc = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, documentEvidence);

        expect(() => validateVerifiableCredential(vc)).not.toThrow();
        expect(vc.type).toEqual(['VerifiableCredential', 'OpenBadgeCredential']);
        expect(vc['@context']).toContain(VC_CONTEXT_V1);
        expect(vc['@context']).toContain(OBV3_CONTEXT);
    });

    it('maps issuer, subject, achievement, issuance date, and evidence to standard VC/OBv3 fields', () => {
        const vc = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, documentEvidence);

        // issuer
        expect(vc.issuer.name).toBe('Acredia Academy');
        expect(vc.issuer.id).toBe(`${explorerBaseUrl}/account/${baseInput.institutionWallet}`);
        expect(vc.issuer.type).toContain('Profile');

        // subject
        expect(vc.credentialSubject.name).toBe('Ada Lovelace');
        expect(vc.credentialSubject.id).toBe(`${explorerBaseUrl}/account/${baseInput.studentWallet}`);
        expect(vc.credentialSubject.type).toContain('AchievementSubject');

        // achievement
        expect(vc.credentialSubject.achievement.name).toBe('BSc Computer Science');
        expect(vc.credentialSubject.achievement.achievementType).toBe('Degree');
        expect(vc.credentialSubject.achievement.type).toContain('Achievement');

        // issuance date: normalized to a full ISO 8601 datetime
        expect(vc.issuanceDate).toBe(new Date('2026-05-31').toISOString());

        // evidence
        expect(vc.evidence).toHaveLength(1);
        expect(vc.evidence[0].id).toBe(`urn:sha256:${DOCUMENT_SHA256}`);
        expect(vc.evidence[0].type).toContain('Evidence');
        // The document is private (review §3.11): never linked from the JSON.
        expect(vc.image).toBeNull();

        // GPA surfaced as a standard `result` entry
        expect(vc.credentialSubject.result).toEqual([
            { type: ['Result'], resultDescription: 'GPA', value: '3.9' },
        ]);
    });

    it('omits evidence when no source document was uploaded', () => {
        const vc = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, null);
        expect(vc.evidence).toEqual([]);
        expect(vc.image).toBeNull();
    });

    it('mints a fresh, unique id for every build', () => {
        const first = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, null);
        const second = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, null);
        expect(first.id).not.toBe(second.id);
        expect(first.id).toMatch(/^urn:uuid:/);
    });

    it('keeps the legacy credentialData extension for backward-compatible internal display', () => {
        const vc = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, null);
        expect(vc.credentialData).toEqual({
            studentName: 'Ada Lovelace',
            studentWallet: baseInput.studentWallet,
            degree: 'BSc Computer Science',
            major: 'Software Engineering',
            gpa: '3.9',
            issueDate: '2026-05-31',
            institutionName: 'Acredia Academy',
            credentialType: 'degree',
            subjects: baseInput.subjects,
        });
    });

    it('anchors the private document: a different document digest changes the on-chain hash', async () => {
        // Same credential, same everything, except the document's SHA-256.
        const original = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, documentEvidence);
        const swapped = {
            ...original,
            evidence: [{ ...original.evidence[0], id: documentEvidenceId('cd'.repeat(32)) }],
        };
        expect(await generateCanonicalCredentialHash(swapped)).not.toBe(
            await generateCanonicalCredentialHash(original),
        );
    });

    it('is hashable end-to-end via the canonical V2 hasher', async () => {
        const vc = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, documentEvidence);
        const hash = await generateCanonicalCredentialHash(vc);
        expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe('attachOnChainAnchor', () => {
    it('adds credentialStatus and onChainAnchor without mutating the original document', () => {
        const vc = buildAcrediaVerifiableCredential(baseInput, explorerBaseUrl, null);
        const anchored = attachOnChainAnchor(vc, {
            network: 'testnet',
            contractId: 'CCONTRACT',
            tokenId: '1',
            transactionHash: 'TXHASH',
            credentialHash: 'a'.repeat(64),
            hashAlgorithm: 'sha256:canonical-json:v2',
            canonicalizationAlgorithm: 'sha256:canonical-json',
            verifyUrl: 'https://acredia.app/verify?token=1',
            hashCoversThisDocument: true,
        });

        expect((vc as unknown as Record<string, unknown>).onChainAnchor).toBeUndefined();
        expect(anchored.onChainAnchor.tokenId).toBe('1');
        expect(anchored.credentialStatus.id).toBe('https://acredia.app/verify?token=1');
    });
});
