import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

// Generate SHA-256 hash (browser-safe)
export function generateHash(data: string): string {
    // Use browser's SubtleCrypto API for hashing
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        return data; // Placeholder - implement async hash in component
    }
    return data;
}

// Format date
export function formatDate(date: string | Date): string {
    return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

// Truncate wallet address
export function truncateAddress(address: string, chars = 4): string {
    if (!address) return '';
    return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

// Generate unique ID
export function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Validate Stellar address
export function isValidAddress(address: string): boolean {
    return /^G[A-Z2-7]{54}$/.test(address);
}

// Convert file to base64
export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = (error) => reject(error);
    });
}

// Format credential type
export function formatCredentialType(type: string): string {
    return type
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

// Check if running in browser
export function isBrowser(): boolean {
    return typeof window !== 'undefined';
}
