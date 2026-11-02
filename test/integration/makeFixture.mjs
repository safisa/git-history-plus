import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { FIXTURE_ROOT, NOREPO_DIR, REPO_DIR } from './fixture.mjs';

rmSync(FIXTURE_ROOT, { recursive: true, force: true });
mkdirSync(REPO_DIR, { recursive: true });
mkdirSync(NOREPO_DIR, { recursive: true });
writeFileSync(join(NOREPO_DIR, 'plain.txt'), 'not in a repo\n');

// An empty file: '/dev/null' is not a valid GIT_CONFIG_GLOBAL on Windows.
const emptyConfig = join(FIXTURE_ROOT, 'gitconfig');
writeFileSync(emptyConfig, '');
const env = { ...process.env };
for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete env[k];
Object.assign(env, {
  GIT_CONFIG_GLOBAL: emptyConfig,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
});
const git = (...args) => execFileSync('git', args, { cwd: REPO_DIR, env, stdio: 'pipe' });
git('init', '-b', 'main');
git('config', 'user.name', 'Test User');
git('config', 'user.email', 'test@example.com');
git('config', 'commit.gpgsign', 'false');
for (const [i, name] of ['one', 'two', 'three'].entries()) {
  writeFileSync(join(REPO_DIR, 'alpha.txt'), `${name}\nline2\nline3\n`);
  writeFileSync(join(REPO_DIR, `file${i}.txt`), name);
  if (name === 'two') {
    mkdirSync(join(REPO_DIR, 'docs'), { recursive: true });
    writeFileSync(join(REPO_DIR, 'docs', 'guide.txt'), name); // folder history
  }
  git('add', '.');
  git('commit', '-m', `commit ${name}`);
}

// The suite is TypeScript: bundle it for mocha (vscode is provided by the host).
await esbuild.build({
  entryPoints: ['test/integration/commands.test.ts', 'test/integration/security.test.ts'],
  outdir: 'out/test/integration',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'warning',
});
