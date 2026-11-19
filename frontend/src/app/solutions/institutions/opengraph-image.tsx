import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from '@/lib/og/brandCard';

export const alt = 'Acredia: Streamline credential issuance & management.';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard({
        eyebrow: 'For institutions',
        title: 'Streamline credential issuance & management.',
        description:
            'Issue blockchain-secured credentials in minutes, and end credential fraud.',
    });
}
