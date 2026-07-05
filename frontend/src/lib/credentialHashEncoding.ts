import { xdr } from '@stellar/stellar-sdk';

const SHA256_HEX_LENGTH = 64;

export function normalizeCredentialHashHex(hash: string): string {
    const normalized = hash.trim().toLowerCase();

    if (!/^[0-9a-f]+$/.test(normalized) || normalized.length !== SHA256_HEX_LENGTH) {
        throw new Error('Credential hash must be a 64-character SHA-256 hex digest');
    }

    return normalized;
}

export function credentialHashHexToBytes(hash: string): Uint8Array {
    const normalized = normalizeCredentialHashHex(hash);
    const bytes = new Uint8Array(32);

    for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
    }

    return bytes;
}

export function credentialHashHexToScVal(hash: string): xdr.ScVal {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return xdr.ScVal.scvBytes(credentialHashHexToBytes(hash) as any);
}

function bytesToHex(bytes: Uint8Array | number[]): string {
    if (bytes.length !== 32) {
        throw new Error('Credential hash bytes must be exactly 32 bytes');
    }

    return Array.from(bytes)
        .map((byte) => {
            if (!Number.isInteger(byte) || byte < 0 || byte > 255) {
                throw new Error('Credential hash contains an invalid byte');
            }

            return byte.toString(16).padStart(2, '0');
        })
        .join('');
}

export function credentialHashBytesToHex(value: unknown): string {
    if (typeof value === 'string') {
        return normalizeCredentialHashHex(value);
    }

    if (value instanceof Uint8Array) {
        return bytesToHex(value);
    }

    if (Array.isArray(value)) {
        return bytesToHex(value);
    }

    if (value && typeof value === 'object') {
        const maybeBuffer = value as { data?: unknown };
        if (Array.isArray(maybeBuffer.data)) {
            return bytesToHex(maybeBuffer.data);
        }
    }

    throw new Error('Unsupported on-chain credential hash encoding');
}
