import { runtimeConfig } from './runtimeConfig';

export interface SecurityHeader {
    key: string;
    value: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Content Security Policy directives
// ──────────────────────────────────────────────────────────────────────────────
//
// Resolves Issue #91 — ensures the app ships with CSP, HSTS, X-Frame-Options,
// X-Content-Type-Options, Referrer-Policy, and Permissions-Policy for a
// wallet-connected credential app.
//
// Resolves Issue #236 — script-src uses a per-request nonce + 'strict-dynamic'
// instead of 'unsafe-inline'/'unsafe-eval'. The nonce is generated per request
// in src/middleware.ts (build-time next.config.ts headers() cannot produce a
// fresh nonce per request), so the CSP header itself is emitted by middleware,
// not by buildSecurityHeaders() below. 'unsafe-eval' is kept ONLY in
// development, because Next.js's dev-mode HMR/react-refresh runtime relies on
// eval(); it is never present in the production policy.
//
// When adding a new external integration (image CDN, API endpoint,
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
// style-src keeps 'unsafe-inline': Next.js and Tailwind emit inline `style`
// attributes/`<style>` tags that a nonce cannot easily cover without breaking
// styling. Per the issue's own remediation guidance, this is materially lower
// risk than 'unsafe-inline'/'unsafe-eval' on script-src (no code execution),
// so it is accepted rather than nonce'd.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * The deployment-specific origins the CSP must allow (review §3.7): the
 * Supabase project (database, auth, realtime, private document storage) and
 * the active network's Stellar endpoints. Only the configured network is
 * allowed, so a mainnet build never trusts testnet endpoints.
 */
export interface CspEndpoints {
    supabaseUrl: string;
    horizonUrl: string;
    sorobanRpcUrl: string;
}

function cspEndpointsFromConfig(): CspEndpoints {
    return {
        supabaseUrl: runtimeConfig.supabase.url,
        horizonUrl: runtimeConfig.stellar.horizonUrl,
        sorobanRpcUrl: runtimeConfig.stellar.sorobanRpcUrl,
    };
}

/** The origin of `url`, or null for an empty or malformed value. */
function originOf(url: string): string | null {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

export function buildCspDirectives(
    nonce: string,
    isProduction: boolean,
    endpoints: CspEndpoints = cspEndpointsFromConfig(),
): Record<string, string> {
    const supabase = originOf(endpoints.supabaseUrl);
    const connect = [
        "'self'",
        supabase,
        // Supabase Realtime.
        supabase?.replace(/^https:/, 'wss:'),
        originOf(endpoints.horizonUrl),
        originOf(endpoints.sorobanRpcUrl),
        'https://relay.walletconnect.com wss://relay.walletconnect.com',
        'https://relay.walletconnect.org wss://relay.walletconnect.org',
        'https://pulse.walletconnect.com https://explorer-api.walletconnect.com',
        'https://verify.walletconnect.com https://verify.walletconnect.org',
    ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

    return {
        'default-src': "'self'",
        'script-src':
            `'self' 'nonce-${nonce}' 'strict-dynamic'` + (isProduction ? '' : " 'unsafe-eval'"),
        'style-src': "'self' 'unsafe-inline'",
        // Wallet icons only. Credential documents open as blob: URLs after
        // the browser has checked their hash (review §3.11b).
        'img-src':
            "'self' data: blob: " +
            'https://stellar.creit.tech https://explorer-api.walletconnect.com ' +
            'https://walletconnect.org https://walletconnect.com https://uni.onekey-asset.com',
        'media-src': "'self'",
        'connect-src': connect.join(' '),
        // Albedo embeds its intent UI; WalletConnect verifies app origins.
        'frame-src':
            "'self' https://albedo.link https://verify.walletconnect.com https://verify.walletconnect.org",
        'frame-ancestors': "'none'",
        'form-action': "'self'",
        'base-uri': "'self'",
        'object-src': "'none'",
        'upgrade-insecure-requests': '',
    };
}

export function buildCspString(nonce: string, isProduction: boolean): string {
    return Object.entries(buildCspDirectives(nonce, isProduction))
        .map(([directive, value]) => (value ? `${directive} ${value}` : directive))
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

// Static (non-nonce) security headers, applied via next.config.ts headers().
// Content-Security-Policy is NOT included here: it needs a fresh per-request
// nonce and is applied by src/middleware.ts instead. See buildCspString above.
export function buildSecurityHeaders(isProduction: boolean): HeaderGroup[] {
    const headers: SecurityHeader[] = [
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
