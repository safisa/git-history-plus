process.env.TZ = 'UTC';
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = { vscode: fileURLToPath(new URL('./test/mocks/vscode.ts', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/unit/**/*.test.{ts,tsx}'],
          exclude: ['test/unit/webview/**'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'webview',
          environment: 'jsdom',
          include: ['test/unit/webview/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
});
