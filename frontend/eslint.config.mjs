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
      "no-console": "error"
    },
  },
  {
    files: ['**/debug.ts'],
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
      "test_simulate.mjs",
    ]
  }
);
