# Embeddable "Verify with Acredia" widget

A drop-in button that lets visitors to your site — a careers page, an ATS, a
university portal — verify an Acredia credential without leaving your page.
It opens Acredia's public verification page in a popup.

> **Who this is for:** developers at employers, ATS vendors and universities
> embedding the widget on their own sites, and Acredia maintainers changing it.

- [Quick start](#quick-start)
- [`data-token`](#data-token)
- [Placement and sizing](#placement-and-sizing)
- [Theming](#theming)
- [What happens on click](#what-happens-on-click)
- [What data the widget sends — and doesn't](#what-data-the-widget-sends--and-doesnt)
- [Content Security Policy for your site](#content-security-policy-for-your-site)
- [Failure modes](#failure-modes)
- [Versioning and caching policy](#versioning-and-caching-policy)
- [For maintainers](#for-maintainers)

In every snippet below, `https://<acredia-host>` is the Acredia deployment you
verify against. For the live testnet deployment that is
`https://acredia-stellar.vercel.app`; its `/docs/api` page shows the
snippet with the host already filled in.

## Quick start

```html
<!-- 1. Where the button should appear -->
<div id="acredia-verify-widget" data-token="42"></div>

<!-- 2. Anywhere on the page -->
<script src="https://<acredia-host>/widget/v1.js" async></script>
```

That is the whole integration. The script needs no configuration, no API key
and no build step on your side.

- Load it with a plain `<script src>` tag pointing at the Acredia host — that is
  how the widget confirms which deployment it belongs to. `async`, `defer` or
  neither all work.
- Do **not** copy the file into your own bundle or CDN; see
  [Self-hosting and SRI](#self-hosting-and-subresource-integrity).

## `data-token`

| Attribute | Required | Meaning |
|---|---|---|
| `data-token` | No | The credential's token ID, as shown on the credential or its QR code. |

- **Present** — the button opens `https://<acredia-host>/verify?token=<token>`,
  which verifies that credential immediately.
- **Absent or empty** — the button opens `https://<acredia-host>/verify`, where
  the visitor enters a token ID or scans a QR code themselves.
- Surrounding whitespace is trimmed. The value is URL-encoded, so it can only
  ever become the `token` query parameter — it cannot change the host, path or
  any other part of the link. Validation of the token itself happens on the
  Acredia verification page.

## Placement and sizing

- One button per page, rendered inside the element with
  `id="acredia-verify-widget"`. The element must exist by the time the DOM is
  ready (`DOMContentLoaded`).
- The button is `inline-block`, sized by its content: about **38px tall and
  190px wide** at its default 14px font. It does not stretch to fill the
  container; size and position it by styling the container element.
- It renders inside a shadow root, so your page's CSS cannot restyle or break
  it — use the [theming hooks](#theming) instead.
- **Single-page apps:** if your framework mounts the container after page load,
  insert the `<script>` tag after the container is mounted (for example from a
  mount effect). Inserting it again for a new container renders a new button
  there; a container that already has a button is left alone.

## Theming

Set these CSS custom properties on the container (or any ancestor). Any you
leave unset keep Acredia's defaults, which match Acredia's own design system.

| Property | Default | Controls |
|---|---|---|
| `--acredia-widget-bg` | `#0a2540` | Background colour |
| `--acredia-widget-bg-hover` | `--acredia-widget-bg` mixed 15% toward white | Background on hover |
| `--acredia-widget-fg` | `#ffffff` | Text and icon colour |
| `--acredia-widget-radius` | `calc(0.75rem - 2px)` | Corner radius |
| `--acredia-widget-font` | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | Font family |

```css
#acredia-verify-widget {
  --acredia-widget-bg: #1f6feb;
  --acredia-widget-radius: 9999px;
  --acredia-widget-font: "Inter", sans-serif;
}
```

The keyboard focus ring follows the background colour, and the hover
transition is disabled for visitors who ask for reduced motion.

## What happens on click

1. A 600×750 popup opens, centred over the current window, on the Acredia
   verification page.
2. The popup's reference back to your page (`window.opener`) is severed, so
   the Acredia page cannot script or redirect your tab.
3. If the browser blocks the popup, the button falls back to an ordinary link
   that opens the same page in a new tab.
4. Ctrl/⌘/Shift/middle-clicks are left to the browser (new tab, new window),
   like any other link.

## What data the widget sends — and doesn't

**Loading the script** is an ordinary request to the Acredia host for a static
file. Like any third-party script, that request carries the visitor's IP
address, user agent and — under your page's referrer policy — a `Referer`
header. Browsers' default policy (`strict-origin-when-cross-origin`) sends only
your site's origin, not the page path. Acredia sets no cookies on this request.

**While on your page, the widget:**

- makes **no** network requests of its own;
- reads **nothing** from your page except the `data-token` attribute of its
  container;
- sets **no** cookies and uses **no** `localStorage`/`sessionStorage`;
- loads **no** analytics, tracking or third-party code.

**When a visitor clicks**, their browser opens the Acredia verification page
with the token ID in the URL. That page then looks the credential up from
Acredia's servers and the Stellar ledger — the same public verification anyone
can perform at `/verify`. The popup is opened under your page's referrer
policy; the new-tab fallback uses `rel="noreferrer"` and sends no `Referer` at
all. Token IDs are public identifiers, and the verification page shows only
what Acredia's public verification view shows.

## Content Security Policy for your site

The only directive the widget needs is permission to load the script:

```
script-src https://<acredia-host>
```

You can narrow that to the exact file: `script-src https://<acredia-host>/widget/v1.js`.

- If your policy uses nonces or `'strict-dynamic'`, add your nonce to the
  `<script>` tag as you would for any other script.
- **Nothing is needed** in `style-src`, `img-src`, `connect-src`, `font-src` or
  `frame-src`. Styles are applied through constructable stylesheets, which CSP
  does not restrict — the widget is tested under `default-src 'none'`. The icon
  is inline SVG built with DOM APIs.
- It is compatible with Trusted Types (`require-trusted-types-for 'script'`):
  it never assigns HTML strings.
- **Inside a sandboxed `<iframe>`**, the sandbox must include `allow-scripts`,
  `allow-popups` and `allow-popups-to-escape-sandbox`, or the button will be
  unable to open the verification page.

## Failure modes

The widget fails closed: it would rather show nothing than link anywhere other
than the Acredia deployment it came from.

| Situation | What you see |
|---|---|
| No element with `id="acredia-verify-widget"` | Nothing, silently — so the script can be loaded site-wide. |
| The widget cannot determine its Acredia origin (e.g. the file was bundled or inlined into your own JavaScript) | No button; a console error starting `[Acredia verify widget]`; the container gets `data-acredia-widget="error"`. |
| Popup blocked | The link opens the verification page in a new tab instead. |
| Script included twice | One button. |

After a successful render the container carries `data-acredia-widget="ready"`.
You can target either state in CSS or check it in tests:

```css
#acredia-verify-widget[data-acredia-widget="error"] { display: none; }
```

## Versioning and caching policy

Third parties cache and hard-code this script's URL, so a breaking change to a
URL that is already embedded would be unshippable. The policy:

### URLs

| URL | What it serves |
|---|---|
| `/widget/v1.js` | Major version 1. **Use this in new integrations.** |
| `/widget.js` | A permanent alias of v1, kept for integrations that predate versioning. It will never move to v2. |

Both serve identical bytes and headers. The served file starts with
`/*! Acredia verify widget v1 … */` and responses carry an
`X-Acredia-Widget-Version: 1` header, so you can confirm what a page is
running.

### The v1 contract

Everything an embedding page can observe is public API. Within v1, these do
not change incompatibly:

- the container id `acredia-verify-widget` and the `data-token` attribute;
- the `--acredia-widget-*` theming properties;
- the `data-acredia-widget` state attribute and its `ready` / `error` values;
- the destination (`/verify`, with the token as the `token` query parameter);
- the CSP requirements listed above — v1 will never need a new directive.

Bug fixes, security fixes, accessibility improvements and visual refinements
within the defaults ship **in place** at the existing v1 URLs.

### Caching

Both URLs are served with:

```
Cache-Control: public, max-age=3600, stale-while-revalidate=86400
```

A change to v1 reaches visitors within an hour. After that, a browser or CDN
may serve its stale copy once more while it fetches the new one in the
background, for up to a day. The file is deliberately not `immutable` and its
URL carries no content hash: either would strand every existing embed on old
code.

### Breaking changes

A change that breaks the v1 contract ships as a new major version at a new
URL (`/widget/v2.js`). When that happens:

- `/widget/v1.js` and `/widget.js` keep serving v1, unchanged except for
  security fixes, for **at least 12 months** after v2 is released.
- The deprecation and its end date are announced in this document and the
  repository's release notes before v1 is retired.
- Retiring v1 means its URLs serve a script that renders nothing and logs a
  console error pointing at this document — never a 404 or a redirect to a
  different behaviour.

### Self-hosting and Subresource Integrity

Don't copy the file to your own servers or pin it with an `integrity`
attribute. In-place fixes — including security fixes — would never reach your
visitors, and an SRI hash would make the button disappear the first time a fix
ships. If your security policy requires SRI for every third-party script,
contact the Acredia team before integrating.

## For maintainers

| What | Where |
|---|---|
| Widget source, styles, version and cache constants | `frontend/src/lib/widget/verifyWidget.ts` |
| Routes (`/widget/v1.js`, `/widget.js`) | `frontend/src/app/widget/v1.js/route.ts`, `frontend/src/app/widget.js/route.ts` |
| Canonical origin injected at build time | `getConfiguredSiteOrigin()` in `frontend/src/lib/siteUrl.ts` (`NEXT_PUBLIC_SITE_URL`, then `VERCEL_URL`) |
| Unit tests | `frontend/tests/verifyWidget.test.ts` (`npm run test`) |
| Browser tests on a cross-origin host page | `frontend/tests/playwright/verifyWidget.spec.ts` (`npm run test:browser`) |
| Partner-facing snippet | `/docs/api` (`frontend/src/app/docs/api/page.tsx`) |

Both suites run in CI on every pull request.

The script is generated by stringifying `installVerifyWidget`, so that function
must only use its parameters and browser globals — the unit tests execute the
served string in isolation and fail if it reaches for anything else.

**Shipping a breaking change (v2):**

1. Copy the current module to a frozen `verifyWidgetV1.ts`, and point the two
   v1 routes at it.
2. Make the change in `verifyWidget.ts`, set `WIDGET_MAJOR_VERSION = 2` and
   `WIDGET_SCRIPT_PATHS = ['/widget/v2.js']` (`/widget.js` stays with v1).
3. Add `frontend/src/app/widget/v2.js/route.ts`, update `/docs/api` and this
   document, and announce the v1 deprecation window.
