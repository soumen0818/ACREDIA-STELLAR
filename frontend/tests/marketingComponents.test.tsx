import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerificationVerdict } from '../src/components/verify/VerificationVerdict';
import { BrandSectionHeader } from '../src/components/marketing/BrandSectionHeader';
import { HOMEPAGE_FEATURES } from '../src/lib/marketingContent';

describe('marketing and verification components', () => {
    it('states the verification verdict and one supporting line', () => {
        const html = renderToStaticMarkup(<VerificationVerdict kind="verified" />);

        expect(html).toContain('Credential Verified');
        expect(html).toContain('recorded on the Stellar ledger and is currently valid');
    });

    it('states expiry as its own verdict, not as a revocation', () => {
        const expired = renderToStaticMarkup(<VerificationVerdict kind="expired" />);

        expect(expired).toContain('Credential Expired');
        expect(expired).toContain('passed its expiry date');
        expect(expired).not.toContain('revoked');
    });

    it('keeps revocation and document integrity as separate verdicts', () => {
        const revoked = renderToStaticMarkup(<VerificationVerdict kind="revoked" />);

        expect(revoked).toContain('Credential Revoked');
        // A revoked credential is a decision by the issuer, never a claim that
        // the document itself was tampered with (ACREDIA-STELLAR#163).
        expect(revoked).not.toContain('Integrity');
    });

    it('points an unavailable verdict at the status page, and no other verdict (#312)', () => {
        const unavailable = renderToStaticMarkup(<VerificationVerdict kind="unavailable" />);
        expect(unavailable).toContain('Verification Unavailable');
        expect(unavailable).toContain('href="/status"');

        // Also when the page replaces the supporting line with its own error.
        const withLine = renderToStaticMarkup(<VerificationVerdict kind="unavailable" line="Ledger read timed out." />);
        expect(withLine).toContain('href="/status"');

        for (const kind of ['verified', 'revoked', 'expired', 'mismatch', 'not-found'] as const) {
            expect(renderToStaticMarkup(<VerificationVerdict kind={kind} />)).not.toContain('/status');
        }
    });

    it('renders a reusable section heading for landing-page stories', () => {
        const html = renderToStaticMarkup(
            <BrandSectionHeader title="Built for trust" description="Simple verification for institutions and students." />,
        );

        expect(html).toContain('Built for trust');
        expect(html).toContain('Simple verification for institutions and students.');
    });

    it('exposes feature content for the marketing pages', () => {
        expect(HOMEPAGE_FEATURES.length).toBeGreaterThan(0);
        expect(HOMEPAGE_FEATURES[0]?.title).toBeTruthy();
    });
});
