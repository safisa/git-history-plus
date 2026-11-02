import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { makeRepo, type TestRepo } from '../../helpers/repo';
import { GitService } from '../../../src/git/gitService';
import { runCommitAction } from '../../../src/history/actions';
import type { HandlerCtx } from '../../../src/history/requestHandler';
import type { Settings } from '../../../src/config';
import type { CommitAction } from '../../../src/shared/types';

let cfgDir: string;
let savedNoSystem: string | undefined;
let savedGlobal: string | undefined;
beforeAll(async () => {
  savedNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  savedGlobal = process.env.GIT_CONFIG_GLOBAL;
  cfgDir = await mkdtemp(join(tmpdir(), 'ghp-cfg-'));
  const empty = join(cfgDir, 'gitconfig');
  await writeFile(empty, '');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = empty;
});
afterAll(async () => {
  if (savedNoSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = savedNoSystem;
  if (savedGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = savedGlobal;
  await rm(cfgDir, { recursive: true, force: true });
});

let repo: TestRepo;
let ctx: HandlerCtx;
let hashes: string[];
let extra: string[] = [];
let warn: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  repo = await makeRepo();
  hashes = [];
  hashes.push(await repo.commit('a.txt', '1', 'one'));
  hashes.push(await repo.commit('a.txt', '2', 'two'));
  hashes.push(await repo.commit('a.txt', '3', 'three'));
  ctx = {
    svc: new GitService(repo.dir, 'git'),
    settings: {} as Settings,
    compare: {},
    avatars: undefined,
  };
  warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
  info = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
  error = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repo.cleanup();
  await Promise.all(extra.map((d) => rm(d, { recursive: true, force: true })));
  extra = [];
});

const head = async () => (await repo.git('rev-parse', 'HEAD')).trim();
const run = (a: CommitAction, hash: string, ref?: string) => runCommitAction(a, hash, ref, ctx);
const accept = (label: string) => warn.mockResolvedValueOnce(label);

describe('confirmations', () => {
  const cases: [CommitAction, string, string | undefined][] = [
    ['checkout', 'Checkout', undefined],
    ['revert', 'Revert', undefined],
    ['merge', 'Merge', 'topic'],
    ['rebase', 'Rebase', 'topic'],
    ['resetSoft', 'Reset', undefined],
    ['resetHard', 'Reset (Hard)', undefined],
    ['removeTag', 'Remove Tag', 'v1'],
    ['removeBranch', 'Remove Branch', 'topic'],
    ['removeRemoteBranch', 'Delete Remote Branch', 'origin/topic'],
  ];
  it.each(cases)('%s: cancelling changes nothing and uses a modal', async (action, label, ref) => {
    await repo.git('branch', 'topic', hashes[0]!);
    await repo.git('tag', 'v1', hashes[0]!);
    await repo.git('remote', 'add', 'origin', repo.dir);
    const before = await repo.git('for-each-ref');
    const headBefore = await head();
    expect(await run(action, hashes[0]!, ref)).toEqual({ changed: false });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toEqual({ modal: true });
    expect(warn.mock.calls[0]![2]).toBe(label);
    expect(await repo.git('for-each-ref')).toBe(before);
    expect(await head()).toBe(headBefore);
    expect(await repo.git('status', '--porcelain')).toBe('');
  });

  it('a different returned value counts as cancel', async () => {
    warn.mockResolvedValueOnce('Something else');
    expect(await run('resetHard', hashes[0]!)).toEqual({ changed: false });
    expect(await head()).toBe(hashes[2]);
  });

  it.each(['removeTag', 'removeBranch', 'removeRemoteBranch'] as const)('%s requires ref', async (a) => {
    await expect(run(a, hashes[0]!)).rejects.toThrow(/ref/i);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('actions', () => {
  it('resetHard warns about uncommitted changes and restores a dirty file', async () => {
    await writeFile(join(repo.dir, 'a.txt'), 'dirty');
    accept('Reset (Hard)');
    expect(await run('resetHard', hashes[2]!)).toEqual({ changed: true });
    expect(warn.mock.calls[0]![0]).toContain('discards all uncommitted changes');
    expect(await readFile(join(repo.dir, 'a.txt'), 'utf8')).toBe('3');
  });

  it('resetHard moves HEAD; resetSoft keeps the index', async () => {
    accept('Reset');
    await run('resetSoft', hashes[0]!);
    expect(await head()).toBe(hashes[0]);
    expect(await repo.git('status', '--porcelain')).toContain('M  a.txt');
    accept('Reset (Hard)');
    await run('resetHard', hashes[1]!);
    expect(await head()).toBe(hashes[1]);
  });

  it('checkout detaches at a hash, or checks out a ref', async () => {
    accept('Checkout');
    expect(await run('checkout', hashes[0]!)).toEqual({ changed: true });
    expect(await head()).toBe(hashes[0]);
    expect((await repo.git('branch', '--show-current')).trim()).toBe('');
    await repo.git('branch', 'topic', hashes[1]!);
    accept('Checkout');
    await run('checkout', hashes[1]!, 'topic');
    expect((await repo.git('branch', '--show-current')).trim()).toBe('topic');
  });

  it('revert creates a revert commit', async () => {
    accept('Revert');
    expect(await run('revert', hashes[2]!)).toEqual({ changed: true });
    expect(await readFile(join(repo.dir, 'a.txt'), 'utf8')).toBe('2');
  });

  it('cherryPick needs no confirmation', async () => {
    await repo.git('checkout', '-b', 'topic', hashes[0]!);
    await repo.commit('b.txt', 'b', 'on topic');
    const topicHead = await head();
    await repo.git('checkout', 'main');
    expect(await run('cherryPick', topicHead)).toEqual({ changed: true });
    expect(warn).not.toHaveBeenCalled();
    expect(await readFile(join(repo.dir, 'b.txt'), 'utf8')).toBe('b');
  });

  it('merge and rebase run against the ref', async () => {
    await repo.git('checkout', '-b', 'topic', hashes[0]!);
    await repo.commit('b.txt', 'b', 'on topic');
    await repo.git('checkout', 'main');
    accept('Merge');
    expect(await run('merge', hashes[0]!, 'topic')).toEqual({ changed: true });
    expect(await readFile(join(repo.dir, 'b.txt'), 'utf8')).toBe('b');
    await repo.git('checkout', '-b', 'other', hashes[0]!);
    await repo.commit('c.txt', 'c', 'on other');
    accept('Rebase');
    expect(await run('rebase', hashes[0]!, 'main')).toEqual({ changed: true });
    expect(await repo.git('merge-base', '--is-ancestor', 'main', 'other')).toBe('');
  });

  it('removeTag deletes the tag', async () => {
    await repo.git('tag', 'v1', hashes[0]!);
    accept('Remove Tag');
    expect(await run('removeTag', hashes[0]!, 'v1')).toEqual({ changed: true });
    expect(await repo.git('tag')).toBe('');
  });

  it('removeBranch deletes a merged branch with one prompt', async () => {
    await repo.git('branch', 'topic', hashes[0]!);
    accept('Remove Branch');
    expect(await run('removeBranch', hashes[0]!, 'topic')).toEqual({ changed: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await repo.git('branch', '--list', 'topic')).toBe('');
  });

  it('removeBranch on an unmerged branch asks a second time before -D', async () => {
    await repo.git('checkout', '-b', 'topic', hashes[0]!);
    await repo.commit('b.txt', 'b', 'unmerged');
    await repo.git('checkout', 'main');
    accept('Remove Branch');
    accept('Force Remove');
    expect(await run('removeBranch', hashes[0]!, 'topic')).toEqual({ changed: true });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![2]).toBe('Force Remove');
    expect(error).not.toHaveBeenCalled();
    expect(await repo.git('branch', '--list', 'topic')).toBe('');
  });

  it('declining the second prompt keeps the branch', async () => {
    await repo.git('checkout', '-b', 'topic', hashes[0]!);
    await repo.commit('b.txt', 'b', 'unmerged');
    await repo.git('checkout', 'main');
    accept('Remove Branch');
    expect(await run('removeBranch', hashes[0]!, 'topic')).toEqual({ changed: false });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(await repo.git('branch', '--list', 'topic')).toContain('topic');
  });

  it('removeRemoteBranch deletes the branch on a local bare remote', async () => {
    const bare = await mkdtemp(join(tmpdir(), 'ghp-bare-'));
    extra.push(bare);
    await repo.git('init', '--bare', '-b', 'main', bare);
    await repo.git('remote', 'add', 'origin', bare);
    await repo.git('push', 'origin', 'main:topic', 'main:feature/x');
    accept('Delete Remote Branch');
    expect(await run('removeRemoteBranch', hashes[0]!, 'origin/topic')).toEqual({ changed: true });
    accept('Delete Remote Branch');
    expect(await run('removeRemoteBranch', hashes[0]!, 'origin/feature/x')).toEqual({ changed: true });
    const refs = await repo.git('--git-dir', bare, 'for-each-ref', '--format=%(refname)');
    expect(refs).toBe('');
  });

  it('removeRemoteBranch with an unknown remote shows an error and changes nothing', async () => {
    accept('Delete Remote Branch');
    expect(await run('removeRemoteBranch', hashes[0]!, 'nope/topic')).toEqual({ changed: false });
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('checkout of a remote branch badge', () => {
  async function withRemote(): Promise<void> {
    const bare = await mkdtemp(join(tmpdir(), 'ghp-bare-'));
    extra.push(bare);
    await repo.git('init', '--bare', '-b', 'main', bare);
    await repo.git('remote', 'add', 'origin', bare);
    await repo.git('push', 'origin', `${hashes[1]!}:refs/heads/feature/x`);
    await repo.git('fetch', 'origin');
  }
  const currentBranch = async () => (await repo.git('rev-parse', '--abbrev-ref', 'HEAD')).trim();

  it('creates a local branch tracking it, and the confirmation says so', async () => {
    await withRemote();
    accept('Checkout');
    expect(await run('checkout', hashes[1]!, 'origin/feature/x')).toEqual({ changed: true });
    expect(warn.mock.calls[0]![0]).toMatch(/creates a local branch "feature\/x" that tracks it/);
    expect(await currentBranch()).toBe('feature/x');
    expect((await repo.git('rev-parse', '--abbrev-ref', 'feature/x@{upstream}')).trim()).toBe(
      'origin/feature/x',
    );
    expect(await head()).toBe(hashes[1]);
  });

  it('switches to the local branch when it already exists', async () => {
    await withRemote();
    await repo.git('branch', '--track', 'feature/x', 'origin/feature/x');
    accept('Checkout');
    expect(await run('checkout', hashes[1]!, 'origin/feature/x')).toEqual({ changed: true });
    expect(warn.mock.calls[0]![0]).toMatch(/switches to the existing local branch "feature\/x"/);
    expect(await currentBranch()).toBe('feature/x');
  });

  it('cancelling leaves HEAD on its branch (never detached)', async () => {
    await withRemote();
    expect(await run('checkout', hashes[1]!, 'origin/feature/x')).toEqual({ changed: false });
    expect(await currentBranch()).toBe('main');
  });
});

describe('createBranch / createTag', () => {
  const input = (value: string | undefined, seen: (string | undefined)[] = []) =>
    vi.spyOn(vscode.window, 'showInputBox').mockImplementation(async (o) => {
      if (value === undefined) return undefined;
      const msg = (await o?.validateInput?.(value)) as string | undefined | null;
      seen.push(msg ?? undefined);
      return msg ? undefined : value;
    });

  it.each(['bad..name', '', '-x', '--upload-pack=evil', 'a b', 'x.lock'])(
    'createBranch rejects %j via validation',
    async (v) => {
      const seen: (string | undefined)[] = [];
      input(v, seen);
      expect(await run('createBranch', hashes[0]!)).toEqual({ changed: false });
      expect(seen[0]).toBeTruthy();
      expect(await repo.git('branch', '--list')).not.toContain(v || 'zzz');
    },
  );

  it('createBranch creates at the hash and offers checkout', async () => {
    input('feature/y');
    info.mockResolvedValueOnce('Checkout');
    expect(await run('createBranch', hashes[0]!)).toEqual({ changed: true });
    expect((await repo.git('rev-parse', 'feature/y')).trim()).toBe(hashes[0]);
    expect(info.mock.calls[0]!.slice(1)).toContain('Checkout');
    expect((await repo.git('branch', '--show-current')).trim()).toBe('feature/y');
  });

  it('createBranch without accepting checkout stays put', async () => {
    input('feature/z');
    expect(await run('createBranch', hashes[0]!)).toEqual({ changed: true });
    expect((await repo.git('branch', '--show-current')).trim()).toBe('main');
  });

  it('cancelling the input box does nothing', async () => {
    input(undefined);
    expect(await run('createBranch', hashes[0]!)).toEqual({ changed: false });
    expect(await run('createTag', hashes[0]!)).toEqual({ changed: false });
  });

  it('createTag creates a lightweight tag; rejects bad names', async () => {
    const seen: (string | undefined)[] = [];
    input('v@{1', seen);
    expect(await run('createTag', hashes[0]!)).toEqual({ changed: false });
    expect(seen[0]).toBeTruthy();
    input('v1.0');
    expect(await run('createTag', hashes[0]!)).toEqual({ changed: true });
    expect((await repo.git('rev-parse', 'v1.0^{commit}')).trim()).toBe(hashes[0]);
    expect(info).not.toHaveBeenCalled();
  });

  it('a duplicate name shows an error and returns changed:false', async () => {
    await repo.git('branch', 'dup', hashes[0]!);
    input('dup');
    expect(await run('createBranch', hashes[0]!)).toEqual({ changed: false });
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('errors', () => {
  it('shows "Git History Plus: " + first stderr line and does not rethrow', async () => {
    accept('Checkout');
    expect(await run('checkout', hashes[0]!, 'no-such-ref')).toEqual({ changed: false });
    expect(error).toHaveBeenCalledTimes(1);
    const msg = error.mock.calls[0]![0] as string;
    expect(msg.startsWith('Git History Plus: ')).toBe(true);
    expect(msg).not.toContain('\n');
  });
});

describe('fix round 1', () => {
  it('checkout of a non-ref equal to a dirty tracked file leaves the file untouched', async () => {
    await writeFile(join(repo.dir, 'a.txt'), 'dirty');
    accept('Checkout');
    expect(await run('checkout', hashes[0]!, 'a.txt')).toEqual({ changed: false });
    expect(await readFile(join(repo.dir, 'a.txt'), 'utf8')).toBe('dirty');
    expect(error).toHaveBeenCalledTimes(1);
    expect(await head()).toBe(hashes[2]);
  });

  it('conflicting merge returns changed:true with a non-modal conflict warning', async () => {
    await repo.git('checkout', '-b', 'topic', hashes[0]!);
    await repo.commit('a.txt', 'topic', 'topic edit');
    await repo.git('checkout', 'main');
    accept('Merge');
    expect(await run('merge', hashes[0]!, 'topic')).toEqual({ changed: true });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0]).toBe(
      'Git History Plus: Merge stopped with conflicts — resolve them in Source Control.',
    );
    expect(warn.mock.calls[1]!.length).toBe(1);
    expect(error).not.toHaveBeenCalled();
  });

  it('conflicting cherry-pick returns changed:true with the conflict warning', async () => {
    await repo.git('checkout', '-b', 'topic', hashes[0]!);
    const t = await repo.commit('a.txt', 'topic', 'topic edit');
    await repo.git('checkout', 'main');
    expect(await run('cherryPick', t)).toEqual({ changed: true });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('Cherry-pick stopped with conflicts');
    expect(error).not.toHaveBeenCalled();
  });

  it('error text never contains CR or a trailing newline', async () => {
    accept('Checkout');
    await run('checkout', hashes[0]!, 'no-such-ref');
    const msg = error.mock.calls[0]![0] as string;
    expect(msg).not.toMatch(/\r|\n/);
  });

  it('createBranch stays changed:true when the offered checkout fails', async () => {
    vi.spyOn(vscode.window, 'showInputBox').mockResolvedValue('feat2');
    info.mockResolvedValueOnce('Checkout');
    await writeFile(join(repo.dir, 'a.txt'), 'dirty');
    await repo.git('add', 'a.txt');
    // checkout of feat2 (at an older commit) conflicts with the dirty index
    expect(await run('createBranch', hashes[0]!)).toEqual({ changed: true });
    expect(error).toHaveBeenCalledTimes(1);
  });
});
