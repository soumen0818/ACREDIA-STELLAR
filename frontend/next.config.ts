import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/lib/securityHeaders';

const nextConfig: NextConfig = {
    allowedDevOrigins: ['127.0.0.1'],

    // ── Security headers ────────────────────────────────────────────────────
    async headers() {
        return buildSecurityHeaders(process.env.NODE_ENV === 'production');
    },

    // ── Redirects ───────────────────────────────────────────────────────────
    async redirects() {
        return [
            {
                // Public signup was removed (Issue #239): Acredia provisions
                // institutions, and institutions provision students. Bookmarks
                // and stale links land on contact rather than a 404, but the
                // route itself no longer exists and grants nothing. Kept
                // temporary so the path is never cached as permanently moved.
                source: '/auth/register',
                destination: '/contact',
                permanent: false,
            },
        ];
    },

    turbopack: {},
    webpack: (config, { isServer }) => {
        // Ignore test files and development dependencies from thread-stream
        config.module = config.module || {};
        config.module.rules = config.module.rules || [];

        // Use null-loader to ignore test, bench, and non-JS files
        config.module.rules.push({
            test: /node_modules\/thread-stream\/(test|bench)\/.*/,
            use: 'null-loader',
        });

        config.module.rules.push({
            test: /node_modules\/thread-stream\/(LICENSE|README\.md)/,
            use: 'null-loader',
        });

        // Fallbacks for node modules
        config.resolve = config.resolve || {};
        config.resolve.fallback = {
            ...config.resolve.fallback,
            fs: false,
            net: false,
            tls: false,
            pino: false,
            'pino-pretty': false,
            encoding: false,
        };

        // Externalize thread-stream on server side
        if (isServer) {
            config.externals = config.externals || [];
            if (Array.isArray(config.externals)) {
                config.externals.push({
                    'thread-stream': 'commonjs thread-stream',
                });
            }
        }

        return config;
    },

    experimental: {
        // Optimize package imports
        optimizePackageImports: ['@radix-ui/react-icons', 'lucide-react'],
    },
};

export default nextConfig;
