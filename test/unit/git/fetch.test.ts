import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as vscodeMock from '../../mocks/vscode';
import { fetchAll } from '../../../src/git/fetch';
import { GitService } from '../../../src/git/gitService';
import { makeRepo, type TestRepo } from '../../helpers/repo';

let upstream: TestRepo;
let clone: TestRepo;
let cloneDir: string;

beforeEach(async () => {
  upstream = await makeRepo();
  await upstream.commit('a.txt', '1', 'one');
  cloneDir = await mkdtemp(join(tmpdir(), 'ghp-clone-'));
  clone = await makeRepo();
  await clone.git('remote', 'add', 'origin', upstream.dir);
  await clone.git('fetch', 'origin');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([upstream.cleanup(), clone.cleanup(), rm(cloneDir, { recursive: true, force: true })]);
});

describe('fetchAll', () => {
  it('without vscode.git, runs git fetch --all --prune itself', async () => {
    const two = await upstream.commit('a.txt', '2', 'two');
    await upstream.git('branch', 'gone');
    await clone.git('fetch', 'origin');
    await upstream.git('branch', '-D', 'gone');
    await fetchAll(new GitService(clone.dir, 'git'));
    const refs = await clone.git('for-each-ref', '--format=%(refname) %(objectname)', 'refs/remotes');
    expect(refs).toContain(`refs/remotes/origin/main ${two}`);
    expect(refs).not.toContain('origin/gone');
  });

  it('goes through vscode.git when it has the repository, so its credential prompts work', async () => {
    const fetch = vi.fn().mockResolvedValue(undefined);
    const getRepository = vi.fn().mockReturnValue({ fetch });
    vi.spyOn(vscodeMock.extensions, 'getExtension').mockReturnValue({
      isActive: true,
      exports: { getAPI: () => ({ getRepository }) },
    });
    const svc = new GitService(clone.dir, 'git');
    const run = vi.spyOn(svc, 'run');
    await fetchAll(svc);
    expect(getRepository).toHaveBeenCalledWith(vscode.Uri.file(clone.dir));
    expect(fetch).toHaveBeenCalledWith({ all: true, prune: true });
    expect(run).not.toHaveBeenCalled();
  });

  it('a failed fetch rejects with git’s message', async () => {
    await clone.git('remote', 'set-url', 'origin', join(cloneDir, 'missing'));
    await expect(fetchAll(new GitService(clone.dir, 'git'))).rejects.toThrow(/fetch/);
  });

  it('a vscode.git failure reports git’s stderr, not the error object', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValue({ message: 'Failed to execute git', stderr: 'fatal: no remote\n' });
    vi.spyOn(vscodeMock.extensions, 'getExtension').mockReturnValue({
      isActive: true,
      exports: { getAPI: () => ({ getRepository: () => ({ fetch }) }) },
    });
    await expect(fetchAll(new GitService(clone.dir, 'git'))).rejects.toThrow(/^fatal: no remote$/);
  });

  it('the plain-git fetch stops when the progress notification is cancelled', async () => {
    let cancel: (() => void) | undefined;
    vi.spyOn(vscodeMock.window, 'withProgress').mockImplementation((_o, task) =>
      task(
        {},
        {
          onCancellationRequested: (l: () => void) => {
            cancel = l;
            return { dispose: () => undefined };
          },
        },
      ),
    );
    const svc = new GitService(clone.dir, 'git');
    let signal: AbortSignal | undefined;
    vi.spyOn(svc, 'run').mockImplementation((_args, opts) => {
      signal = opts?.signal;
      return new Promise((_, reject) =>
        signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    });
    const done = fetchAll(svc);
    await Promise.resolve();
    cancel!();
    await expect(done).rejects.toThrow('aborted');
    expect(signal!.aborted).toBe(true);
  });
});
