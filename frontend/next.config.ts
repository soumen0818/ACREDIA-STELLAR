import type { NextConfig } from 'next';
import { buildSecurityHeaders } from './src/lib/securityHeaders';

async function headers() {
  return [
    {
      source: '/:path*',
      headers: [
        {
          key: 'Content-Security-Policy',
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "img-src 'self' data: https: blob:",
            "font-src 'self' https://fonts.gstatic.com",
            "connect-src 'self' https://*.supabase.co https://gateway.pinata.cloud https://*.ipfs.dweb.link https://horizon.stellar.org https://horizon-testnet.stellar.org https://rpc-futurenet.stellar.org wss://*.supabase.co",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
        {
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        },
        {
          key: 'X-Frame-Options',
          value: 'DENY',
        },
        {
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        },
        {
          key: 'Permissions-Policy',
          value: 'camera=(), microphone=(), geolocation=(), payment=()',
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
        {
          key: 'X-XSS-Protection',
          value: '1; mode=block',
        },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
    // ── Security headers ────────────────────────────────────────────────────
    async headers() {
        return buildSecurityHeaders(process.env.NODE_ENV === 'production');
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

    images: {
        remotePatterns: [
            { protocol: 'https', hostname: 'gateway.pinata.cloud' },
            { protocol: 'https', hostname: '**.ipfs.dweb.link' },
            { protocol: 'https', hostname: 'ipfs.io' },
            { protocol: 'https', hostname: 'res.cloudinary.com' },
        ],
    },

    experimental: {
        // Optimize package imports
        optimizePackageImports: ['@radix-ui/react-icons', 'lucide-react'],
    },
};

export default nextConfig;
