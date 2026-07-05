import { describe, expect, it } from 'vitest';
import {
    CSP_DIRECTIVES,
    buildCspString,
    buildPermissionsPolicy,
    buildSecurityHeaders,
} from '../src/lib/securityHeaders';

const REQUIRED_DIRECTIVES = [
    'default-src',
    'script-src',
    'style-src',
    'img-src',
    'media-src',
    'connect-src',
    'frame-ancestors',
    'form-action',
    'base-uri',
] as const;

const STELLAR_ENDPOINTS = [
    'horizon-testnet.stellar.org',
    'soroban-testnet.stellar.org',
    'horizon.stellar.org',
    'soroban-mainnet.stellar.org',
];

const IMAGE_DOMAINS = [
    'tse1.mm.bing.net',
    'tse3.mm.bing.net',
    'tse4.mm.bing.net',
    'www.scholarshipregion.com',
    'gateway.pinata.cloud',
    'ipfs.io',
    'res.cloudinary.com',
];

const IPFS_DOMAINS = [
    'gateway.pinata.cloud',
    'ipfs.io',
    '*.ipfs.dweb.link',
];

describe('CSP directives', () => {
    it('includes all required directives', () => {
        for (const directive of REQUIRED_DIRECTIVES) {
            expect(CSP_DIRECTIVES).toHaveProperty(directive);
        }
    });

    it('has no unknown directives (typo guard)', () => {
        const known = new Set(REQUIRED_DIRECTIVES);
        for (const key of Object.keys(CSP_DIRECTIVES)) {
            expect(known.has(key as typeof REQUIRED_DIRECTIVES[number])).toBe(true);
        }
    });

    it('uses single-quoted keywords correctly', () => {
        for (const value of Object.values(CSP_DIRECTIVES)) {
            for (const keyword of ['self', 'none', 'unsafe-inline', 'unsafe-eval']) {
                if (value.includes(keyword)) {
                    expect(value).toContain(`'${keyword}'`);
                }
            }
        }
    });
});

describe('script-src', () => {
    it('allows self, unsafe-eval, and unsafe-inline (practical baseline)', () => {
        const value = CSP_DIRECTIVES['script-src'];
        expect(value).toContain("'self'");
        expect(value).toContain("'unsafe-eval'");
        expect(value).toContain("'unsafe-inline'");
    });
});

describe('img-src', () => {
    it('allows self, data:, and blob:', () => {
        const value = CSP_DIRECTIVES['img-src'];
        expect(value).toContain("'self'");
        expect(value).toContain('data:');
        expect(value).toContain('blob:');
    });

    it('allows all known image CDNs', () => {
        const value = CSP_DIRECTIVES['img-src'];
        for (const domain of IMAGE_DOMAINS) {
            expect(value).toContain(domain);
        }
    });

    it('allows IPFS gateways', () => {
        const value = CSP_DIRECTIVES['img-src'];
        for (const domain of IPFS_DOMAINS) {
            expect(value).toContain(domain);
        }
    });
});

describe('media-src', () => {
    it('allows self and IPFS gateways', () => {
        const value = CSP_DIRECTIVES['media-src'];
        expect(value).toContain("'self'");
        for (const domain of IPFS_DOMAINS) {
            expect(value).toContain(domain);
        }
    });

    it('allows res.cloudinary.com for hero video', () => {
        expect(CSP_DIRECTIVES['media-src']).toContain('res.cloudinary.com');
    });
});

describe('connect-src', () => {
    it('allows self and Supabase', () => {
        const value = CSP_DIRECTIVES['connect-src'];
        expect(value).toContain("'self'");
        expect(value).toContain('*.supabase.co');
    });

    it('allows all Stellar endpoints', () => {
        const value = CSP_DIRECTIVES['connect-src'];
        for (const endpoint of STELLAR_ENDPOINTS) {
            expect(value).toContain(endpoint);
        }
    });

    it('allows IPFS gateways and Pinata API', () => {
        const value = CSP_DIRECTIVES['connect-src'];
        // *.ipfs.dweb.link is for media/img, not connect; only explicit gateway domains go here.
        for (const domain of ['gateway.pinata.cloud', 'ipfs.io', 'api.pinata.cloud']) {
            expect(value).toContain(domain);
        }
    });
});

describe('frame-ancestors', () => {
    it('blocks all framing', () => {
        expect(CSP_DIRECTIVES['frame-ancestors']).toBe("'none'");
    });
});

describe('form-action', () => {
    it('restricts to self', () => {
        expect(CSP_DIRECTIVES['form-action']).toBe("'self'");
    });
});

describe('base-uri', () => {
    it('restricts to self', () => {
        expect(CSP_DIRECTIVES['base-uri']).toBe("'self'");
    });
});

describe('buildCspString', () => {
    it('produces a valid CSP header string', () => {
        const csp = buildCspString();
        expect(csp).toBeTruthy();

        // Each directive should be separated by "; "
        const parts = csp.split('; ');
        expect(parts.length).toBe(Object.keys(CSP_DIRECTIVES).length);

        // Each part should be "directive value"
        for (const part of parts) {
            expect(part).toMatch(/^[a-z-]+ .+/);
        }
    });

    it('round-trips directives correctly', () => {
        const csp = buildCspString();
        const parts = csp.split('; ');
        for (const part of parts) {
            const [directive] = part.split(' ');
            expect(CSP_DIRECTIVES[directive]).toBe(part.slice(directive.length + 1));
        }
    });
});

describe('buildPermissionsPolicy', () => {
    it('allows camera and clipboard-write for self', () => {
        const policy = buildPermissionsPolicy();
        expect(policy).toContain('camera=(self)');
        expect(policy).toContain('clipboard-write=(self)');
    });

    it('disables microphone and geolocation', () => {
        const policy = buildPermissionsPolicy();
        expect(policy).toContain('microphone=()');
        expect(policy).toContain('geolocation=()');
    });

    it('is a comma-separated list', () => {
        const policy = buildPermissionsPolicy();
        expect(policy).toMatch(/^[a-z-]+=\([^)]*\)(, [a-z-]+=\([^)]*\))*$/);
    });
});

describe('buildSecurityHeaders', () => {
    it('includes all required headers in development', () => {
        const groups = buildSecurityHeaders(false);
        const headers = groups[0].headers;
        const keys = headers.map((h) => h.key);

        expect(keys).toContain('Content-Security-Policy');
        expect(keys).toContain('X-Frame-Options');
        expect(keys).toContain('X-Content-Type-Options');
        expect(keys).toContain('Referrer-Policy');
        expect(keys).toContain('Permissions-Policy');
    });

    it('excludes HSTS in development', () => {
        const groups = buildSecurityHeaders(false);
        const keys = groups[0].headers.map((h) => h.key);
        expect(keys).not.toContain('Strict-Transport-Security');
    });

    it('includes HSTS in production', () => {
        const groups = buildSecurityHeaders(true);
        const keys = groups[0].headers.map((h) => h.key);
        expect(keys).toContain('Strict-Transport-Security');
    });

    it('sets HSTS with secure values in production', () => {
        const groups = buildSecurityHeaders(true);
        const hsts = groups[0].headers.find(
            (h) => h.key === 'Strict-Transport-Security',
        );
        expect(hsts).toBeDefined();
        expect(hsts!.value).toMatch(/max-age=\d+/);
        expect(hsts!.value).toContain('includeSubDomains');
    });

    it('has X-Frame-Options set to DENY', () => {
        const groups = buildSecurityHeaders(false);
        const header = groups[0].headers.find((h) => h.key === 'X-Frame-Options');
        expect(header?.value).toBe('DENY');
    });

    it('has X-Content-Type-Options set to nosniff', () => {
        const groups = buildSecurityHeaders(false);
        const header = groups[0].headers.find(
            (h) => h.key === 'X-Content-Type-Options',
        );
        expect(header?.value).toBe('nosniff');
    });

    it('has Referrer-Policy set to strict-origin-when-cross-origin', () => {
        const groups = buildSecurityHeaders(false);
        const header = groups[0].headers.find((h) => h.key === 'Referrer-Policy');
        expect(header?.value).toBe('strict-origin-when-cross-origin');
    });

    it('has a single header group targeting all routes', () => {
        const groups = buildSecurityHeaders(false);
        expect(groups).toHaveLength(1);
        expect(groups[0].source).toBe('/(.*)');
    });
});
