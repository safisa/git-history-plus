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
          // These tests run git in scratch repositories; process start-up is slow on Windows. A test
          // that times out keeps running in the background, so a tight limit corrupts the next test.
          testTimeout: 30_000,
          hookTimeout: 30_000,
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
