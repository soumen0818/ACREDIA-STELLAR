import { serverRuntimeConfig } from './runtimeConfig';
import { captureException } from './debug';

const PINATA_API_BASE = 'https://api.pinata.cloud/pinning';
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_JSON_SIZE_BYTES = 1 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']);

function requirePinataJwt(): string {
    const jwt = serverRuntimeConfig.ipfs.jwt;

    if (!jwt) {
        throw new Error(
            'Missing server-only PINATA_JWT environment variable. Set PINATA_JWT before using IPFS uploads.',
        );
    }

    if (process.env.NODE_ENV === 'production' && !jwt) {
        throw new Error('PINATA_JWT is required in production for IPFS uploads.');
    }

    return jwt;
}

function parsePinataCid(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || !('IpfsHash' in payload)) {
        throw new Error('Unexpected Pinata response.');
    }

    const cid = (payload as { IpfsHash?: unknown }).IpfsHash;

    if (typeof cid !== 'string' || !cid.trim()) {
        throw new Error('Unexpected Pinata response.');
    }

    return cid.trim();
}

export function validatePinataFile(file: File): string | null {
    if (!ALLOWED_FILE_TYPES.has(file.type)) {
        return 'Invalid file type. Please upload PDF, JPG, or PNG files only.';
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        return 'File size must be less than 10MB.';
    }

    return null;
}

export function validatePinataJson(content: unknown): string | null {
    if (content === null || content === undefined) {
        return 'JSON payload cannot be empty.';
    }

    if (typeof content !== 'object' || Array.isArray(content)) {
        return 'JSON payload must be an object.';
    }

    const serialized = JSON.stringify(content);

    if (!serialized || serialized.length === 0) {
        return 'JSON payload cannot be empty.';
    }

    if (Buffer.byteLength(serialized, 'utf8') > MAX_JSON_SIZE_BYTES) {
        return 'JSON payload must be less than 1MB.';
    }

    return null;
}

export async function pinFileToPinata(file: File): Promise<string> {
    const jwt = requirePinataJwt();
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('pinataMetadata', JSON.stringify({ name: file.name }));
    formData.append('pinataOptions', JSON.stringify({ cidVersion: 1 }));

    const response = await fetch(`${PINATA_API_BASE}/pinFileToIPFS`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${jwt}`,
        },
        body: formData,
    });

    if (!response.ok) {
        const errorBody = await response.text();
        captureException(new Error(`Pinata file upload failed: ${response.status} ${errorBody}`), { context: 'pinFileToPinata' });
        throw new Error('Pinata file upload failed.');
    }

    return parsePinataCid(await response.json());
}

export async function pinJsonToPinata(content: unknown): Promise<string> {
    const jwt = requirePinataJwt();

    const response = await fetch(`${PINATA_API_BASE}/pinJSONToIPFS`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
            pinataMetadata: { name: 'credential-metadata.json' },
            pinataOptions: { cidVersion: 1 },
            pinataContent: content,
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        captureException(new Error(`Pinata JSON upload failed: ${response.status} ${errorBody}`), { context: 'pinJsonToPinata' });
        throw new Error('Pinata JSON upload failed.');
    }

    return parsePinataCid(await response.json());
}
