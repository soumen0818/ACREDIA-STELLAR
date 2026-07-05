import { isValidAddress as defaultIsValidAddress } from './utils';

export interface CredentialValidationSubject {
    name: string;
    marks: string;
    maxMarks: string;
    grade?: string;
}

export interface CredentialValidationFile {
    type: string;
    size: number;
}

export interface CredentialValidationInput {
    studentName: string;
    studentWallet: string;
    credentialType: string;
    degree: string;
    gpa?: string;
    issueDate: string;
    subjects: CredentialValidationSubject[];
    file: CredentialValidationFile | null;
}

const allowedFileTypes = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const maxFileSize = 10 * 1024 * 1024;
const gradePattern = /^[A-Za-z0-9+\-. ]+$/;

function parseIssueDate(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);

    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
        return null;
    }

    return date;
}

export function validateCredentialDraft(
    input: CredentialValidationInput,
    isWalletAddressValid = defaultIsValidAddress,
): string[] {
    const errors: string[] = [];

    if (!input.studentName.trim()) {
        errors.push('Please enter student name');
    }

    if (!input.studentWallet.trim() || !isWalletAddressValid(input.studentWallet.trim())) {
        errors.push('Please enter a valid student wallet address');
    }

    if (!input.credentialType.trim()) {
        errors.push('Please select credential type');
    }

    if (!input.degree.trim()) {
        errors.push('Please enter degree name');
    }

    const issueDate = parseIssueDate(input.issueDate);
    if (!issueDate) {
        errors.push('Please enter a valid issue date');
    } else if (issueDate > new Date()) {
        errors.push('Issue date cannot be in the future');
    }

    if (input.gpa?.trim()) {
        const gpa = Number(input.gpa);
        if (!Number.isFinite(gpa) || gpa < 0 || gpa > 10) {
            errors.push('Please enter a valid GPA');
        }
    }

    if (!input.file) {
        errors.push('Please select a file to upload');
    } else {
        if (!allowedFileTypes.includes(input.file.type)) {
            errors.push('Invalid file type. Please upload PDF, JPG, or PNG files only.');
        }

        if (input.file.size > maxFileSize) {
            errors.push('File size must be less than 10MB.');
        }
    }

    input.subjects.forEach((subject, index) => {
        const label = `Subject ${index + 1}`;
        const hasAnyValue =
            subject.name.trim() ||
            subject.marks.trim() ||
            subject.maxMarks.trim() ||
            subject.grade?.trim();

        if (!hasAnyValue) {
            return;
        }

        if (!subject.name.trim()) {
            errors.push(`${label}: please enter subject name`);
        }

        const marks = Number(subject.marks);
        const maxMarks = Number(subject.maxMarks);

        if (!Number.isFinite(marks) || marks < 0) {
            errors.push(`${label}: please enter valid marks obtained`);
        }

        if (!Number.isFinite(maxMarks) || maxMarks <= 0) {
            errors.push(`${label}: please enter valid max marks`);
        }

        if (Number.isFinite(marks) && Number.isFinite(maxMarks) && marks > maxMarks) {
            errors.push(`${label}: marks obtained cannot exceed max marks`);
        }

        if (
            subject.grade?.trim() &&
            (!gradePattern.test(subject.grade.trim()) || subject.grade.trim().length > 20)
        ) {
            errors.push(`${label}: please enter a valid grade`);
        }
    });

    return errors;
}
