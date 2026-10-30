import { z } from 'zod';

// ─── Legacy V1 (custom NFT-style) metadata schema ───────────────────────────
// No longer produced for new issuances (see verifiableCredential.ts / V2
// below), but kept so already-issued credentials with this shape can still
// be parsed/validated (e.g. by tooling that reads historical `metadata` rows).

export const SubjectSchema = z.object({
    name: z.string().optional(),
    marks: z.string().optional(),
    maxMarks: z.string().optional(),
    grade: z.string().optional(),
});

export const CredentialDataSchema = z.object({
    studentName: z.string(),
    studentWallet: z.string(),
    credentialType: z.string(),
    degree: z.string().optional(),
    major: z.string().optional(),
    gpa: z.string().optional(),
    issueDate: z.string().optional(),
    institutionName: z.string(),
    subjects: z.array(SubjectSchema).optional(),
});

export const AttributeSchema = z.object({
    trait_type: z.string(),
    value: z.string(),
});

export const CredentialMetadataSchema = z.object({
    name: z.string(),
    description: z.string(),
    image: z.string().optional(),
    attributes: z.array(AttributeSchema).optional(),
    credentialData: CredentialDataSchema.optional(),
});

export type CredentialDataPayload = z.infer<typeof CredentialDataSchema>;
export type CredentialMetadataPayload = z.infer<typeof CredentialMetadataSchema>;

// ─── V2: W3C Verifiable Credential / Open Badges 3.0 metadata schema ────────
// This is the shape built by `buildAcrediaVerifiableCredential` in
// verifiableCredential.ts and produced for every new credential issuance.
// `credentialService.ts` validates the built document against this schema
// before it is hashed and anchored on-chain, so a malformed document never
// gets anchored.

const jsonLdContextEntrySchema = z.union([z.string(), z.record(z.string(), z.unknown())]);

export const AchievementResultSchema = z.object({
    type: z.array(z.string()).min(1),
    resultDescription: z.string(),
    value: z.string(),
});

export const AchievementSchema = z.object({
    id: z.string().min(1),
    type: z.array(z.string()).min(1),
    name: z.string().min(1),
    description: z.string(),
    achievementType: z.string().nullable(),
    criteria: z.object({ narrative: z.string() }),
});

export const AchievementSubjectSchema = z.object({
    id: z.string().min(1),
    type: z.array(z.string()).min(1),
    name: z.string().min(1),
    achievement: AchievementSchema,
    result: z.array(AchievementResultSchema),
});

export const IssuerProfileSchema = z.object({
    id: z.string().min(1),
    type: z.array(z.string()).min(1),
    name: z.string().min(1),
});

export const EvidenceSchema = z.object({
    id: z.string().min(1),
    type: z.array(z.string()).min(1),
    name: z.string(),
    description: z.string(),
});

export const LegacyCredentialDataExtensionSchema = z.object({
    studentName: z.string(),
    studentWallet: z.string(),
    degree: z.string(),
    major: z.string().optional(),
    gpa: z.string().optional(),
    issueDate: z.string(),
    institutionName: z.string(),
    credentialType: z.string(),
    subjects: z.array(SubjectSchema).optional(),
});

export const VerifiableCredentialSchema = z.object({
    '@context': z.array(jsonLdContextEntrySchema).min(2),
    id: z.string().min(1),
    type: z.array(z.string()).refine((types) => types.includes('VerifiableCredential'), {
        message: 'type must include "VerifiableCredential"',
    }),
    name: z.string().min(1),
    description: z.string(),
    image: z.string().nullable(),
    issuer: IssuerProfileSchema,
    issuanceDate: z.string().min(1),
    credentialSubject: AchievementSubjectSchema,
    evidence: z.array(EvidenceSchema),
    credentialData: LegacyCredentialDataExtensionSchema,
});

export type VerifiableCredentialPayload = z.infer<typeof VerifiableCredentialSchema>;

export function validateVerifiableCredential(document: unknown): VerifiableCredentialPayload {
    return VerifiableCredentialSchema.parse(document);
}
