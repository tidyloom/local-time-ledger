import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const networkModules = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns'].flatMap((m) => [m, `node:${m}`]);

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.vscode-test/**'] },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: { sourceType: 'module', globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { project: ['./tsconfig.test.json'], tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/test/**'],
    rules: {
      // The free core makes no network calls. These rules make that structural.
      'no-restricted-imports': ['error', { paths: networkModules.map((name) => ({ name, message: 'No network calls in the free core.' })) }],
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
    },
  },
  {
    // The one exception: the user started Gumroad license check. fetch only, still no modules.
    files: ['src/pro/transport.ts'],
    rules: {
      'no-restricted-globals': ['error', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
    },
  },
);
