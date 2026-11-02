import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.vscode-test/**',
      'coverage/**',
      'out/**',
      '.superpowers/**',
      '.a5c/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
  { files: ['webview/**'], languageOptions: { globals: { ...globals.browser } } },
  { files: ['**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  { files: ['test/integration/**'], languageOptions: { globals: { ...globals.mocha } } },
  prettier,
);
