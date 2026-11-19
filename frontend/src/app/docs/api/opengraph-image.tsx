import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og/brandCard';

export const alt = 'Acredia: Verification API and embeddable widget.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard({
        eyebrow: 'Developers',
        title: 'Verification API and embeddable widget.',
        description:
            'Integrate Acredia verification into your applications and websites.',
    });
}
