export const LEGACY_CREDENTIAL_METADATA_SCHEMA_VERSION = 0;
export const CREDENTIAL_METADATA_SCHEMA_VERSION = 1;
export const CREDENTIAL_HASH_ALGORITHM = 'sha256:canonical-json:v1';
export const LEGACY_CREDENTIAL_HASH_ALGORITHM = 'sha256:json-stringify';

export type CredentialMetadataSchemaVersion =
    | typeof LEGACY_CREDENTIAL_METADATA_SCHEMA_VERSION
    | typeof CREDENTIAL_METADATA_SCHEMA_VERSION;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export interface CanonicalCredentialPayloadV1 {
    schemaVersion: typeof CREDENTIAL_METADATA_SCHEMA_VERSION;
    name: string;
    description: string;
    image: string;
    credentialData: {
        studentName: string;
        studentWallet: string;
        degree: string;
        major: string | null;
        gpa: string | null;
        issueDate: string;
        institutionName: string;
        credentialType: string;
        subjects: Array<{
            id: string;
            name: string;
            marks: string;
            maxMarks: string;
            grade: string | null;
        }>;
    };
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
}

function requiredString(value: unknown): string {
    return value == null ? '' : String(value);
}

function optionalString(value: unknown): string | null {
    if (value == null || value === '') {
        return null;
    }

    return String(value);
}

function requiredDateString(value: unknown): string {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString().slice(0, 10);
    }

    const text = requiredString(value);
    const isoDate = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(text);

    return isoDate ? isoDate[1] : text;
}

export function buildCanonicalCredentialPayloadV1(metadata: unknown): CanonicalCredentialPayloadV1 {
    const root = asRecord(metadata);
    const credentialData = asRecord(root.credentialData);
    const subjects = Array.isArray(credentialData.subjects) ? credentialData.subjects : [];

    return {
        schemaVersion: CREDENTIAL_METADATA_SCHEMA_VERSION,
        name: requiredString(root.name),
        description: requiredString(root.description),
        image: requiredString(root.image),
        credentialData: {
            studentName: requiredString(credentialData.studentName),
            studentWallet: requiredString(credentialData.studentWallet),
            degree: requiredString(credentialData.degree),
            major: optionalString(credentialData.major),
            gpa: optionalString(credentialData.gpa),
            issueDate: requiredDateString(credentialData.issueDate),
            institutionName: requiredString(credentialData.institutionName),
            credentialType: requiredString(credentialData.credentialType),
            subjects: subjects.map((subject) => {
                const item = asRecord(subject);

                return {
                    id: requiredString(item.id),
                    name: requiredString(item.name),
                    marks: requiredString(item.marks),
                    maxMarks: requiredString(item.maxMarks),
                    grade: optionalString(item.grade),
                };
            }),
        },
    };
}

export function canonicalJson(value: JsonValue): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    }

    return `{${Object.keys(value)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
        .join(',')}}`;
}

async function sha256Hex(value: string): Promise<string> {
    if (!globalThis.crypto?.subtle) {
        throw new Error('Web Crypto SHA-256 is unavailable in this environment');
    }

    const encoded = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);

    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export function serializeCredentialMetadataForHash(
    metadata: unknown,
    schemaVersion: number | null | undefined = CREDENTIAL_METADATA_SCHEMA_VERSION,
): string {
    if (schemaVersion === CREDENTIAL_METADATA_SCHEMA_VERSION) {
        return canonicalJson(buildCanonicalCredentialPayloadV1(metadata) as unknown as JsonValue);
    }

    if (
        schemaVersion === LEGACY_CREDENTIAL_METADATA_SCHEMA_VERSION ||
        schemaVersion === null ||
        schemaVersion === undefined
    ) {
        return JSON.stringify(metadata);
    }

    throw new Error(`Unsupported credential metadata schema version: ${schemaVersion}`);
}

export async function generateCanonicalCredentialHash(metadata: unknown): Promise<string> {
    return sha256Hex(
        serializeCredentialMetadataForHash(metadata, CREDENTIAL_METADATA_SCHEMA_VERSION),
    );
}

export async function deriveCredentialHash(
    metadata: unknown,
    schemaVersion?: number | null,
    hashAlgorithm?: string | null,
): Promise<string> {
    if (
        schemaVersion === CREDENTIAL_METADATA_SCHEMA_VERSION &&
        hashAlgorithm === CREDENTIAL_HASH_ALGORITHM
    ) {
        return generateCanonicalCredentialHash(metadata);
    }

    if (
        (schemaVersion === LEGACY_CREDENTIAL_METADATA_SCHEMA_VERSION ||
            schemaVersion === null ||
            schemaVersion === undefined) &&
        (!hashAlgorithm || hashAlgorithm === LEGACY_CREDENTIAL_HASH_ALGORITHM)
    ) {
        return sha256Hex(JSON.stringify(metadata));
    }

    throw new Error(
        `Unsupported credential metadata hash schema: ${schemaVersion ?? 'legacy'} / ${hashAlgorithm ?? 'unknown'}`,
    );
}
