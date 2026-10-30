import eslint from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    plugins: {
      '@next/next': nextPlugin,
      'jsx-a11y': jsxA11y,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_", "caughtErrors": "none" }
      ],
      "no-console": "error"
    },
  },
  {
    // The wallet boundary (ACREDIA-STELLAR#3 / #272).
    //
    // Acredia supported exactly one wallet because Freighter was imported
    // directly in the connection layer, the signing layer and a page
    // component. Multi-wallet support is only durable if that cannot happen
    // again, so concrete wallet libraries are importable from
    // src/lib/wallet/ and nowhere else. Everything else uses the
    // `WalletAdapter` interface.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/lib/wallet/**'],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@stellar/freighter-api",
              message:
                "Acredia is no longer Freighter-only. Use the WalletAdapter from '@/lib/wallet'.",
            },
          ],
          patterns: [
            {
              // Covers the barrel and every per-wallet subpath
              // (…/modules/freighter, …/modules/xbull, and so on).
              group: ["@creit.tech/stellar-wallets-kit", "@creit.tech/stellar-wallets-kit/**"],
              message:
                "Import the WalletAdapter from '@/lib/wallet' instead. Only src/lib/wallet/adapter.ts may talk to a wallet library directly.",
            },
          ],
        },
      ],
    },
  },
  {
    // Network-specific Stellar URLs (review §3.4).
    //
    // Explorer links hardcoded to testnet would have pointed every "view on
    // explorer" link at the wrong network after the mainnet cutover. The
    // network profile in runtimeConfig.ts is the only place these may appear;
    // everything else uses the helpers in @/lib/stellar or runtimeConfig.
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/lib/runtimeConfig.ts'],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/stellar\\.expert\\/explorer\\/|horizon(-testnet)?\\.stellar\\.org|soroban-testnet\\.stellar\\.org|sorobanrpc\\.com/]",
          message:
            "Network-specific Stellar URL. Use getExplorerTxUrl/getExplorerAddressUrl from '@/lib/stellar' or runtimeConfig.stellar instead.",
        },
        {
          selector:
            "TemplateElement[value.raw=/stellar\\.expert\\/explorer\\/|horizon(-testnet)?\\.stellar\\.org|soroban-testnet\\.stellar\\.org|sorobanrpc\\.com/]",
          message:
            "Network-specific Stellar URL. Use getExplorerTxUrl/getExplorerAddressUrl from '@/lib/stellar' or runtimeConfig.stellar instead.",
        },
      ],
    },
  },
  {
    files: ['**/debug.ts'],
    rules: {
      "no-console": "off"
    }
  },
  {
    // Standalone CLI entrypoints (run outside the Next.js app, e.g. by
    // cron) legitimately print operator-facing status to stdout/stderr.
    files: ['worker/**/*.ts'],
    rules: {
      "no-console": "off"
    }
  },
  {
    ignores: [
      ".next/",
      "node_modules/",
      "dist/",
      "build/",
      "scripts/",
      "public/",
    ]
  }
);
