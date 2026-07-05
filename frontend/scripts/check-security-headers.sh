#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# check-security-headers.sh
# ──────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/check-security-headers.sh <base-url>
#
# Example:
#   ./scripts/check-security-headers.sh https://acredia-stellar-tau.vercel.app
#
# This script checks that the expected security headers are present in the
# response from a production (or preview) deployment. It exits with code 0
# if all headers are present, or 1 with details about what is missing.
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "Usage: $0 <base-url>"
    echo "Example: $0 https://acredia-stellar-tau.vercel.app"
    exit 1
fi

BASE_URL="${1%/}"
FAILED=0

check_header() {
    local header_name="$1"
    local expected_pattern="$2"
    local location="$3"

    local value
    value=$(curl -sI "$location" | grep -i "^${header_name}:" | sed 's/^[^:]*:\s*//i' | tr -d '\r')

    if [ -z "$value" ]; then
        echo "  MISSING: $header_name"
        FAILED=1
        return
    fi

    if echo "$value" | grep -qE "$expected_pattern"; then
        echo "  OK: $header_name"
    else
        echo "⚠  $header_name present but pattern mismatch"
        echo "   Expected pattern: $expected_pattern"
        echo "   Got: $value"
        FAILED=1
    fi
}

echo "── Checking security headers at ${BASE_URL} ──"
echo ""

check_header "Content-Security-Policy" "default-src" "$BASE_URL"
check_header "X-Frame-Options" "DENY" "$BASE_URL"
check_header "X-Content-Type-Options" "nosniff" "$BASE_URL"
check_header "Referrer-Policy" "strict-origin-when-cross-origin" "$BASE_URL"
check_header "Permissions-Policy" "camera=\(self\)" "$BASE_URL"
check_header "Strict-Transport-Security" "max-age=" "$BASE_URL"

echo ""
if [ $FAILED -eq 0 ]; then
    echo "✓ All security headers are present."
else
    echo "✗ Some security headers are missing or have unexpected values."
    echo "  Update the CSP in src/lib/securityHeaders.ts if a new integration"
    echo "  intentionally requires additional domains."
fi
exit $FAILED
