import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: !production,
  logLevel: 'info',
};

const extension = {
  ...common,
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
};

const webview = {
  ...common,
  entryPoints: ['webview/main.tsx'],
  outfile: 'dist/webview.js',
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.ttf': 'file', '.woff': 'file', '.woff2': 'file' },
  assetNames: '[name]',
};

if (watch) {
  const contexts = await Promise.all([esbuild.context(extension), esbuild.context(webview)]);
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('watching...');
} else {
  await Promise.all([esbuild.build(extension), esbuild.build(webview)]);
}
