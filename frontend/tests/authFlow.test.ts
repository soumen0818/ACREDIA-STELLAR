import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUTH_REDIRECT,
  buildAuthRedirect,
  getPasswordRequirements,
  isEmailConfirmationError,
  sanitizeAuthRedirect,
  validateRegistrationInput,
} from '../src/lib/authFlow';

describe('auth flow helpers', () => {
  it('keeps intended redirects internal and away from auth loops', () => {
    expect(sanitizeAuthRedirect('/dashboard?tab=credentials')).toBe('/dashboard?tab=credentials');
    expect(sanitizeAuthRedirect('https://evil.example')).toBe(DEFAULT_AUTH_REDIRECT);
    expect(sanitizeAuthRedirect('//evil.example')).toBe(DEFAULT_AUTH_REDIRECT);
    expect(sanitizeAuthRedirect('/auth/login?next=/dashboard')).toBe(DEFAULT_AUTH_REDIRECT);
    expect(buildAuthRedirect('/dashboard', '?tab=issued')).toBe(
      '/auth/login?next=%2Fdashboard%3Ftab%3Dissued'
    );
  });

  it('validates registration fields before Supabase signup', () => {
    const validInput = {
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'Credential1',
      confirmPassword: 'Credential1',
    };

    expect(validateRegistrationInput(validInput)).toBe('');
    expect(validateRegistrationInput({ ...validInput, name: '' })).toBe('Please enter your name.');
    expect(validateRegistrationInput({ ...validInput, email: 'ada' })).toBe(
      'Please enter a valid email address.'
    );
    expect(validateRegistrationInput({ ...validInput, password: 'credential1', confirmPassword: 'credential1' })).toBe(
      'Password must include one uppercase letter.'
    );
    expect(validateRegistrationInput({ ...validInput, confirmPassword: 'Credential2' })).toBe(
      'Passwords do not match.'
    );
  });

  it('reports password requirements for inline UI feedback', () => {
    expect(getPasswordRequirements('Credential1').every((requirement) => requirement.isMet)).toBe(true);
    expect(getPasswordRequirements('short').filter((requirement) => !requirement.isMet).map((requirement) => requirement.id)).toEqual([
      'length',
      'uppercase',
      'number',
    ]);
  });

  it('detects login errors that can be solved by email verification', () => {
    expect(isEmailConfirmationError('Email not confirmed')).toBe(true);
    expect(isEmailConfirmationError('Please confirm your email before signing in')).toBe(true);
    expect(isEmailConfirmationError('Invalid login credentials')).toBe(false);
  });
});
