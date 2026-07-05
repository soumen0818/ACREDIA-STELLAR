export interface SecurityHeader {
    key: string;
    value: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Content Security Policy directives
// ──────────────────────────────────────────────────────────────────────────────
//
// When adding a new external integration (image CDN, API endpoint, IPFS gateway,
// wallet provider, etc.):
//
// 1. Add the domain to the relevant directive below:
//    - img-src      → images loaded via <img>, <picture>, or Next.js <Image>
//    - media-src    → <video>, <audio>, <source>
//    - connect-src  → fetch(), XMLHttpRequest, WebSocket, Supabase, Stellar RPC
//    - script-src   → external scripts (avoid if possible; prefer bundled code)
//    - style-src    → external stylesheets (avoid if possible)
//    - font-src     → web fonts
//    - frame-src    → iframes, embeds
// 2. Also update `images.remotePatterns` in next.config.ts if Next.js <Image>
//    uses the new domain.
// 3. Run `npm test` to confirm the header definitions are valid.
// 4. Rebuild and verify with: curl -sI https://your-deployment.url | grep -i 'content-security-policy'
//
// To harden script-src with nonces in the future:
//   - Remove 'unsafe-inline' from script-src
//   - Generate a per-request nonce in middleware (src/middleware.ts)
//   - Pass the nonce to the layout via request headers or React context
//   - The nonce will appear in CSP as: script-src 'nonce-{random}' 'strict-dynamic'
// ──────────────────────────────────────────────────────────────────────────────

export const CSP_DIRECTIVES: Record<string, string> = {
    'default-src': "'self'",
    'script-src': "'self' 'unsafe-eval' 'unsafe-inline'",
    'style-src': "'self' 'unsafe-inline'",
    'img-src':
        "'self' data: blob: "
        + 'tse1.mm.bing.net tse3.mm.bing.net tse4.mm.bing.net '
        + 'www.scholarshipregion.com '
        + 'gateway.pinata.cloud ipfs.io *.ipfs.dweb.link res.cloudinary.com',
    'media-src': "'self' gateway.pinata.cloud ipfs.io *.ipfs.dweb.link res.cloudinary.com",
    'connect-src':
        "'self' "
        + '*.supabase.co '
        + 'https://horizon-testnet.stellar.org https://soroban-testnet.stellar.org '
        + 'https://horizon.stellar.org https://soroban-mainnet.stellar.org '
        + 'https://gateway.pinata.cloud https://ipfs.io https://api.pinata.cloud',
    'frame-ancestors': "'none'",
    'form-action': "'self'",
    'base-uri': "'self'",
};

export function buildCspString(): string {
    return Object.entries(CSP_DIRECTIVES)
        .map(([directive, value]) => `${directive} ${value}`)
        .join('; ');
}

export function buildPermissionsPolicy(): string {
    return [
        'camera=(self)',
        'clipboard-write=(self)',
        'display-capture=(self)',
        'microphone=()',
        'geolocation=()',
    ].join(', ');
}

export interface HeaderGroup {
    source: string;
    headers: SecurityHeader[];
}

export function buildSecurityHeaders(isProduction: boolean): HeaderGroup[] {
    const headers: SecurityHeader[] = [
        { key: 'Content-Security-Policy', value: buildCspString() },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: buildPermissionsPolicy() },
    ];

    if (isProduction) {
        headers.push({
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
        });
    }

    return [{ source: '/(.*)', headers }];
}
