export const DEFAULT_AUTH_REDIRECT = '/dashboard';

export type PasswordRequirement = {
    id: string;
    label: string;
    isMet: boolean;
};

export type RegisterValidationInput = {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
};

export function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

export function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

export function getPasswordRequirements(password: string): PasswordRequirement[] {
    return [
        {
            id: 'length',
            label: 'At least 8 characters',
            isMet: password.length >= 8,
        },
        {
            id: 'uppercase',
            label: 'One uppercase letter',
            isMet: /[A-Z]/.test(password),
        },
        {
            id: 'lowercase',
            label: 'One lowercase letter',
            isMet: /[a-z]/.test(password),
        },
        {
            id: 'number',
            label: 'One number',
            isMet: /\d/.test(password),
        },
    ];
}

export function getPasswordValidationError(password: string) {
    const missingRequirement = getPasswordRequirements(password).find(
        (requirement) => !requirement.isMet
    );

    return missingRequirement ? `Password must include ${missingRequirement.label.toLowerCase()}.` : '';
}

export function validateRegistrationInput(input: RegisterValidationInput) {
    if (!input.name.trim()) {
        return 'Please enter your name.';
    }

    if (!isValidEmail(input.email)) {
        return 'Please enter a valid email address.';
    }

    const passwordError = getPasswordValidationError(input.password);
    if (passwordError) {
        return passwordError;
    }

    if (input.password !== input.confirmPassword) {
        return 'Passwords do not match.';
    }

    return '';
}

export function isEmailConfirmationError(message: string) {
    const normalizedMessage = message.toLowerCase();
    return (
        normalizedMessage.includes('email not confirmed') ||
        normalizedMessage.includes('confirm your email') ||
        normalizedMessage.includes('email confirmation')
    );
}

export function getErrorMessage(error: unknown, fallbackMessage: string) {
    return error instanceof Error ? error.message : fallbackMessage;
}

export function sanitizeAuthRedirect(next: string | null | undefined) {
    if (!next) {
        return DEFAULT_AUTH_REDIRECT;
    }

    let decodedNext = next.trim();

    try {
        decodedNext = decodeURIComponent(decodedNext).trim();
    } catch {
        return DEFAULT_AUTH_REDIRECT;
    }

    if (
        !decodedNext.startsWith('/') ||
        decodedNext.startsWith('//') ||
        decodedNext.startsWith('/auth/login') ||
        decodedNext.startsWith('/auth/register') ||
        decodedNext.startsWith('/auth/forgot-password') ||
        decodedNext.startsWith('/auth/reset-password')
    ) {
        return DEFAULT_AUTH_REDIRECT;
    }

    return decodedNext;
}

export function buildAuthRedirect(pathname: string, search = '') {
    const intendedPath = `${pathname}${search}`;
    return `/auth/login?next=${encodeURIComponent(intendedPath)}`;
}

export function buildAuthCallbackUrl(path: string, next?: string | null) {
    if (typeof window === 'undefined') {
        return undefined;
    }

    const url = new URL(path, window.location.origin);
    const safeNext = sanitizeAuthRedirect(next);

    if (safeNext !== DEFAULT_AUTH_REDIRECT) {
        url.searchParams.set('next', safeNext);
    }

    return url.toString();
}
