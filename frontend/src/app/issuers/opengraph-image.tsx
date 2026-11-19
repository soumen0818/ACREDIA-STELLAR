import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og/brandCard';

export const alt = 'Acredia: The institutions that can issue on Acredia.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard({
        eyebrow: 'Verified issuers',
        title: 'The institutions that can issue on Acredia.',
        description:
            'Each one vetted, and authorised on the Stellar blockchain.',
    });
}
