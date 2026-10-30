import { Card } from '@/components/ui/card';
import { Metadata } from 'next';
import { getSiteUrl } from '@/lib/siteUrl';
import {
    WIDGET_DOCS_URL,
    WIDGET_SCRIPT_PATHS,
    WIDGET_THEME_DEFAULTS,
    WIDGET_THEME_PROPERTIES,
} from '@/lib/widget/verifyWidget';

/** Example values for the widget theming snippet, keyed by the hooks the widget reads. */
const THEME_PROPERTY_EXAMPLES: Record<(typeof WIDGET_THEME_PROPERTIES)[number], string> = {
    '--acredia-widget-bg': WIDGET_THEME_DEFAULTS.background,
    '--acredia-widget-bg-hover': '#163a5f',
    '--acredia-widget-fg': WIDGET_THEME_DEFAULTS.foreground,
    '--acredia-widget-radius': '9999px',
    '--acredia-widget-font': '"Inter", sans-serif',
};

export const metadata: Metadata = {
    title: 'API Documentation | Acredia',
    description: 'Documentation for Acredia Public Verification API and Embeddable Widget',
};

export default function ApiDocsPage() {
    // Derived, never hardcoded: the embed snippet previously pointed at
    // `acredia-stellar.vercel.app`, which 404s — the live deployment is on a
    // different hostname. Handing developers a dead script URL is worse than
    // giving none, so it now follows NEXT_PUBLIC_SITE_URL like every other link.
    const siteUrl = getSiteUrl();

    return (
        <div className="container mx-auto max-w-4xl py-12 px-4">
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-foreground">API Documentation</h1>
                    <p className="mt-2 text-lg text-muted-foreground">
                        Integrate Acredia programmatic verification into your applications and websites.
                    </p>
                </div>

                <div className="space-y-12 mt-10">
                    <section id="verification-api">
                        <h2 className="text-2xl font-semibold border-b pb-2 mb-6">Public Verification API</h2>
                        <p className="text-muted-foreground mb-4">
                            The Acredia Public Verification API lets employers, ATS platforms, and partners check a credential&apos;s status programmatically. Every answer is read from the Acredia contract on the Stellar ledger.
                        </p>
                        <p className="text-muted-foreground mb-4">
                            A token ID returns <span className="text-foreground font-medium">status only</span>: the issuer, the issue and expiry dates, and whether the credential is valid, revoked, or expired. It never returns the holder&apos;s name, wallet, or what the credential certifies. Those are shared by the credential holder through their own share link.
                        </p>

                        <Card className="p-6 overflow-hidden">
                            <h3 className="text-lg font-medium mb-2">Verify a Credential</h3>
                            <div className="flex items-center gap-3 bg-secondary/30 p-3 rounded-md mb-4 border font-mono text-sm">
                                <span className="bg-primary/20 text-primary px-2 py-0.5 rounded text-xs font-bold">GET</span>
                                <span>/api/verify/[token]</span>
                            </div>

                            <div className="space-y-4 text-sm">
                                <div>
                                    <h4 className="font-semibold text-foreground mb-1">Path Parameters</h4>
                                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                                        <li><code className="bg-muted px-1 py-0.5 rounded">token</code> - The credential&apos;s token ID: a whole number, as issued by the contract. Anything else returns <code className="bg-muted px-1 py-0.5 rounded">400</code>.</li>
                                    </ul>
                                </div>
                                
                                <div>
                                    <h4 className="font-semibold text-foreground mb-1">Headers</h4>
                                    <ul className="list-disc list-inside text-muted-foreground ml-2">
                                        <li><code className="bg-muted px-1 py-0.5 rounded">Authorization</code> - Bearer &lt;Your-API-Key&gt;</li>
                                        <li className="mt-1">Alternatively, use <code className="bg-muted px-1 py-0.5 rounded">X-API-Key: &lt;Your-API-Key&gt;</code></li>
                                    </ul>
                                    <p className="text-xs text-muted-foreground mt-2 italic">Note: API keys can be generated in the Dashboard Settings (for Institutions). Anonymous requests are rate-limited heavily.</p>
                                </div>

                                <div>
                                    <h4 className="font-semibold text-foreground mb-1">Response (Success 200 OK)</h4>
                                    <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-md overflow-x-auto text-xs font-mono border mt-2">
{`{
  "success": true,
  "credential": {
    "tokenId": "42",
    "status": "valid",
    "issuedAt": "2026-06-01T09:30:00.000Z",
    "expiresAt": null,
    "revoked": false,
    "revokedAt": null,
    "revocationSource": null,
    "institutionName": "University of Technology",
    "institutionWallet": "G...",
    "onChainHash": "3f9a..."
  },
  "verification": {
    "verified": true,
    "status": "valid",
    "revoked": false,
    "expired": false,
    "revocationSource": null,
    "onChainFound": true,
    "issuerAuthorized": true,
    "issuerStatus": "active"
  }
}`}
                                    </pre>
                                </div>

                                <div>
                                    <h4 className="font-semibold text-foreground mb-1">Fields</h4>
                                    <ul className="list-disc list-inside text-muted-foreground ml-2 space-y-1">
                                        <li><code className="bg-muted px-1 py-0.5 rounded">status</code> - <code>valid</code>, <code>revoked</code>, or <code>expired</code>. Revocation takes precedence over expiry. <code>verified</code> is true only for <code>valid</code>.</li>
                                        <li><code className="bg-muted px-1 py-0.5 rounded">expiresAt</code> - The moment the credential expires (UTC), or <code>null</code> if it never does.</li>
                                        <li><code className="bg-muted px-1 py-0.5 rounded">revocationSource</code> - <code>issuer</code> or <code>platform</code> when revoked; a platform revocation is reserved for incident response.</li>
                                        <li><code className="bg-muted px-1 py-0.5 rounded">issuerAuthorized</code> - Whether the issuer may still issue credentials. A credential issued while the issuer was authorized stays valid after the issuer loses authorization.</li>
                                        <li><code className="bg-muted px-1 py-0.5 rounded">institutionName</code> - The name registered with Acredia for the issuing wallet, or <code>null</code> if none is registered.</li>
                                    </ul>
                                </div>

                                <div>
                                    <h4 className="font-semibold text-foreground mb-1">Errors</h4>
                                    <ul className="list-disc list-inside text-muted-foreground ml-2 space-y-1">
                                        <li><code className="bg-muted px-1 py-0.5 rounded">400</code> - The token is not a valid token ID.</li>
                                        <li><code className="bg-muted px-1 py-0.5 rounded">404</code> - The contract has no credential with this token ID.</li>
                                        <li><code className="bg-muted px-1 py-0.5 rounded">429</code> - Rate limit exceeded; see the <code>Retry-After</code> header.</li>
                                        <li><code className="bg-muted px-1 py-0.5 rounded">503</code> - The Stellar ledger could not be read. Retry later; the API never guesses a status while the ledger is unreachable.</li>
                                    </ul>
                                </div>
                            </div>
                        </Card>
                    </section>

                    <section id="upgrade-policy">
                        <h2 className="text-2xl font-semibold border-b pb-2 mb-6">Contract Upgrade Policy</h2>
                        <p className="text-muted-foreground mb-4">
                            The on-chain credential contract is upgradeable so that bugs can be fixed without changing the contract address (which would break existing QR codes and verification links). To keep that power transparent to everyone who relies on a credential, upgrades are governed by an on-chain timelock — they cannot take effect the moment an operator decides to run them.
                        </p>
                        <Card className="p-6">
                            <ul className="space-y-3 text-sm text-muted-foreground list-disc list-inside">
                                <li><span className="text-foreground font-medium">Announced in advance.</span> Every upgrade must first be proposed on-chain, which emits a public <code className="bg-muted px-1 py-0.5 rounded">upgrade_proposed</code> event and is readable by anyone via the contract&apos;s <code className="bg-muted px-1 py-0.5 rounded">get_pending_upgrade</code> method.</li>
                                <li><span className="text-foreground font-medium">Fixed waiting period.</span> A proposed upgrade can only be executed after a timelock of ~7 days (120,960 ledgers) has elapsed, giving credential holders and verifiers a window to inspect the proposed code before it goes live.</li>
                                <li><span className="text-foreground font-medium">Code-hash commitment.</span> A proposal commits to a specific WASM code hash, and execution must present that same hash — so the code that ships is exactly the code that was announced.</li>
                                <li><span className="text-foreground font-medium">Owner-gated and cancellable.</span> Only the contract owner can propose, cancel, or execute an upgrade, and a pending proposal can be withdrawn (<code className="bg-muted px-1 py-0.5 rounded">cancel_upgrade</code>) before the window elapses.</li>
                            </ul>
                            <p className="text-xs text-muted-foreground mt-4 italic">The emergency pause circuit-breaker is separate and immediate: it can halt state changes during an incident without waiting on the upgrade timelock, while never allowing code to be replaced without the announced waiting period.</p>
                        </Card>
                    </section>

                    <section id="embeddable-widget">
                        <h2 className="text-2xl font-semibold border-b pb-2 mb-6">Embeddable Widget</h2>
                        <p className="text-muted-foreground mb-4">
                            Drop a "Verify with Acredia" button directly into your website to allow your users to verify credentials seamlessly without leaving your page (opens a popup).
                        </p>
                        <p className="text-muted-foreground mb-4">
                            The{' '}
                            <a
                                href={WIDGET_DOCS_URL}
                                className="font-medium text-foreground underline underline-offset-4"
                            >
                                integration guide
                            </a>{' '}
                            covers sizing, theming, exactly what data the widget sends, the Content Security Policy your site needs, and the versioning policy: <code>{WIDGET_SCRIPT_PATHS[0]}</code> only ever receives backwards-compatible changes, and a breaking change ships at a new versioned URL.
                        </p>

                        <Card className="p-6">
                            <h3 className="text-lg font-medium mb-4">Quickstart</h3>
                            
                            <div className="space-y-6">
                                <div>
                                    <p className="text-sm text-foreground font-semibold mb-2">1. Add the widget script to your page</p>
                                    <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded-md overflow-x-auto text-xs font-mono border">
{`<script src="${siteUrl}${WIDGET_SCRIPT_PATHS[0]}" async></script>`}
                                    </pre>
                                </div>
                                
                                <div>
                                    <p className="text-sm text-foreground font-semibold mb-2">2. Place the button container</p>
                                    <p className="text-xs text-muted-foreground mb-2">Add this div wherever you want the button to appear. Optional: Provide a token to pre-fill the verification.</p>
                                    <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded-md overflow-x-auto text-xs font-mono border">
{`<div id="acredia-verify-widget" data-token="OPTIONAL_TOKEN_ID"></div>`}
                                    </pre>
                                </div>

                                <div>
                                    <p className="text-sm text-foreground font-semibold mb-2">3. Optional: match your brand</p>
                                    <p className="text-xs text-muted-foreground mb-2">
                                        The button renders in its own shadow root, so your page&apos;s CSS cannot break it. Theme it with these custom properties instead; any you leave unset keep Acredia&apos;s defaults.
                                    </p>
                                    <pre className="bg-[#1e1e1e] text-[#d4d4d4] p-3 rounded-md overflow-x-auto text-xs font-mono border">
{`#acredia-verify-widget {
${WIDGET_THEME_PROPERTIES.map((property) => `  ${property}: ${THEME_PROPERTY_EXAMPLES[property]};`).join('\n')}
}`}
                                    </pre>
                                </div>

                                <p className="text-xs text-muted-foreground">
                                    The script only ever links to the Acredia deployment it is served from. If it cannot determine that deployment, it renders nothing and logs an error to the browser console rather than linking anywhere else, and the container gets <code>data-acredia-widget=&quot;error&quot;</code>.
                                </p>

                                <div className="bg-secondary/30 p-4 rounded-md border flex items-center justify-between">
                                    <div className="text-sm">
                                        <p className="font-semibold">Result Preview</p>
                                        <p className="text-muted-foreground text-xs mt-1">What the button looks like on your site</p>
                                    </div>
                                    <span
                                        aria-hidden="true"
                                        className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold py-2.5 px-5 rounded-md shadow-sm transition-colors text-sm"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                                        Verify with Acredia
                                    </span>
                                </div>
                            </div>
                        </Card>
                    </section>
                </div>
            </div>
        </div>
    );
}
