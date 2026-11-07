# 0007 — A CSP nonce on every page, so every page renders per request

**Status:** Accepted
**Date:** 2026-11-07
**Issues:** [#236](https://github.com/soumen0818/ACREDIA-STELLAR/issues/236) (nonce-based `script-src`); codebase review 2026-10-29 §4.2

## Context

Since #236 the Content Security Policy allows scripts only from our own origin
or carrying the request's nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`,
with no `'unsafe-inline'`. `src/proxy.ts` generates a fresh nonce per request,
and Next.js adds it to the scripts it renders.

A nonce only exists per request, so every page must be rendered per request.
The root layout calls `headers()` for that. The cost: no page can be served
from the CDN as static HTML, so every visit, including to the marketing pages,
is a function call.

The review proposed the alternative (§4.2, Option A): make the marketing pages
static, with a hash-based CSP and no nonce, "because they have no inline
scripts once the wallet code is gone". Measured on the production build after
the Phase 1 work (2026-11-07), that premise does not hold:

- Every page, `/legal/privacy` included, has **3 inline scripts**: Next.js's
  Turbopack bootstrap and the page's React Server Components payload. Their
  content differs per page and per build. Without a nonce or a hash for each,
  the policy blocks them and the page never hydrates.
- Rendering a marketing page takes about **10 ms** (median of 10 warm requests
  against `next start`). Per-request rendering costs a function invocation,
  not rendering time.

## Decision

**Keep the nonce on every page (the review's Option B).** Every page stays
rendered per request under the strict policy.

Alongside it:

- `middleware.ts` is now `proxy.ts`, the Next.js 16 convention, which runs on
  the Node.js runtime instead of the deprecated Edge runtime.
- The proxy skips `next/link` prefetches (`next-router-prefetch` or
  `purpose: prefetch` headers), as the Next.js CSP guide advises. They return
  route data, not a document, so there is no script for a nonce to cover.
- The root layout stays minimal: since the Phase 1 work it mounts no providers
  and ships no wallet or Supabase code (review §4.1).

## Alternatives considered

- **Static marketing pages with `'unsafe-inline'`.** CDN-cached, but any
  injected inline script would run on the public pages. Every new page would
  also have to land in the right group, or it would break (a static page under
  the nonce policy) or be weakened (a dynamic page under the relaxed one).
  Rejected: it gives back the protection #236 added, for about one function
  call per visit.
- **Static marketing pages with build-time hashes.** Keeps a strict policy:
  hash each static page's inline scripts after the build, and have the proxy
  send those hashes. Rejected for now: it depends on how Next.js emits inline
  scripts (internal, and changes between versions), and a stale or missing
  hash blocks the page's scripts.
- **Subresource Integrity (`experimental.sri`).** Experimental, and it adds
  `integrity` to script *files*. It does not cover the inline scripts above.

Revisit if Next.js ships a stable way to prerender pages under a strict CSP
(SRI or Partial Prerendering that covers inline scripts), or if marketing
traffic makes the function calls a real cost.

## Consequences

- Marketing HTML is not cached at the CDN; first visits pay a function call
  (and a cold start when the function is idle). Static assets (`/_next/static`,
  images) are still cached.
- Keep the Vercel function region close to the Supabase project. Pages do not
  query Supabase, but API routes do.
- **A prerendered page breaks in production only.** The dev server renders
  everything per request, so it cannot show the failure. CI therefore runs
  `scripts/check-dynamic-pages.mjs` after `next build`. It fails if any page
  appears in `.next/prerender-manifest.json`, for example after removing
  `headers()` from the root layout or adding `export const dynamic =
  'force-static'`.
- Tests:
  - `tests/proxy.test.ts`: fresh nonce, request ID, and matcher.
  - `tests/security-headers.test.ts`: the policy itself.
  - `tests/playwright/cspNonce.spec.ts`: every script in the server HTML carries
    the response's nonce, and pages, consoles and a prefetched navigation run
    with no CSP violations.
  - `tests/checkDynamicPages.test.ts`: the build check.

### Known gaps (follow-ups)

- `/_global-error`, Next.js's page for a crash in the root layout itself, is
  always prerendered. If it is ever served, its text shows but its "Try again"
  button cannot run under the policy. The build check accepts it by name.
- The share page's Open Graph image (`app/credentials/[token]/opengraph-image.tsx`)
  still declares the Edge runtime, which Next.js 16 deprecates. It is reworked
  with the share page's server loader (review §5.6 #1).
