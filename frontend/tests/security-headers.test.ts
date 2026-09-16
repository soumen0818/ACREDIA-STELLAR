import { describe, expect, it } from 'vitest';
import {
    buildCspDirectives,
    buildCspString,
    buildPermissionsPolicy,
    buildSecurityHeaders,
} from '../src/lib/securityHeaders';

const NONCE = 'test-nonce-value';

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
    'object-src',
    'upgrade-insecure-requests',
] as const;

const STELLAR_ENDPOINTS = [
    'horizon-testnet.stellar.org',
    'soroban-testnet.stellar.org',
    'horizon.stellar.org',
    'mainnet.sorobanrpc.com',
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
        const directives = buildCspDirectives(NONCE, true);
        for (const directive of REQUIRED_DIRECTIVES) {
            expect(directives).toHaveProperty(directive);
        }
    });

    it('has no unknown directives (typo guard)', () => {
        const directives = buildCspDirectives(NONCE, true);
        const known = new Set(REQUIRED_DIRECTIVES);
        for (const key of Object.keys(directives)) {
            expect(known.has(key as typeof REQUIRED_DIRECTIVES[number])).toBe(true);
        }
    });

    it('uses single-quoted keywords correctly', () => {
        for (const value of Object.values(buildCspDirectives(NONCE, false))) {
            for (const keyword of ['self', 'none', 'unsafe-inline', 'unsafe-eval', 'strict-dynamic']) {
                if (value.includes(keyword)) {
                    expect(value).toContain(`'${keyword}'`);
                }
            }
        }
    });
});

describe('script-src', () => {
    it('allows self, the request nonce, and strict-dynamic', () => {
        const value = buildCspDirectives(NONCE, true)['script-src'];
        expect(value).toContain("'self'");
        expect(value).toContain(`'nonce-${NONCE}'`);
        expect(value).toContain("'strict-dynamic'");
    });

    it('never contains unsafe-inline', () => {
        expect(buildCspDirectives(NONCE, true)['script-src']).not.toContain('unsafe-inline');
        expect(buildCspDirectives(NONCE, false)['script-src']).not.toContain('unsafe-inline');
    });

    it('excludes unsafe-eval in production', () => {
        expect(buildCspDirectives(NONCE, true)['script-src']).not.toContain('unsafe-eval');
    });

    it('allows unsafe-eval only in development, for Next.js HMR', () => {
        expect(buildCspDirectives(NONCE, false)['script-src']).toContain("'unsafe-eval'");
    });

    it('changes the nonce per invocation', () => {
        const a = buildCspDirectives('nonce-a', true)['script-src'];
        const b = buildCspDirectives('nonce-b', true)['script-src'];
        expect(a).not.toBe(b);
    });
});

describe('object-src', () => {
    it('blocks plugin content entirely', () => {
        expect(buildCspDirectives(NONCE, true)['object-src']).toBe("'none'");
    });
});

describe('upgrade-insecure-requests', () => {
    it('is present as a valueless directive', () => {
        const directives = buildCspDirectives(NONCE, true);
        expect(directives).toHaveProperty('upgrade-insecure-requests');
        expect(directives['upgrade-insecure-requests']).toBe('');
    });

    it('renders without a trailing value in the header string', () => {
        const csp = buildCspString(NONCE, true);
        const parts = csp.split('; ');
        expect(parts).toContain('upgrade-insecure-requests');
    });
});

describe('img-src', () => {
    it('allows self, data:, and blob:', () => {
        const value = buildCspDirectives(NONCE, true)['img-src'];
        expect(value).toContain("'self'");
        expect(value).toContain('data:');
        expect(value).toContain('blob:');
    });

    it('allows all known image CDNs', () => {
        const value = buildCspDirectives(NONCE, true)['img-src'];
        for (const domain of IMAGE_DOMAINS) {
            expect(value).toContain(domain);
        }
    });

    it('allows IPFS gateways', () => {
        const value = buildCspDirectives(NONCE, true)['img-src'];
        for (const domain of IPFS_DOMAINS) {
            expect(value).toContain(domain);
        }
    });
});

describe('media-src', () => {
    it('allows self and IPFS gateways', () => {
        const value = buildCspDirectives(NONCE, true)['media-src'];
        expect(value).toContain("'self'");
        for (const domain of IPFS_DOMAINS) {
            expect(value).toContain(domain);
        }
    });

    it('allows res.cloudinary.com for hero video', () => {
        expect(buildCspDirectives(NONCE, true)['media-src']).toContain('res.cloudinary.com');
    });
});

describe('connect-src', () => {
    it('allows self and Supabase', () => {
        const value = buildCspDirectives(NONCE, true)['connect-src'];
        expect(value).toContain("'self'");
        expect(value).toContain('*.supabase.co');
    });

    it('allows all Stellar endpoints', () => {
        const value = buildCspDirectives(NONCE, true)['connect-src'];
        for (const endpoint of STELLAR_ENDPOINTS) {
            expect(value).toContain(endpoint);
        }
    });

    it('allows IPFS gateways and Pinata API', () => {
        const value = buildCspDirectives(NONCE, true)['connect-src'];
        // *.ipfs.dweb.link is for media/img, not connect; only explicit gateway domains go here.
        for (const domain of ['gateway.pinata.cloud', 'ipfs.io', 'api.pinata.cloud']) {
            expect(value).toContain(domain);
        }
    });
});

describe('frame-ancestors', () => {
    it('blocks all framing', () => {
        expect(buildCspDirectives(NONCE, true)['frame-ancestors']).toBe("'none'");
    });
});

describe('form-action', () => {
    it('restricts to self', () => {
        expect(buildCspDirectives(NONCE, true)['form-action']).toBe("'self'");
    });
});

describe('base-uri', () => {
    it('restricts to self', () => {
        expect(buildCspDirectives(NONCE, true)['base-uri']).toBe("'self'");
    });
});

describe('buildCspString', () => {
    it('produces a valid CSP header string', () => {
        const csp = buildCspString(NONCE, true);
        expect(csp).toBeTruthy();

        // Each directive should be separated by "; "
        const parts = csp.split('; ');
        expect(parts.length).toBe(Object.keys(buildCspDirectives(NONCE, true)).length);

        // Each part should start with a lowercase directive name.
        for (const part of parts) {
            expect(part).toMatch(/^[a-z-]+(?: .+)?$/);
        }
    });

    it('round-trips directives correctly', () => {
        const csp = buildCspString(NONCE, true);
        const directives = buildCspDirectives(NONCE, true);
        const parts = csp.split('; ');
        for (const part of parts) {
            const [directive, ...rest] = part.split(' ');
            expect(directives[directive]).toBe(rest.join(' '));
        }
    });

    it('embeds the given nonce', () => {
        expect(buildCspString('abc123', true)).toContain("'nonce-abc123'");
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
    it('includes all required static headers in development', () => {
        const groups = buildSecurityHeaders(false);
        const headers = groups[0].headers;
        const keys = headers.map((h) => h.key);

        expect(keys).toContain('X-Frame-Options');
        expect(keys).toContain('X-Content-Type-Options');
        expect(keys).toContain('Referrer-Policy');
        expect(keys).toContain('Permissions-Policy');
    });

    it('does not include Content-Security-Policy (set per-request by middleware instead)', () => {
        const groups = buildSecurityHeaders(false);
        const keys = groups[0].headers.map((h) => h.key);
        expect(keys).not.toContain('Content-Security-Policy');
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
