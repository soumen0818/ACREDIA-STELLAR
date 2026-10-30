import { describe, expect, it } from 'vitest';
import { extractTokenFromQrPayload, parseVerificationInput } from '../src/lib/verification';

describe('verification QR payload parsing', () => {
    it('extracts token IDs from full verification URLs', () => {
        expect(
            extractTokenFromQrPayload('https://acredia.example/verify?token=credential-123'),
        ).toBe('credential-123');
        expect(extractTokenFromQrPayload('http://localhost:3000/verify?token=42&source=qr')).toBe(
            '42',
        );
    });

    it('accepts raw token IDs from QR payloads', () => {
        expect(extractTokenFromQrPayload('  token_ABC-123:stellar.verify  ')).toBe(
            'token_ABC-123:stellar.verify',
        );
    });

    it('rejects unsupported QR payloads', () => {
        expect(extractTokenFromQrPayload('')).toBeNull();
        expect(extractTokenFromQrPayload('not a token with spaces')).toBeNull();
        expect(extractTokenFromQrPayload('https://acredia.example/verify')).toBeNull();
    });
});

describe('parseVerificationInput (review §3.11b)', () => {
    const SHARE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

    it('recognises a share link, on any host, as a share page', () => {
        expect(parseVerificationInput(`https://acredia-stellar.vercel.app/credentials/${SHARE}`)).toEqual({
            kind: 'share',
            shareToken: SHARE,
        });
        expect(parseVerificationInput(`http://localhost:3000/credentials/${SHARE.toUpperCase()}/`)).toEqual({
            kind: 'share',
            shareToken: SHARE,
        });
    });

    it('recognises a bare share token', () => {
        expect(parseVerificationInput(`  ${SHARE}  `)).toEqual({ kind: 'share', shareToken: SHARE });
    });

    it('reads token IDs from status links and bare values', () => {
        expect(parseVerificationInput('https://acredia.example/verify?token=42')).toEqual({
            kind: 'token',
            tokenId: '42',
        });
        expect(parseVerificationInput('42')).toEqual({ kind: 'token', tokenId: '42' });
    });

    it('reads an old token-ID showcase link as a status check, not a share link', () => {
        expect(parseVerificationInput('https://acredia.example/credentials/42')).toEqual({
            kind: 'token',
            tokenId: '42',
        });
    });

    it('rejects junk', () => {
        expect(parseVerificationInput('')).toBeNull();
        expect(parseVerificationInput('https://acredia.example/credentials/not-a-token')).toBeNull();
    });
});
