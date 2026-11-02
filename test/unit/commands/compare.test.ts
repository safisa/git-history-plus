import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as vscode from 'vscode';
import { makeRepo, type TestRepo } from '../../helpers/repo';
import { GitService } from '../../../src/git/gitService';
import {
  compareFileWithRef,
  compareRefs,
  compareWithSelected,
  selectForComparison,
} from '../../../src/commands/compare';
import type { CompareState } from '../../../src/history/requestHandler';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const svcA = { root: '/repoA' } as unknown as GitService;
const svcB = { root: '/repoB' } as unknown as GitService;

afterEach(() => vi.restoreAllMocks());

describe('select / compareWithSelected', () => {
  let state: CompareState;
  let provider: { show: Mock<(svc: GitService, l: string, r: string) => Promise<void>> };
  let exec: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    state = {};
    provider = {
      show: vi.fn<(svc: GitService, l: string, r: string) => Promise<void>>().mockResolvedValue(undefined),
    };
    exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
  });

  it('select then compareWithSelected calls show(svc, selected, hash)', async () => {
    await selectForComparison(svcA, H1, state);
    expect(state.selected).toEqual({ root: '/repoA', hash: H1 });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Selected aaaaaaa for comparison');
    expect(exec).toHaveBeenCalledWith('setContext', 'gitHistoryPlus.hasSelection', true);
    await compareWithSelected(svcA, H2, state, provider);
    expect(provider.show).toHaveBeenCalledWith(svcA, H1, H2);
  });

  it('comparing across repos shows an error and does not update the tree', async () => {
    const err = vi.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);
    await selectForComparison(svcA, H1, state);
    await compareWithSelected(svcB, H2, state, provider);
    expect(err).toHaveBeenCalled();
    expect(provider.show).not.toHaveBeenCalled();
  });

  it('without a selection it tells the user and does nothing', async () => {
    await compareWithSelected(svcA, H2, state, provider);
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    expect(provider.show).not.toHaveBeenCalled();
  });
});

describe('compareRefs', () => {
  let repo: TestRepo;
  let svc: GitService;
  let c1: string;
  let c2: string;
  beforeEach(async () => {
    repo = await makeRepo();
    svc = new GitService(repo.dir, 'git');
    c1 = await repo.commit('a.txt', '1', 'one');
    await repo.git('tag', 'v1');
    c2 = await repo.commit('a.txt', '2', 'two');
    await repo.git('branch', 'feature');
  });
  afterEach(() => repo.cleanup());

  it('picks A (tag) then B (branch) from refs and shows the comparison', async () => {
    const provider = { show: vi.fn().mockResolvedValue(undefined) };
    const seen: string[][] = [];
    const qp = vi.spyOn(vscode.window, 'showQuickPick').mockImplementation((async (items: unknown[]) => {
      const list = items as { label: string }[];
      seen.push(list.map((i) => i.label));
      return seen.length === 1 ? list.find((i) => i.label === 'v1') : list.find((i) => i.label === 'feature');
    }) as never);
    await compareRefs(svc, provider);
    expect(qp).toHaveBeenCalledTimes(2);
    expect(seen[0]).toEqual(expect.arrayContaining(['main', 'feature', 'v1', 'Enter a commit hash…']));
    expect(provider.show).toHaveBeenCalledWith(svc, c1, c2);
  });

  it('"Enter a commit hash…" validates with resolveCommit', async () => {
    const provider = { show: vi.fn().mockResolvedValue(undefined) };
    vi.spyOn(vscode.window, 'showQuickPick').mockImplementation((async (items: unknown[]) => {
      const list = items as { label: string }[];
      return list.find((i) => i.label === 'Enter a commit hash…');
    }) as never);
    let validate: ((v: string) => unknown) | undefined;
    const ib = vi.spyOn(vscode.window, 'showInputBox').mockImplementation((async (o: {
      validateInput?: (v: string) => unknown;
    }) => {
      validate = o.validateInput;
      return ib.mock.calls.length === 1 ? c1.slice(0, 8) : c2;
    }) as never);
    await compareRefs(svc, provider);
    expect(await validate!('zzzz')).toEqual(expect.any(String));
    expect(await validate!(c1)).toBeUndefined();
    expect(provider.show).toHaveBeenCalledWith(svc, c1, c2);
  });

  it('cancelling does nothing', async () => {
    const provider = { show: vi.fn<(svc: GitService, l: string, r: string) => Promise<void>>() };
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);
    await compareRefs(svc, provider);
    expect(provider.show).not.toHaveBeenCalled();
  });
});

describe('compareFileWithRef', () => {
  let repo: TestRepo;
  let svc: GitService;
  let c1: string;
  beforeEach(async () => {
    repo = await makeRepo();
    svc = new GitService(repo.dir, 'git');
    c1 = await repo.commit('dir/a.txt', '1', 'one');
    await repo.git('tag', 'v1');
    await repo.commit('dir/a.txt', '2', 'two');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    return repo.cleanup();
  });

  it('diffs the picked tag against the working file, titled with the ref name', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockImplementation((async (items: unknown[]) =>
      (items as { label: string }[]).find((i) => i.label === 'v1')) as never);
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await compareFileWithRef(svc, 'dir/a.txt');
    const [cmd, left, right, title] = exec.mock.calls[0] as [string, vscode.Uri, vscode.Uri, string];
    expect(cmd).toBe('vscode.diff');
    expect(JSON.parse(left.query)).toEqual({ root: repo.dir, ref: c1 });
    expect(left.path).toBe('/dir/a.txt');
    expect(right.fsPath).toBe(vscode.Uri.file(join(repo.dir, 'dir', 'a.txt')).fsPath);
    expect(title).toBe('a.txt (v1 ↔ workspace)');
  });

  it('cancelling the pick opens nothing', async () => {
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    await compareFileWithRef(svc, 'dir/a.txt');
    expect(exec).not.toHaveBeenCalled();
  });
});
