import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og/brandCard';

export const alt = 'Acredia: Let\'s talk about credentials you can trust.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard({
        eyebrow: 'Contact',
        title: 'Let\'s talk about credentials you can trust.',
        description:
            'Issuing credentials, verification, partnerships or support.',
    });
}
