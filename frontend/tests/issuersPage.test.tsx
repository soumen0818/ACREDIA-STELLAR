import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicIssuer } from '../src/lib/issuerRegistry';

/**
 * /issuers renders the registry into its HTML, so search engines and link
 * previews see the issuers; the browser only filters (review §4.5).
 */

const loadVerifiedIssuersForPage = vi.hoisted(() => vi.fn<() => Promise<PublicIssuer[] | null>>());

vi.mock('../src/lib/issuerRegistry', () => ({ loadVerifiedIssuersForPage }));
vi.mock('next/navigation', () => ({ usePathname: () => '/issuers' }));

const { default: IssuersPage } = await import('../src/app/issuers/page');

const issuer = (id: string, name: string): PublicIssuer => ({
    id,
    name,
    wallet_address: `G${id.toUpperCase().padEnd(55, 'A')}`,
    authorization_tx_hash: null,
    verified_at: '2026-10-01T23:30:00.000Z',
});

async function render() {
    return renderToStaticMarkup(await IssuersPage());
}

beforeEach(() => {
    loadVerifiedIssuersForPage.mockReset();
});

describe('/issuers page', () => {
    it('renders the verified issuers into the HTML', async () => {
        loadVerifiedIssuersForPage.mockResolvedValue([issuer('inst-1', 'Acredia Academy'), issuer('inst-2', 'Northbridge University')]);
        const html = await render();

        expect(html).toContain('Acredia Academy');
        expect(html).toContain('Northbridge University');
        expect(html).toContain('2 verified issuer');
        expect(html).not.toContain('animate-pulse');
    });

    it('formats verification dates in UTC, so the server and browser agree', async () => {
        // 23:30 UTC: still 1 October in UTC, already 2 October in India. The
        // time zone is set here so the test means the same thing in UTC CI.
        const timeZone = process.env.TZ;
        process.env.TZ = 'Asia/Kolkata';
        try {
            loadVerifiedIssuersForPage.mockResolvedValue([issuer('inst-1', 'Acredia Academy')]);
            expect(await render()).toContain('Verified on 1 Oct 2026');
        } finally {
            if (timeZone === undefined) delete process.env.TZ;
            else process.env.TZ = timeZone;
        }
    });

    it('says so when there are no verified issuers yet', async () => {
        loadVerifiedIssuersForPage.mockResolvedValue([]);
        expect(await render()).toContain('No verified issuers yet.');
    });

    it('shows a loading state when the server could not read the registry; the browser then loads it', async () => {
        loadVerifiedIssuersForPage.mockResolvedValue(null);
        const html = await render();

        expect(html).toContain('animate-pulse');
        expect(html).not.toContain('No verified issuers yet.');
    });
});
