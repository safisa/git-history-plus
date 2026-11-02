import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { makeRepo, type TestRepo } from '../helpers/repo';
import { GitService } from '../../src/git/gitService';
import { openHistoryDiff } from '../../src/diff';

// One version-diff tab per file history: each step replaces the previous version's tab.

interface FakeTab {
  input: { original: vscode.Uri; modified: vscode.Uri };
  isPinned: boolean;
  group: { viewColumn: number };
}

let repo: TestRepo;
let svc: GitService;
let tabs: FakeTab[];
let opened: { right: string; viewColumn?: number }[];
let close: ReturnType<typeof vi.fn>;
const group = { viewColumn: 2 };
const win = vscode.window as unknown as { tabGroups?: unknown };

beforeEach(async () => {
  repo = await makeRepo();
  svc = new GitService(repo.dir, 'git');
  tabs = [];
  opened = [];
  close = vi.fn(async (t: FakeTab) => {
    tabs = tabs.filter((x) => x !== t);
    return true;
  });
  win.tabGroups = {
    get all() {
      return [{ viewColumn: group.viewColumn, tabs }];
    },
    close,
  };
  vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(async (cmd: string, ...args: unknown[]) => {
    if (cmd !== 'vscode.diff') return undefined;
    const [left, right, , opts] = args as [vscode.Uri, vscode.Uri, string, { viewColumn?: number }];
    opened.push({ right: right.toString(), viewColumn: opts.viewColumn });
    if (!tabs.some((t) => t.input.modified.toString() === right.toString())) {
      tabs.push({ input: { original: left, modified: right }, isPinned: false, group });
    }
    return undefined;
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete win.tabGroups;
  await repo.cleanup();
});

async function threeVersions(file = 'a.txt') {
  for (const n of ['1', '2', '3']) await repo.commit(file, `${n}\n`, `${file} ${n}`);
  return svc.fileHistory(file);
}

describe('version diffs reuse one tab per file history', () => {
  it('stepping through versions leaves exactly one tab, opened where the previous one was', async () => {
    const history = await threeVersions();
    await openHistoryDiff(svc, 'a.txt', history, 0);
    await openHistoryDiff(svc, 'a.txt', history, 1);
    await openHistoryDiff(svc, 'a.txt', history, 2);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.input.modified.toString()).toBe(opened.at(-1)!.right);
    expect(close).toHaveBeenCalledTimes(2);
    expect(opened.slice(1).map((o) => o.viewColumn)).toEqual([2, 2]);
  });

  it('keeps a pinned version tab and opens the next version in a new one', async () => {
    const history = await threeVersions();
    await openHistoryDiff(svc, 'a.txt', history, 0);
    tabs[0]!.isPinned = true;
    await openHistoryDiff(svc, 'a.txt', history, 1);
    expect(tabs).toHaveLength(2);
    expect(close).not.toHaveBeenCalled();
  });

  it('keeps one tab per file: another file history does not replace it', async () => {
    const a = await threeVersions('a.txt');
    const b = await threeVersions('b.txt');
    await openHistoryDiff(svc, 'a.txt', a, 0);
    await openHistoryDiff(svc, 'b.txt', b, 0);
    expect(tabs).toHaveLength(2);
    expect(close).not.toHaveBeenCalled();
  });

  it('re-opening the version already shown keeps its tab', async () => {
    const history = await threeVersions();
    await openHistoryDiff(svc, 'a.txt', history, 1);
    await openHistoryDiff(svc, 'a.txt', history, 1);
    expect(tabs).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
  });

  it('opens a new tab when the previous one was already closed by the user', async () => {
    const history = await threeVersions();
    await openHistoryDiff(svc, 'a.txt', history, 0);
    tabs = [];
    await openHistoryDiff(svc, 'a.txt', history, 1);
    expect(tabs).toHaveLength(1);
    expect(close).not.toHaveBeenCalled();
    expect(opened.at(-1)!.viewColumn).toBeUndefined();
  });

  it('still opens diffs when the host has no tab API', async () => {
    delete win.tabGroups;
    const history = await threeVersions();
    await openHistoryDiff(svc, 'a.txt', history, 0);
    await openHistoryDiff(svc, 'a.txt', history, 1);
    expect(opened).toHaveLength(2);
  });
});
