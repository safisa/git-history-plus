import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_MAX_BUFFER, GitError, resolveGitPath, runGit, runGitBuffer } from '../../../src/git/exec';
import { makeRepo, type TestRepo } from '../../helpers/repo';

describe('git exec', () => {
  let repo: TestRepo;
  beforeEach(async () => {
    repo = await makeRepo();
  });
  afterEach(async () => {
    await repo.cleanup();
  });

  it('returns stdout of rev-parse --show-toplevel', async () => {
    const out = await runGit('git', repo.dir, ['rev-parse', '--show-toplevel']);
    expect(resolve(out.trim())).toBe(await realpath(repo.dir)); // git prints C:/… on Windows
  });

  it('rejects with GitError carrying exitCode, stderr and args', async () => {
    const args = ['rev-parse', '--verify', 'nope'];
    const err = await runGit('git', repo.dir, args).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitError);
    const ge = err as GitError;
    expect(ge.exitCode).not.toBe(0);
    expect(ge.stderr).toContain('fatal');
    expect(ge.args).toEqual(args);
  });

  it('passes args without a shell', async () => {
    await repo.commit('a.txt', 'hi', 'c1');
    await expect(
      runGit('git', repo.dir, ['log', '--format=%s', '--', 'a b;rm -rf x']),
    ).resolves.toBeDefined();
  });

  it('closes stdin when no input is given, so a command that reads it cannot hang', async () => {
    const out = await runGit('git', repo.dir, ['hash-object', '--stdin']);
    expect(out.trim()).toMatch(/^e69de29bb2d1d6434b8b29ae775ad8c2e48c5391$|^[0-9a-f]{64}$/); // the empty blob
  }, 5000);

  it('defaults maxBuffer to 256 MB', () => {
    expect(DEFAULT_MAX_BUFFER).toBe(256 * 1024 * 1024);
  });

  it('honours maxBuffer and input', async () => {
    const out = await runGit('git', repo.dir, ['hash-object', '--stdin'], { input: 'hello\n' });
    expect(out.trim()).toMatch(/^[0-9a-f]{40}$/);
    await expect(runGit('git', repo.dir, ['--version'], { maxBuffer: 1 })).rejects.toBeInstanceOf(GitError);
  });

  it('runGitBuffer returns binary-safe bytes', async () => {
    const hash = await repo.commit('a.txt', 'hi', 'c1');
    const buf = await runGitBuffer('git', repo.dir, ['cat-file', 'blob', `${hash}:a.txt`]);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf8')).toBe('hi');
  });

  it('resolveGitPath picks first truthy else git', () => {
    expect(resolveGitPath(undefined, null)).toBe('git');
    expect(resolveGitPath('', '')).toBe('git');
    expect(resolveGitPath('/a', '/b')).toBe('/a');
    expect(resolveGitPath(undefined, '/b')).toBe('/b');
  });
});

describe('makeRepo', () => {
  it('commits with env overrides, supports sha256, and cleans up', async () => {
    const repo = await makeRepo({ sha256: true });
    const hash = await repo.commit('f', 'x', 'm', {
      GIT_AUTHOR_NAME: 'Zed',
      GIT_AUTHOR_DATE: '2020-01-02T03:04:05Z',
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await repo.git('log', '-1', '--format=%an|%at')).trim()).toBe('Zed|1577934245');
    await repo.cleanup();
    await expect(realpath(repo.dir)).rejects.toThrow();
  });
});
