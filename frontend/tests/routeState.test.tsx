import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RouteStateScreen } from '../src/components/route-state/RouteStateScreen';

describe('route state screens', () => {
    it('renders branded recovery screens with actionable copy', () => {
        const html = renderToStaticMarkup(
            <RouteStateScreen
                title="Something went wrong"
                description="We could not complete that request. Please try again."
                actionLabel="Try again"
                secondaryActionLabel="Back to home"
            />,
        );

        expect(html).toContain('Something went wrong');
        expect(html).toContain('Try again');
        expect(html).toContain('Back to home');
        expect(html).toContain('ACREDIA');
    });

    it('renders a loading state for route-level transitions', () => {
        const html = renderToStaticMarkup(
            <RouteStateScreen
                title="Loading dashboard"
                description="Preparing your workspace..."
                variant="loading"
            />,
        );

        expect(html).toContain('Loading dashboard');
        expect(html).toContain('Preparing your workspace...');
        expect(html).toContain('ACREDIA');
    });
});
