# Brand masters

Source images for the logo. Not served: the app uses files derived from them.

| File | Use |
|---|---|
| `logo-transparent.png` | 401×420, transparent background. Source of `public/logo.png`. |
| `logo-on-white.png` | 401×420, on white. Source of the PWA icons (`scripts/generate-pwa-icons.sh`): the white crest is drawn for a white tile. |

There is no vector (SVG) master yet. If one becomes available, add it here
and derive the files below from it.

## `public/logo.png`

The one served logo: the navbar, footer, auth and console shells, the social
cards (`src/lib/og/brandCard.tsx`), the WalletConnect app icon and the README.
`next/image` resizes it for the page (a 36 px logo arrives as a 1.5–3 KB WebP),
so this file's size matters where it is fetched whole: social cards, wallets,
the README.

It is 320 px wide (the largest use is the README at 150 px, so 300 px on
high-density screens), with its colours reduced to 256 and its alpha channel
kept whole, so the edges stay smooth. 76 KB, against 171 KB for the master:

```bash
cd frontend
magick assets/brand/logo-transparent.png -strip -resize 320x \
  \( +clone -alpha extract \) \( -clone 0 -alpha off -dither None -colors 256 \) \
  -delete 0 +swap -compose CopyOpacity -composite \
  -define png:color-type=6 -define png:compression-level=9 -define png:compression-filter=5 \
  public/logo.png
```

A plain 256-colour palette PNG (about 28 KB) was rejected: it makes the
outline jagged and bands the gold gradient.
