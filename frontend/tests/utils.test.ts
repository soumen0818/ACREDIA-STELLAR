import { describe, it, expect } from 'vitest';
import { truncateAddress, isValidAddress, formatCredentialType } from '../src/lib/utils';

describe('Utility Functions Validation', () => {
    describe('isValidAddress', () => {
        it('returns true for a valid Stellar address', () => {
            // The implemented regex is /^G[A-Z2-7]{54}$/ (length 55)
            const address = 'GAMHNZ6QDGUP5ONSGJOP5BLYLZFISEA4JZWUGXNHPHIAPEYNZBKTTLV';
            expect(isValidAddress(address)).toBe(true);
        });

        it('returns false for an empty string', () => {
            expect(isValidAddress('')).toBe(false);
        });

        it('returns false for malformed data', () => {
            expect(isValidAddress('0xGBQW12341234123412341234')).toBe(false);
            expect(isValidAddress('GAMHNZ6QDGUP5ONS')).toBe(false); // too short
        });
    });

    describe('truncateAddress', () => {
        it('truncates a long stellar address', () => {
            const address = 'GAMHNZ6QDGUP5ONSGJOP5BLYLZFISEA4JZWUGXNHPHIAPEYNZBKTTLV6';
            expect(truncateAddress(address, 4)).toBe('GAMHNZ...TLV6');
        });

        it('handles empty strings gracefully', () => {
            expect(truncateAddress('')).toBe('');
        });
    });

    describe('formatCredentialType', () => {
        it('formats snake_case strings nicely', () => {
            expect(formatCredentialType('bachelor_degree')).toBe('Bachelor Degree');
            expect(formatCredentialType('certificate_of_completion')).toBe(
                'Certificate Of Completion',
            );
        });

        it('handles single words', () => {
            expect(formatCredentialType('diploma')).toBe('Diploma');
        });
    });
});
