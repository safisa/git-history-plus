import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface TestRepo {
  dir: string;
  git(...args: string[]): Promise<string>;
  commit(file: string, content: string, msg: string, env?: Record<string, string>): Promise<string>;
  cleanup(): Promise<void>;
}

/** An empty gitconfig file: `/dev/null` is not a valid GIT_CONFIG_GLOBAL on Windows. */
let emptyConfig: Promise<string> | undefined;
function emptyGitConfig(): Promise<string> {
  emptyConfig ??= mkdtemp(join(tmpdir(), 'ghp-gitcfg-')).then(async (d) => {
    const f = join(d, 'gitconfig');
    await writeFile(f, '');
    return f;
  });
  return emptyConfig;
}

async function run(dir: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const globalConfig = await emptyGitConfig();
  // Never let a host repository (e.g. when run from a git hook) leak into the scratch repo.
  const base = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete base[k];
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: dir,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...base,
          GIT_CONFIG_GLOBAL: globalConfig,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
          ...env,
        },
      },
      (err, stdout, stderr) =>
        err ? reject(new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`)) : resolve(stdout),
    );
  });
}

export async function makeRepo(opts: { sha256?: boolean } = {}): Promise<TestRepo> {
  const dir = await mkdtemp(join(tmpdir(), 'ghp-repo-'));
  try {
    await run(dir, ['init', '-b', 'main', ...(opts.sha256 ? ['--object-format=sha256'] : [])]);
    await run(dir, ['config', 'user.name', 'Test User']);
    await run(dir, ['config', 'user.email', 'test@example.com']);
    await run(dir, ['config', 'commit.gpgsign', 'false']);
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  return {
    dir,
    git: (...args) => run(dir, args),
    async commit(file, content, msg, env) {
      const full = join(dir, file);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, content);
      await run(dir, ['add', '--', file]);
      await run(dir, ['commit', '-m', msg], env);
      return (await run(dir, ['rev-parse', 'HEAD'])).trim();
    },
    // Windows may hold a just-exited git's handles for a moment (EBUSY): retry rather than fail.
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }),
  };
}
