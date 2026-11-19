import { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/siteUrl';

type Entry = Pick<MetadataRoute.Sitemap[number], 'changeFrequency' | 'priority'>;

/**
 * Every public, indexable page. Console, auth and share pages stay out: the
 * consoles are disallowed in robots.ts and share pages are `noindex`.
 */
const SITEMAP_ROUTES: Record<string, Entry> = {
    '': { changeFrequency: 'daily', priority: 1.0 },
    '/verify': { changeFrequency: 'weekly', priority: 0.9 },
    '/issuers': { changeFrequency: 'daily', priority: 0.8 },
    '/about': { changeFrequency: 'weekly', priority: 0.8 },
    '/solutions/institutions': { changeFrequency: 'weekly', priority: 0.8 },
    '/solutions/students': { changeFrequency: 'weekly', priority: 0.8 },
    '/contact': { changeFrequency: 'monthly', priority: 0.6 },
    '/docs/api': { changeFrequency: 'monthly', priority: 0.6 },
    '/legal/privacy': { changeFrequency: 'yearly', priority: 0.3 },
    '/legal/terms': { changeFrequency: 'yearly', priority: 0.3 },
    '/legal/dpa': { changeFrequency: 'yearly', priority: 0.3 },
};

export default function sitemap(): MetadataRoute.Sitemap {
    const baseUrl = getSiteUrl();

    return Object.entries(SITEMAP_ROUTES).map(([route, entry]) => ({
        url: `${baseUrl}${route}`,
        lastModified: new Date(),
        ...entry,
    }));
}
