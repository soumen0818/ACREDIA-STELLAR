import { describe, expect, it } from 'vitest';
import {
    credentialHashBytesToHex,
    credentialHashHexToBytes,
    credentialHashHexToScVal,
    normalizeCredentialHashHex,
} from '../src/lib/credentialHashEncoding';

const hash = 'FECA52DC50AEE21C1942333A13873250B5BDA373E09A4E2AFF29B80A44A78545';
const normalized = hash.toLowerCase();

describe('credential hash Stellar encoding', () => {
    it('normalizes SHA-256 hex digests for contract calls', () => {
        expect(normalizeCredentialHashHex(` ${hash} `)).toBe(normalized);
    });

    it('round-trips between hex and the 32-byte contract representation', () => {
        const bytes = credentialHashHexToBytes(hash);

        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes).toHaveLength(32);
        expect(credentialHashBytesToHex(bytes)).toBe(normalized);
    });

    it('builds a 32-byte ScVal for the Soroban ABI', () => {
        const scVal = credentialHashHexToScVal(hash);

        expect(scVal.switch().name).toBe('scvBytes');
        expect(scVal.bytes()).toHaveLength(32);
    });

    it('rejects non-SHA-256 hash values', () => {
        expect(() => normalizeCredentialHashHex('abc')).toThrow(/64-character/);
        expect(() => normalizeCredentialHashHex(`${normalized.slice(0, 63)}z`)).toThrow(
            /64-character/,
        );
    });
});
