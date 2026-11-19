import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og/brandCard';

export const alt = 'Acredia: Check any credential in seconds.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard({
        eyebrow: 'Verify a credential',
        title: 'Check any credential in seconds.',
        description:
            'Its authenticity and status, read straight from the Stellar blockchain.',
    });
}
