import { describe, expect, it } from 'vitest';
import { extractTokenFromQrPayload } from '../src/lib/verification';

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
