import { z } from 'zod';

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
