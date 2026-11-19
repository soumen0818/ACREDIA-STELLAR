# Fonts

Inter (regular and semibold, latin subset, WOFF) for the generated social
cards (`src/lib/og/brandCard.tsx`). The site loads Inter through `next/font`,
but `next/og` needs the font file itself, and accepts TTF, OTF or WOFF, not
WOFF2.

Taken from `@fontsource/inter` 5.3.0 (`files/inter-latin-{400,600}-normal.woff`).
Licensed under the SIL Open Font License 1.1: `Inter-LICENSE.txt`.
