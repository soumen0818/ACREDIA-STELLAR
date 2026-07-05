import { describe, expect, it } from 'vitest';
import {
    validateCredentialDraft,
    type CredentialValidationInput,
} from '../src/lib/credentialValidation';

const validDraft: CredentialValidationInput = {
    studentName: 'John Doe',
    studentWallet: 'GAMHNZ6QDGUP5ONSGJOP5BLYLZFISEA4JZWUGXNHPHIAPEYNZBKTTLV',
    credentialType: 'diploma',
    degree: 'Bachelor of Science',
    gpa: '3.8',
    issueDate: '2025-01-01',
    subjects: [
        {
            name: 'Mathematics',
            marks: '85',
            maxMarks: '100',
            grade: 'A',
        },
    ],
    file: {
        type: 'application/pdf',
        size: 1024,
    },
};

describe('credential validation', () => {
    it('accepts a complete valid draft', () => {
        expect(validateCredentialDraft(validDraft)).toEqual([]);
    });

    it('reports required fields and invalid wallet addresses', () => {
        const errors = validateCredentialDraft({
            ...validDraft,
            studentName: '',
            studentWallet: 'bad-wallet',
            degree: '',
            file: null,
        });

        expect(errors).toContain('Please enter student name');
        expect(errors).toContain('Please enter a valid student wallet address');
        expect(errors).toContain('Please enter degree name');
        expect(errors).toContain('Please select a file to upload');
    });

    it('rejects invalid marks and grades', () => {
        const errors = validateCredentialDraft({
            ...validDraft,
            subjects: [
                {
                    name: 'Science',
                    marks: '120',
                    maxMarks: '100',
                    grade: 'A@',
                },
            ],
        });

        expect(errors).toContain('Subject 1: marks obtained cannot exceed max marks');
        expect(errors).toContain('Subject 1: please enter a valid grade');
    });

    it('rejects invalid files and future dates', () => {
        const errors = validateCredentialDraft({
            ...validDraft,
            issueDate: '2999-01-01',
            file: {
                type: 'application/zip',
                size: 11 * 1024 * 1024,
            },
        });

        expect(errors).toContain('Issue date cannot be in the future');
        expect(errors).toContain('Invalid file type. Please upload PDF, JPG, or PNG files only.');
        expect(errors).toContain('File size must be less than 10MB.');
    });

    it('rejects impossible calendar dates', () => {
        const errors = validateCredentialDraft({
            ...validDraft,
            issueDate: '2025-02-31',
        });

        expect(errors).toContain('Please enter a valid issue date');
    });
});
