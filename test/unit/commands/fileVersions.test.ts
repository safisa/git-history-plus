import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { makeRepo, type TestRepo } from '../../helpers/repo';
import { GitService } from '../../../src/git/gitService';
import { openHistoryDiff } from '../../../src/diff';
import { fromGitUri } from '../../../src/content/gitContentProvider';
import { nextVersion, previousVersion } from '../../../src/commands/fileVersions';

let repo: TestRepo;
let svc: GitService;
let exec: ReturnType<typeof vi.spyOn>;
let info: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  repo = await makeRepo();
  svc = new GitService(repo.dir, 'git');
  exec = vi
    .spyOn(vscode.commands, 'executeCommand')
    .mockImplementation(async (cmd: string, ...args: unknown[]) => {
      if (cmd === 'vscode.diff') {
        const right = args[1] as vscode.Uri;
        (vscode.window as { activeTextEditor: unknown }).activeTextEditor = { document: { uri: right } };
      }
      return undefined;
    });
  info = vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
  await repo.cleanup();
});

const diffCalls = () =>
  exec.mock.calls
    .filter((c: unknown[]) => c[0] === 'vscode.diff')
    .map((c: unknown[]) => ({ l: fromGitUri(c[1] as vscode.Uri), r: fromGitUri(c[2] as vscode.Uri) }));

describe('file version stepping', () => {
  it('previousVersion from index 0 diffs (history[2] <-> history[1]); next at newest informs', async () => {
    const h0 = await repo.commit('a.txt', '1\n', 'c1');
    const h1 = await repo.commit('a.txt', '2\n', 'c2');
    const h2 = await repo.commit('a.txt', '3\n', 'c3');
    const history = await svc.fileHistory('a.txt');
    expect(history).toEqual([h2, h1, h0]);
    await openHistoryDiff(svc, 'a.txt', history, 0);
    await previousVersion();
    const calls = diffCalls();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.l).toEqual({ root: repo.dir, path: 'a.txt', ref: h0 });
    expect(calls[1]!.r).toEqual({ root: repo.dir, path: 'a.txt', ref: h1 });

    // back to index 0, then next is the newest
    await nextVersion();
    expect(diffCalls()[2]!.r.ref).toBe(h2);
    await nextVersion();
    expect(info).toHaveBeenCalledWith('Already at the newest version');
    expect(diffCalls()).toHaveLength(3);
  });

  it('previous at the oldest version informs', async () => {
    await repo.commit('a.txt', '1\n', 'c1');
    const h1 = await repo.commit('a.txt', '2\n', 'c2');
    const history = await svc.fileHistory('a.txt');
    await openHistoryDiff(svc, 'a.txt', history, 1);
    expect(diffCalls()[0]!.l.ref).toBe('EMPTY');
    expect(diffCalls()[0]!.r.ref).not.toBe(h1);
    await previousVersion();
    expect(info).toHaveBeenCalledWith('Already at the oldest version');
  });

  it('does nothing harmful when the active editor is not a history diff', async () => {
    await previousVersion();
    expect(info).not.toHaveBeenCalled();
    expect(diffCalls()).toHaveLength(0);
  });

  it('steps across a rename using oldPath', async () => {
    const c0 = await repo.commit('a.txt', 'one\ntwo\nthree\nfour\n', 'add a');
    await repo.git('mv', 'a.txt', 'b.txt');
    await repo.git('commit', '-m', 'rename');
    const c1 = (await repo.git('rev-parse', 'HEAD')).trim();
    const c2 = await repo.commit('b.txt', 'one\ntwo\nthree\nfour\nfive\n', 'edit b');
    const history = await svc.fileHistory('b.txt');
    expect(history).toEqual([c2, c1, c0]);
    await openHistoryDiff(svc, 'b.txt', history, 0);
    await previousVersion();
    let last = diffCalls().at(-1)!;
    expect(last.l).toEqual({ root: repo.dir, path: 'a.txt', ref: c0 });
    expect(last.r).toEqual({ root: repo.dir, path: 'b.txt', ref: c1 });
    await previousVersion();
    last = diffCalls().at(-1)!;
    expect(last.l.ref).toBe('EMPTY');
    expect(last.r).toEqual({ root: repo.dir, path: 'a.txt', ref: c0 });
  });

  it('opens a deep version with one git call for the whole path chain, not details() per index', async () => {
    const hashes: string[] = [];
    for (let i = 0; i < 30; i++) hashes.unshift(await repo.commit('a.txt', `${i}\n`, `c${i}`));
    const fresh = new GitService(repo.dir, 'git');
    const run = vi.spyOn(fresh, 'run');
    const details = vi.spyOn(fresh, 'details');
    const history = await fresh.fileHistory('a.txt');
    expect(history).toEqual(hashes);
    await openHistoryDiff(fresh, 'a.txt', history, 25);
    expect(details).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
    const last = diffCalls().at(-1)!;
    expect(last.l).toEqual({ root: repo.dir, path: 'a.txt', ref: hashes[26] });
    expect(last.r).toEqual({ root: repo.dir, path: 'a.txt', ref: hashes[25] });
    await previousVersion();
    expect(details).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1); // the chain is cached per (root, path)
    expect(diffCalls().at(-1)!.r.ref).toBe(hashes[26]);
  });

  it('re-reads the chain after invalidate (a refresh), so a new commit is seen', async () => {
    await repo.commit('a.txt', '1\n', 'c1');
    expect(await svc.fileHistory('a.txt')).toHaveLength(1);
    const h2 = await repo.commit('a.txt', '2\n', 'c2');
    expect(await svc.fileHistory('a.txt')).toHaveLength(1); // cached
    svc.invalidate();
    expect((await svc.fileHistory('a.txt'))[0]).toBe(h2);
  });

  it('marks a deletion and an addition with EMPTY sides', async () => {
    const add = await repo.commit('a.txt', '1\n', 'add');
    await repo.git('rm', '-q', 'a.txt');
    await repo.git('commit', '-m', 'delete');
    const del = (await repo.git('rev-parse', 'HEAD')).trim();
    const history = await svc.fileHistory('a.txt');
    expect(history).toEqual([del, add]);
    await openHistoryDiff(svc, 'a.txt', history, 0);
    expect(diffCalls().at(-1)).toEqual({
      l: { root: repo.dir, path: 'a.txt', ref: add },
      r: { root: repo.dir, path: 'a.txt', ref: 'EMPTY' },
    });
    await openHistoryDiff(svc, 'a.txt', history, 1);
    expect(diffCalls().at(-1)!.l.ref).toBe('EMPTY');
  });
});
