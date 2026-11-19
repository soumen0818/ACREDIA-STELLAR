import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og/brandCard';

export const alt = 'Acredia: Own your academic achievements forever.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard({
        eyebrow: 'For students',
        title: 'Own your academic achievements forever.',
        description:
            'Access, share and verify your credentials anytime, anywhere.',
    });
}
