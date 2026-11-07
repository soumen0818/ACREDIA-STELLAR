import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from '../src/proxy';

/**
 * src/proxy.ts gives every page a fresh CSP nonce and every request an ID
 * (docs/decisions/0007-csp-nonce-on-every-page.md). Next.js reads the nonce
 * from the CSP on the *request* and adds it to the scripts it renders, so the
 * policy must reach both the request and the response.
 */

function run(path = '/') {
    return proxy(new NextRequest(`https://acredia.test${path}`));
}

/** A request header the proxy forwards to rendering (NextResponse.next({ request })). */
function forwarded(response: Response, name: string): string | null {
    return response.headers.get(`x-middleware-request-${name}`);
}

function nonceIn(csp: string | null): string | undefined {
    return csp?.match(/'nonce-([^']+)'/)?.[1];
}

describe('proxy', () => {
    it('puts the same CSP, with its nonce, on the response and the forwarded request', () => {
        const response = run();
        const csp = response.headers.get('Content-Security-Policy');
        const nonce = nonceIn(csp);

        expect(nonce).toBeTruthy();
        expect(forwarded(response, 'content-security-policy')).toBe(csp);
        expect(forwarded(response, 'x-nonce')).toBe(nonce);
        expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    });

    it('generates an unpredictable nonce for every request', () => {
        const nonces = new Set(
            Array.from({ length: 50 }, () => nonceIn(run().headers.get('Content-Security-Policy'))),
        );
        expect(nonces.size).toBe(50);
        for (const nonce of nonces) {
            // A base64-encoded random UUID: 128 bits of randomness.
            expect(Buffer.from(nonce as string, 'base64').toString()).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
            );
        }
    });

    it('gives each request an ID, on the response and to the route', () => {
        const response = run('/api/verify/1');
        const id = response.headers.get('x-request-id');

        expect(id).toMatch(/^[0-9a-f-]{36}$/);
        expect(forwarded(response, 'x-request-id')).toBe(id);
        expect(run('/api/verify/1').headers.get('x-request-id')).not.toBe(id);
    });
});

describe('proxy matcher', () => {
    const matches = (url: string, headers?: Record<string, string>) =>
        unstable_doesMiddlewareMatch({ config, url, headers });

    it('runs for pages, including the static marketing pages, and for API routes', () => {
        for (const url of ['/', '/about', '/legal/privacy', '/verify', '/dashboard', '/admin/authorize', '/api/verify/1']) {
            expect(matches(url), url).toBe(true);
        }
    });

    it('skips build assets, the image optimizer and image files', () => {
        for (const url of ['/_next/static/chunks/main.js', '/_next/image?url=%2Flogo.png&w=64&q=75', '/favicon.ico', '/logo.png', '/auth-illustration.png']) {
            expect(matches(url), url).toBe(false);
        }
    });

    it('skips next/link prefetches, which return route data rather than a document', () => {
        expect(matches('/about', { 'next-router-prefetch': '1' })).toBe(false);
        expect(matches('/about', { purpose: 'prefetch' })).toBe(false);
        // A normal navigation to the same page still gets its nonce.
        expect(matches('/about', { rsc: '1' })).toBe(true);
    });
});
