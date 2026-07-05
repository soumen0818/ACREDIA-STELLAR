import { describe, expect, it } from 'vitest';
import { validatePinataFile, validatePinataJson } from '../src/lib/ipfsServer';

describe('IPFS server validation', () => {
    it('accepts supported file types within the size limit', () => {
        const file = new File([new Uint8Array(1024)], 'credential.pdf', {
            type: 'application/pdf',
        });

        expect(validatePinataFile(file)).toBeNull();
    });

    it('rejects unsupported file types and oversize files', () => {
        const badType = new File([new Uint8Array(1024)], 'credential.txt', {
            type: 'text/plain',
        });
        const largeFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'credential.png', {
            type: 'image/png',
        });

        expect(validatePinataFile(badType)).toContain('Invalid file type');
        expect(validatePinataFile(largeFile)).toContain('less than 10MB');
    });

    it('accepts reasonable JSON payloads and rejects empty or huge payloads', () => {
        expect(validatePinataJson({ credential: 'ok' })).toBeNull();
        expect(validatePinataJson(null)).toContain('cannot be empty');
        expect(validatePinataJson('')).toContain('must be an object');
        expect(validatePinataJson([])).toContain('must be an object');

        const hugePayload = { data: 'x'.repeat(1024 * 1024) };
        expect(validatePinataJson(hugePayload)).toContain('less than 1MB');
    });
});
