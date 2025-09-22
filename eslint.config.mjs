// eslint.config.mjs
// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';
import globals from 'globals';

export default defineConfig(
  // Base rules
  eslint.configs.recommended,
  // TS (works even if you have some JS files)
  ...tseslint.configs.recommended,

  // Repo-wide defaults
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2020, // standard ES globals
      },
    },
    rules: {
      // treat intentionally unused vars/args prefixed with "_" as ok
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // Node/server scripts (process, console, __dirname, etc.)
  {
    files: ['server/**', 'scripts/**', 'bin/**', '**/setup-database.js'],
    languageOptions: {
      globals: {
        ...globals.node, // adds process, console, Buffer, etc.
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Browser/client code (optional block – only if you have web/client folders)
  {
    files: ['web/**', 'client/**'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    // You can re-enable stricter rules here if you want
    // rules: { 'no-console': 'warn' },
  },
);
