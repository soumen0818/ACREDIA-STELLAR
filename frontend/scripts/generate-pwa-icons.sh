#!/bin/bash
# generate-pwa-icons.sh - Regenerates the web app manifest icons (ACREDIA-STELLAR#303)
# from assets/brand/logo-on-white.png. Requires ImageMagick 7 (`magick`).
#
# Outputs, all referenced by src/app/manifest.ts:
#   public/icons/icon-192.png           192x192, purpose "any"
#   public/icons/icon-512.png           512x512, purpose "any" (install prompt + splash)
#   public/icons/icon-maskable-512.png  512x512, purpose "maskable"
#
# The logo is drawn for a white background (the white crest relies on it), so
# the icons keep a white tile rather than a transparent cut-out.
#
# tests/seo-assets.test.ts reads each file's PNG header and fails if its real
# dimensions stop matching what the manifest declares.

set -euo pipefail

cd "$(dirname "$0")/.."

SOURCE="assets/brand/logo-on-white.png"
OUT_DIR="public/icons"
mkdir -p "$OUT_DIR"

# The logo with its white margin trimmed off, kept in memory as a cropped PNG.
trimmed() {
    magick "$SOURCE" -fuzz 3% -trim +repage png:-
}

# "any" icon: logo at ~88% of the tile on a white rounded square, transparent
# corners. Browsers show this one as-is, so it is never cropped.
any_icon() {
    local size=$1
    local content=$((size * 88 / 100))
    local radius=$((size * 22 / 100))

    trimmed | magick - -resize "${content}x${content}" \
        -background white -gravity center -extent "${size}x${size}" \
        \( -size "${size}x${size}" xc:none -fill white \
           -draw "roundrectangle 0,0 $((size - 1)),$((size - 1)) ${radius},${radius}" \) \
        -compose DstIn -composite \
        -strip -define png:color-type=6 "$OUT_DIR/icon-${size}.png"
}

# Maskable icon: full-bleed white, logo inside the central safe zone (a circle
# of radius 40% of the tile). Android may crop to any shape inside that circle;
# a 288px-tall logo's bounding box has a ~400px diagonal, which fits in the 409.6px circle.
maskable_icon() {
    local size=512
    local content=288

    trimmed | magick - -resize "${content}x${content}" \
        -background white -gravity center -extent "${size}x${size}" \
        -strip -define png:color-type=6 "$OUT_DIR/icon-maskable-${size}.png"
}

any_icon 192
any_icon 512
maskable_icon

magick identify -format "%f %wx%h\n" "$OUT_DIR"/*.png
