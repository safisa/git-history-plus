import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { GitService } from '../../../src/git/gitService';
import { handleRequest, type HandlerCtx } from '../../../src/history/requestHandler';
import type { Settings } from '../../../src/config';
import { WORKTREE, type CommitDetails, type LogPage, type LogQuery } from '../../../src/shared/types';
import { makeRepo, type TestRepo } from '../../helpers/repo';

const repos: TestRepo[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const r of repos.splice(0)) await r.cleanup();
});

async function setup() {
  const r = await makeRepo();
  repos.push(r);
  await r.commit('a.txt', '1\n', 'one');
  await r.commit('docs/b.txt', 'b\n', 'two');
  const head = (await r.git('rev-parse', 'HEAD')).trim();
  return { r, svc: new GitService(r.dir, 'git'), head };
}
const q = (over: Partial<LogQuery> = {}): LogQuery => ({
  branch: { kind: 'current' },
  skip: 0,
  pageSize: 50,
  ...over,
});

describe('the uncommitted changes row', () => {
  it('a clean repository has none', async () => {
    const { svc } = await setup();
    const page = await svc.log(q(), false);
    expect(page.commits.map((c) => c.subject)).toEqual(['two', 'one']);
  });

  it('page one of the log starts with it, on top of HEAD, with its own graph row', async () => {
    const { r, svc, head } = await setup();
    await writeFile(join(r.dir, 'a.txt'), '1\n2\n');
    await writeFile(join(r.dir, 'new.txt'), 'new\n');
    const page = await svc.log(q(), false);
    expect(page.commits[0]).toMatchObject({
      hash: WORKTREE,
      parents: [head],
      subject: 'Uncommitted changes (2 files)',
    });
    expect(page.commits.slice(1).map((c) => c.subject)).toEqual(['two', 'one']);
    expect(page.graph).toHaveLength(3);
    expect(page.graph[0]!.lane).toBe(page.graph[1]!.lane);
  });

  it('only on page one of an unfiltered log of HEAD; a path keeps it to changes under that path', async () => {
    const { r, svc } = await setup();
    await writeFile(join(r.dir, 'a.txt'), 'changed\n');
    const has = async (over: Partial<LogQuery>) =>
      (await svc.log(q(over), false)).commits.some((c) => c.hash === WORKTREE);
    expect(await has({ branch: { kind: 'all' } })).toBe(true);
    expect(await has({ path: 'a.txt' })).toBe(true);
    expect(await has({ path: 'docs' })).toBe(false);
    expect(await has({ skip: 1 })).toBe(false);
    expect(await has({ text: 'one' })).toBe(false);
    expect(await has({ author: 'x' })).toBe(false);
    expect(await has({ since: '2000-01-01' })).toBe(false);
    expect(await has({ lines: { path: 'a.txt', start: 1, end: 1 } })).toBe(false);
    expect(await has({ branch: { kind: 'ref', ref: 'HEAD' } })).toBe(false);
    const one = await svc.log(q({ path: 'a.txt' }), false);
    expect(one.commits[0]!.subject).toBe('Uncommitted changes (1 file)');
  });

  it('details list staged, unstaged, deleted and untracked files against HEAD', async () => {
    const { r, svc, head } = await setup();
    await writeFile(join(r.dir, 'a.txt'), '1\n2\n');
    await rm(join(r.dir, 'docs', 'b.txt'));
    await mkdir(join(r.dir, 'src'));
    await writeFile(join(r.dir, 'src', 'new.ts'), 'x\n');
    await writeFile(join(r.dir, 'staged.txt'), 's\n');
    await r.git('add', 'staged.txt');
    const d = await svc.details(WORKTREE);
    expect(d.commit).toMatchObject({
      hash: WORKTREE,
      parents: [head],
      subject: 'Uncommitted changes (4 files)',
    });
    expect(d.files).toEqual([
      { status: 'M', path: 'a.txt', additions: 1, deletions: 0, binary: false },
      { status: 'D', path: 'docs/b.txt', additions: 0, deletions: 1, binary: false },
      { status: 'A', path: 'src/new.ts' },
      { status: 'A', path: 'staged.txt', additions: 1, deletions: 0, binary: false },
    ]);
  });
});

describe('the uncommitted changes row: robustness', () => {
  it('a git failure while listing them costs the row, never the history', async () => {
    const { r, svc } = await setup();
    await writeFile(join(r.dir, 'a.txt'), 'changed\n');
    const run = svc.run.bind(svc);
    vi.spyOn(svc, 'run').mockImplementation((args, opts) =>
      args.includes('ls-files') ? Promise.reject(new Error('broken submodule')) : run(args, opts),
    );
    const page = await svc.log(q(), false);
    expect(page.commits.map((c) => c.subject)).toEqual(['two', 'one']);
  });

  it('a failing status gives a stable fingerprint, not a change on every event', async () => {
    const { svc } = await setup();
    const run = svc.run.bind(svc);
    vi.spyOn(svc, 'run').mockImplementation((args, opts) =>
      args.includes('status') ? Promise.reject(new Error('broken submodule')) : run(args, opts),
    );
    expect(await svc.stateFingerprint()).toBe(await svc.stateFingerprint());
  });

  it('in folder history the row and its details count the same files: those under the folder', async () => {
    const { r, svc } = await setup();
    await writeFile(join(r.dir, 'a.txt'), 'changed\n');
    await writeFile(join(r.dir, 'docs', 'b.txt'), 'changed\n');
    await writeFile(join(r.dir, 'docs', 'new.txt'), 'new\n');
    const page = await svc.log(q({ path: 'docs' }), false);
    expect(page.commits[0]!.subject).toBe('Uncommitted changes (2 files)');
    const d = await svc.details(WORKTREE, 'docs');
    expect(d.files.map((f) => f.path)).toEqual(['docs/b.txt', 'docs/new.txt']);
    expect(d.commit.subject).toBe('Uncommitted changes (2 files)');
  });

  it('with all branches, its lane runs down to HEAD even when another branch is newer', async () => {
    const { r, svc, head } = await setup();
    await r.git('checkout', '-q', '-b', 'other');
    await r.commit('c.txt', 'c\n', 'three');
    await r.git('checkout', '-q', '-');
    await writeFile(join(r.dir, 'a.txt'), 'changed\n');
    const page = await svc.log(q({ branch: { kind: 'all' } }), false);
    expect(page.commits.map((c) => c.subject)).toEqual([
      'Uncommitted changes (1 file)',
      'three',
      'two',
      'one',
    ]);
    const at = page.commits.findIndex((c) => c.hash === head);
    expect(page.graph[at]!.lane).toBe(page.graph[0]!.lane);
    expect(page.graph[1]!.lane).not.toBe(page.graph[0]!.lane);
  });
});

describe('requests about the uncommitted changes', () => {
  const settings = { pageSize: 50, defaultMaxCount: 0, includeRemoteBranches: false } as Settings;
  const ctx = (svc: GitService, over: Partial<HandlerCtx> = {}): HandlerCtx => ({
    svc,
    settings,
    compare: {},
    avatars: undefined,
    ...over,
  });

  it('refuses whatever needs a real commit', async () => {
    const { svc } = await setup();
    for (const req of [
      { id: 1, type: 'action', action: 'checkout', hash: WORKTREE },
      { id: 2, type: 'containing', hash: WORKTREE },
      { id: 3, type: 'compareWithSelected', hash: WORKTREE },
      { id: 4, type: 'openFileAt', hash: WORKTREE, path: 'a.txt' },
    ] as const)
      await expect(handleRequest(req, ctx(svc))).rejects.toThrow('Uncommitted changes are not a commit');
  });

  it("opening a file diffs HEAD against the working tree; a deleted file's right side is empty", async () => {
    const { r, svc } = await setup();
    await writeFile(join(r.dir, 'a.txt'), '1\n2\n');
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await handleRequest(
      { id: 1, type: 'openDiff', hash: WORKTREE, file: { status: 'M', path: 'a.txt' } },
      ctx(svc),
    );
    const [cmd, left, right, title] = exec.mock.calls[0]! as [string, vscode.Uri, vscode.Uri, string];
    expect(cmd).toBe('vscode.diff');
    expect(right.scheme).toBe('file');
    expect(right.fsPath).toBe(join(svc.root, 'a.txt'));
    expect(left.scheme).not.toBe('file');
    expect(title).toBe('a.txt (HEAD ↔ working tree)');
    await handleRequest(
      { id: 2, type: 'openDiff', hash: WORKTREE, file: { status: 'D', path: 'docs/b.txt' } },
      ctx(svc),
    );
    expect((exec.mock.calls[1]![2] as vscode.Uri).scheme).not.toBe('file');
  });

  it('in file history its details focus the file, and Enter/double-click open its working-tree diff', async () => {
    const { r, svc } = await setup();
    await writeFile(join(r.dir, 'a.txt'), '1\n2\n');
    const file = ctx(svc, { mode: 'file', path: 'a.txt' });
    const d = (await handleRequest({ id: 1, type: 'details', hash: WORKTREE }, file)) as CommitDetails;
    expect(d.focusPath).toBe('a.txt');
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await handleRequest({ id: 2, type: 'openVersionDiff', hash: WORKTREE }, file);
    expect(exec.mock.calls[0]![3]).toBe('a.txt (HEAD ↔ working tree)');
    const page = (await handleRequest({ id: 3, type: 'log', query: q({ path: 'a.txt' }) }, file)) as LogPage;
    expect(page.commits[0]!.hash).toBe(WORKTREE);
  });
});
