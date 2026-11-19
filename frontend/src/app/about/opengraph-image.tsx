import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og/brandCard';

export const alt = 'Acredia: Building trust in academic credentials.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard({
        eyebrow: 'About Acredia',
        title: 'Building trust in academic credentials.',
        description:
            'Credentials anchored on the Stellar network, with documents kept private.',
    });
}
