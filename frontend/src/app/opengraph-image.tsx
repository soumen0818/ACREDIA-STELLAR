import { brandCard, cardAlt, OG_CONTENT_TYPE, OG_SIZE, SITE_CARD } from '@/lib/og/brandCard';

export const alt = cardAlt(SITE_CARD);
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
    return brandCard(SITE_CARD);
}
