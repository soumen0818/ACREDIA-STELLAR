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

describe('stale answers on the verdict (issue #313)', () => {
    const AS_OF = '2029-12-31T23:05:00.000Z';
    const SHOWN = 'December 31, 2029 at 11:05 PM UTC';

    it('never shows a stale valid answer as a live, green "Verified ✓"', () => {
        const html = renderToStaticMarkup(
            <VerificationVerdict kind="verified" staleAsOf={AS_OF} revocationMayBeOutdated />,
        );

        expect(html).toContain(`Verified as of ${SHOWN}`);
        expect(html).not.toContain('Credential Verified ✓');
        expect(html).not.toContain('is currently valid');
        expect(html).not.toContain('bg-success');
    });

    it('dates the answer and says its revocation status may be out of date', () => {
        const html = renderToStaticMarkup(
            <VerificationVerdict kind="verified" staleAsOf={AS_OF} revocationMayBeOutdated />,
        );

        expect(html).toContain(`As of ${SHOWN}.`);
        expect(html).toContain('cannot reach the Stellar ledger right now');
        expect(html).toContain('revocation status may be out of date');
        expect(html).toContain('href="/status"');
    });

    it('dates a stale revocation without casting doubt on it', () => {
        const html = renderToStaticMarkup(
            <VerificationVerdict kind="revoked" staleAsOf={AS_OF} revocationMayBeOutdated={false} />,
        );

        expect(html).toContain('Credential Revoked');
        expect(html).toContain(`As of ${SHOWN}.`);
        expect(html).not.toContain('revocation status may be out of date');
    });

    it('shows a live answer exactly as before', () => {
        const html = renderToStaticMarkup(<VerificationVerdict kind="verified" staleAsOf={null} />);

        expect(html).toContain('Credential Verified ✓');
        expect(html).not.toContain('stale-answer-notice');
        expect(html).not.toContain('As of');
    });
});
