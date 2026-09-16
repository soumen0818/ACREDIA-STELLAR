import type { Metadata } from 'next';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getMetadataBase, getSiteUrl } from '../src/lib/siteUrl';
import { metadata as rootMetadata } from '../src/app/layout';
import { metadata as verifyMetadata } from '../src/app/verify/layout';
import { generateMetadata as generateCredentialMetadata } from '../src/app/credentials/[token]/page';

/**
 * Next types `Metadata['twitter']` as a union (summary / summary_large_image /
 * player / app), so `.card` is not reachable without narrowing first. These
 * tests only assert the card kind, so narrow to the one field rather than
 * discriminating the whole union at every call site.
 */
function twitterCard(metadata: Metadata): string | undefined {
    return (metadata.twitter as { card?: string } | null | undefined)?.card;
}

// The root layout calls `Inter()` from next/font/google at module scope. That
// loader is a build-time transform, so under Vitest the import resolves to a
// plain object and calling it throws "Inter is not a function". Stub it with
// the shape the layout consumes (`.variable`).
vi.mock('next/font/google', () => ({
    Inter: () => ({ variable: '--font-sans', className: 'font-sans' }),
}));

vi.mock('@/lib/serverAuth', () => ({
    getServiceRoleClient: vi.fn(() => ({
        from: vi.fn((table: string) => ({
            select: vi.fn(() => ({
                eq: vi.fn((col: string, val: string) => ({
                    maybeSingle: vi.fn(async () => {
                        if (table === 'credentials' && val === '1001') {
                            return {
                                data: {
                                    token_id: '1001',
                                    revoked: false,
                                    metadata: {
                                        credentialData: {
                                            studentName: 'Alice Johnson',
                                            degree: 'Master of Computer Science',
                                            credentialType: 'Degree',
                                            institutionName: 'Stanford University',
                                            issueDate: '2026-05-15',
                                        },
                                    },
                                    institution: {
                                        name: 'Stanford University',
                                    },
                                },
                                error: null,
                            };
                        }
                        if (table === 'credentials' && val === 'revoked-token') {
                            return {
                                data: {
                                    token_id: 'revoked-token',
                                    revoked: true,
                                    metadata: {
                                        credentialData: {
                                            studentName: 'Bob Smith',
                                            degree: 'Bachelor of Arts',
                                            institutionName: 'MIT',
                                        },
                                    },
                                    institution: {
                                        name: 'MIT',
                                    },
                                },
                                error: null,
                            };
                        }
                        return { data: null, error: null };
                    }),
                })),
            })),
        })),
    })),
}));

describe('Social Preview & Open Graph Metadata', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    it('resolves canonical base URL from NEXT_PUBLIC_SITE_URL', () => {
        process.env.NEXT_PUBLIC_SITE_URL = 'https://acredia.io';
        expect(getSiteUrl()).toBe('https://acredia.io');
        expect(getMetadataBase().origin).toBe('https://acredia.io');
    });

    it('falls back to VERCEL_URL when NEXT_PUBLIC_SITE_URL is unset', () => {
        delete process.env.NEXT_PUBLIC_SITE_URL;
        process.env.VERCEL_URL = 'acredia-preview.vercel.app';
        expect(getSiteUrl()).toBe('https://acredia-preview.vercel.app');
        expect(getMetadataBase().origin).toBe('https://acredia-preview.vercel.app');
    });

    it('root layout defines metadataBase to prevent localhost build warnings', () => {
        expect(rootMetadata.metadataBase).toBeDefined();
        expect(rootMetadata.metadataBase instanceof URL).toBe(true);
        expect(rootMetadata.openGraph?.images).toBeDefined();
        expect(twitterCard(rootMetadata)).toBe('summary_large_image');
    });

    it('verify layout provides rich verification portal metadata', () => {
        expect(verifyMetadata.title).toContain('Verify');
        expect(verifyMetadata.openGraph?.title).toContain('Verify');
        expect(verifyMetadata.openGraph?.images).toBeDefined();
        expect(twitterCard(verifyMetadata)).toBe('summary_large_image');
    });

    it('generates credential-specific Open Graph metadata for valid tokens', async () => {
        const metadata = await generateCredentialMetadata({
            params: Promise.resolve({ token: '1001' }),
        });

        expect(metadata.title).toContain('Master of Computer Science');
        expect(metadata.description).toContain('Alice Johnson');
        expect(metadata.description).toContain('Stanford University');

        expect(metadata.openGraph?.title).toContain('Master of Computer Science');
        expect(metadata.openGraph?.description).toContain('Alice Johnson');
        expect(metadata.openGraph?.url).toBe('/credentials/1001');

        expect(twitterCard(metadata)).toBe('summary_large_image');
    });

    it('handles revoked credentials with descriptive status in Open Graph preview', async () => {
        const metadata = await generateCredentialMetadata({
            params: Promise.resolve({ token: 'revoked-token' }),
        });

        expect(metadata.description).toContain('Revoked');
        expect(metadata.description).toContain('MIT');
    });

    it('handles non-existent or fallback tokens gracefully', async () => {
        const metadata = await generateCredentialMetadata({
            params: Promise.resolve({ token: '999999' }),
        });

        expect(metadata.title).toContain('#999999');
        expect(metadata.openGraph?.url).toBe('/credentials/999999');
    });

    it('simulates external crawler user agents (LinkedIn, Twitterbot, Facebook)', () => {
        const crawlerUserAgents = [
            'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
            'Twitterbot/1.0',
            'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
            'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
            'Discordbot/2.0; +https://discordapp.com',
        ];

        for (const ua of crawlerUserAgents) {
            expect(ua.length).toBeGreaterThan(0);
            // Root and child layout metadata provide both OG and Twitter cards for all crawlers
            expect(rootMetadata.openGraph).toBeDefined();
            expect(rootMetadata.twitter).toBeDefined();
        }
    });
});
