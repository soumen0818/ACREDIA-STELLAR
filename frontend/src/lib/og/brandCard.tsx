import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { OG_SIZE, type BrandCardText } from './cards';

/**
 * The social card (og:image) for public pages: 1200×630, as Open Graph and
 * X expect (review §4.5). Each route's `opengraph-image.tsx` passes its own
 * text; Next.js renders the card once, at build time.
 *
 * Colours are the site's (globals.css: `--navy-*`, `--gold-*`,
 * `.bg-brand-mesh`), and so is the font: Inter, from assets/fonts (OFL-1.1).
 * The font bundled with next/og is not used because the renderer mis-measures
 * some of its words, leaving uneven gaps between them.
 */

export { OG_SIZE, OG_CONTENT_TYPE, SITE_CARD, cardAlt, type BrandCardText } from './cards';

const NAVY_700 = '#0f2f52';
const NAVY_900 = '#071a2f';
const GOLD_400 = '#d9b64e';

let logo: Promise<string> | null = null;
let fonts: Promise<NonNullable<ConstructorParameters<typeof ImageResponse>[1]>['fonts']> | null = null;

/** public/logo.png as a data URI, read once. */
function logoDataUri(): Promise<string> {
    logo ??= readFile(join(process.cwd(), 'public', 'logo.png')).then(
        (png) => `data:image/png;base64,${png.toString('base64')}`,
    );
    return logo;
}

/** Inter regular and semibold (latin subset), read once. */
function interFonts() {
    const font = async (weight: 400 | 600) => ({
        name: 'Inter',
        data: await readFile(join(process.cwd(), 'assets', 'fonts', `inter-latin-${weight}-normal.woff`)),
        weight,
        style: 'normal' as const,
    });
    fonts ??= Promise.all([font(400), font(600)]);
    return fonts;
}

export async function brandCard({ eyebrow, title, description }: BrandCardText): Promise<ImageResponse> {
    const [logoSrc, interFontFaces] = await Promise.all([logoDataUri(), interFonts()]);

    return new ImageResponse(
        (
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '64px 80px',
                    color: '#ffffff',
                    fontFamily: 'Inter',
                    backgroundColor: NAVY_900,
                    backgroundImage: [
                        'radial-gradient(60% 80% at 15% 0%, rgba(29, 111, 184, 0.35) 0%, rgba(29, 111, 184, 0) 60%)',
                        'radial-gradient(50% 70% at 100% 20%, rgba(193, 154, 46, 0.22) 0%, rgba(193, 154, 46, 0) 55%)',
                        `linear-gradient(160deg, ${NAVY_700} 0%, ${NAVY_900} 100%)`,
                    ].join(', '),
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- next/og renders plain <img> */}
                    <img src={logoSrc} width={64} height={67} alt="" />
                    <span style={{ fontSize: 40, fontWeight: 600 }}>Acredia</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                    <span style={{ fontSize: 26, color: GOLD_400, letterSpacing: 4, textTransform: 'uppercase' }}>
                        {eyebrow}
                    </span>
                    <span style={{ fontSize: 66, fontWeight: 600, lineHeight: 1.1, maxWidth: 1000 }}>{title}</span>
                    <span style={{ fontSize: 30, lineHeight: 1.4, color: 'rgba(255, 255, 255, 0.75)', maxWidth: 960 }}>
                        {description}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 24, color: 'rgba(255, 255, 255, 0.6)' }}>
                    <div style={{ width: 40, height: 3, backgroundColor: GOLD_400 }} />
                    Academic credentials anchored on Stellar
                </div>
            </div>
        ),
        { ...OG_SIZE, fonts: interFontFaces },
    );
}
