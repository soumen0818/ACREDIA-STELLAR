import { describe, expect, it } from 'vitest';
import { normalizeOnChainCredential } from '../src/lib/contractReads';
import { credentialHashHexToBytes } from '../src/lib/credentialHashEncoding';

const hash = 'feca52dc50aee21c1942333a13873250b5bda373e09a4e2aff29b80a44a78545';

describe('contract read normalization', () => {
    it('maps the Rust credential struct field names into verification fields', () => {
        expect(
            normalizeOnChainCredential({
                token_id: BigInt(7),
                student: 'GSTUDENT',
                issuer: 'GISSUER',
                credential_hash: credentialHashHexToBytes(hash),
                ipfs_hash: 'ipfs://metadata-cid',
                issued_at: BigInt(1770000000),
                revoked: false,
            }),
        ).toEqual({
            token_id: BigInt(7),
            student: 'GSTUDENT',
            issuer: 'GISSUER',
            hash,
            uri: 'ipfs://metadata-cid',
            issued_at: BigInt(1770000000),
            revoked: false,
        });
    });

    it('keeps compatibility with existing mocked hash and uri aliases', () => {
        expect(
            normalizeOnChainCredential({
                student: 'GSTUDENT',
                issuer: 'GISSUER',
                hash,
                uri: 'ipfs://metadata-cid',
                issued_at: 1770000000,
            }),
        ).toMatchObject({
            hash,
            uri: 'ipfs://metadata-cid',
        });
    });
});
