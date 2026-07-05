import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VerificationStateCard } from '../src/components/verify/VerificationStateCard';
import { BrandSectionHeader } from '../src/components/marketing/BrandSectionHeader';
import { HOMEPAGE_FEATURES } from '../src/lib/marketingContent';

describe('marketing and verification components', () => {
    it('renders a verification status card with its supporting description', () => {
        const html = renderToStaticMarkup(
            <VerificationStateCard
                status="valid"
                title="Credential verified"
                description="This credential is authentic."
            />,
        );

        expect(html).toContain('Credential verified');
        expect(html).toContain('This credential is authentic.');
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
