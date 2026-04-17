// eslint.config.mjs
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const unusedVarsPattern = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  caughtErrorsIgnorePattern: '^_',
  destructuredArrayIgnorePattern: '^_',
};

export default defineConfig(
  // Ignore build artifacts and non-source directories
  {
    ignores: ['dist/**', 'working/**', 'map_data/**', 'node_modules/**'],
  },

  // Base rules
  eslint.configs.recommended,
  // TS (works even if you have some JS files)
  ...tseslint.configs.recommended,

  // Repo-wide defaults
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2020, // standard ES globals
      },
    },
    rules: {
      // @typescript-eslint/no-unused-vars handles both JS and TS; the base rule
      // duplicates it and produces false positives on TS type-signature params.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', unusedVarsPattern],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Node/server scripts (process, console, __dirname, etc.)
  {
    files: ['server/**', 'scripts/**', 'bin/**', '**/*.mjs', '**/setup-database.js'],
    languageOptions: {
      globals: {
        ...globals.node, // adds process, console, Buffer, etc.
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Browser/client code
  {
    files: ['web/**', 'client/**', 'components/**', 'hooks/**', 'contexts/**', 'utils/**'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // Test files (Jest globals)
  {
    files: ['tests/**'],
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
);
