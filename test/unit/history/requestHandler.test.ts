import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { makeRepo, type TestRepo } from '../../helpers/repo';
import { GitError } from '../../../src/git/exec';
import { GitService } from '../../../src/git/gitService';
import { handleRequest, type HandlerCtx } from '../../../src/history/requestHandler';
import * as diff from '../../../src/diff';
import * as actions from '../../../src/history/actions';
import type { Settings } from '../../../src/config';
import type { LogPage, CommitDetails, Containing, Ref } from '../../../src/shared/types';

const settings: Settings = {
  alwaysPromptRepositoryPicker: false,
  includeRemoteBranches: false,
  showEditorTitleMenuBarIcons: true,
  editorTitleButtonOpenRepo: false,
  pageSize: 2,
  hideCommitViewExplorer: false,
  hideCompareCommitViewExplorer: false,
  logLevel: 'Info',
  sourceCodeProviderIntegrationLocation: 'Inline',
  dateFormat: 'relative',
  avatars: 'off',
  defaultMaxCount: 0,
  issueLinks: [],
  dimMergeCommits: true,
  showStatusBarItem: true,
};

let repo: TestRepo;
let svc: GitService;
let hashes: string[];
const ctx = (over: Partial<HandlerCtx> = {}): HandlerCtx => ({
  svc,
  settings,
  compare: {},
  avatars: undefined,
  ...over,
});

beforeEach(async () => {
  repo = await makeRepo();
  hashes = [];
  hashes.push(
    await repo.commit('a.txt', '1', 'one', {
      GIT_AUTHOR_NAME: 'Alice',
      GIT_AUTHOR_EMAIL: 'alice@example.com',
    }),
  );
  hashes.push(await repo.commit('b.txt', '2', 'two'));
  hashes.push(await repo.commit('a.txt', '3', 'three'));
  svc = new GitService(repo.dir, 'git');
});
afterEach(async () => {
  vi.restoreAllMocks();
  await repo.cleanup();
});

describe('handleRequest', () => {
  it('log returns a LogPage with graph aligned to commits, using settings.pageSize', async () => {
    const page = (await handleRequest(
      { id: 1, type: 'log', query: { branch: { kind: 'current' }, skip: 0, pageSize: 999 } },
      ctx(),
    )) as LogPage;
    expect(page.commits).toHaveLength(2);
    expect(page.graph.length).toBe(page.commits.length);
    expect(page.hasMore).toBe(true);
  });
  it('log with a count answers at least that many commits, and never fewer than a page', async () => {
    const query = { branch: { kind: 'current' } as const, skip: 0, pageSize: 2 };
    const all = (await handleRequest({ id: 1, type: 'log', query, count: 3 }, ctx())) as LogPage;
    expect(all.commits.map((c) => c.subject)).toEqual(['three', 'two', 'one']);
    expect(all.graph).toHaveLength(3);
    expect(all.hasMore).toBe(false);
    const small = (await handleRequest({ id: 2, type: 'log', query, count: 1 }, ctx())) as LogPage;
    expect(small.commits).toHaveLength(2);
    expect(small.hasMore).toBe(true);
  });
  it('log applies defaultMaxCount only when the query has none', async () => {
    const q = { branch: { kind: 'current' } as const, skip: 0, pageSize: 100 };
    const a = (await handleRequest(
      { id: 1, type: 'log', query: q },
      ctx({ settings: { ...settings, pageSize: 100, defaultMaxCount: 1 } }),
    )) as LogPage;
    expect(a.commits).toHaveLength(1);
    const b = (await handleRequest(
      { id: 2, type: 'log', query: { ...q, maxCount: 3 } },
      ctx({ settings: { ...settings, pageSize: 100, defaultMaxCount: 1 } }),
    )) as LogPage;
    expect(b.commits).toHaveLength(3);
  });
  it('details returns files', async () => {
    const d = (await handleRequest({ id: 1, type: 'details', hash: hashes[2]! }, ctx())) as CommitDetails;
    expect(d.files.map((f) => f.path)).toEqual(['a.txt']);
  });
  it('refs returns refs', async () => {
    const r = (await handleRequest({ id: 1, type: 'refs' }, ctx())) as Ref[];
    expect(r.some((x) => x.name === 'main')).toBe(true);
  });
  it('authors returns authors', async () => {
    const a = (await handleRequest({ id: 1, type: 'authors' }, ctx())) as unknown[];
    expect(Array.isArray(a)).toBe(true);
    expect(JSON.stringify(a)).toContain('Alice');
  });
  it('openDiff passes the first parent (undefined for root), as a preview unless pinned', async () => {
    const spy = vi.spyOn(diff, 'openDiff').mockResolvedValue(undefined);
    const file = { status: 'M' as const, path: 'a.txt' };
    await handleRequest({ id: 1, type: 'openDiff', hash: hashes[2]!, file }, ctx());
    expect(spy).toHaveBeenLastCalledWith(svc, hashes[2], hashes[1], file, false);
    await handleRequest({ id: 2, type: 'openDiff', hash: hashes[0]!, file, pinned: true }, ctx());
    expect(spy).toHaveBeenLastCalledWith(svc, hashes[0], undefined, file, true);
  });

  it('a diff opens as a preview tab, or pinned when asked', async () => {
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const file = { status: 'M' as const, path: 'a.txt' };
    await handleRequest({ id: 1, type: 'openDiff', hash: hashes[2]!, file }, ctx());
    await handleRequest({ id: 2, type: 'openDiff', hash: hashes[2]!, file, pinned: true }, ctx());
    expect(exec.mock.calls.map((c) => c[4])).toEqual([{ preview: true }, { preview: false }]);
  });
  it('openFileAt and compareWithWorkspace delegate', async () => {
    const o = vi.spyOn(diff, 'openFileAt').mockResolvedValue(undefined);
    const c = vi.spyOn(diff, 'compareWithWorkspace').mockResolvedValue(undefined);
    await handleRequest({ id: 1, type: 'openFileAt', hash: hashes[2]!, path: 'a.txt' }, ctx());
    await handleRequest({ id: 2, type: 'compareWithWorkspace', hash: hashes[2]!, path: 'a.txt' }, ctx());
    expect(o).toHaveBeenCalledWith(svc, hashes[2], 'a.txt');
    expect(c).toHaveBeenCalledWith(svc, hashes[2], 'a.txt');
  });
  it('copy writes to the clipboard', async () => {
    const spy = vi.spyOn(vscode.env.clipboard, 'writeText').mockResolvedValue(undefined);
    await handleRequest({ id: 1, type: 'copy', text: 'hello' }, ctx());
    expect(spy).toHaveBeenCalledWith('hello');
  });
  it('avatars returns {} without a provider, else delegates', async () => {
    expect(await handleRequest({ id: 1, type: 'avatars', emails: ['a@b.c'] }, ctx())).toEqual({});
    const get = vi.fn().mockResolvedValue({ 'a@b.c': 'data:image/png;base64,AA' });
    expect(
      await handleRequest({ id: 2, type: 'avatars', emails: ['a@b.c'] }, ctx({ avatars: { get } })),
    ).toEqual({
      'a@b.c': 'data:image/png;base64,AA',
    });
    expect(get).toHaveBeenCalledWith(['a@b.c']);
  });
  it('compare requests run the gitHistoryPlus commands with the panel root', async () => {
    const spy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const c = ctx();
    await handleRequest({ id: 1, type: 'compareRefs' }, c);
    expect(spy).toHaveBeenCalledWith('gitHistoryPlus.compareRefs', c.svc.root);
    await handleRequest({ id: 2, type: 'selectForComparison', hash: hashes[0]! }, c);
    expect(spy).toHaveBeenCalledWith('gitHistoryPlus.selectForComparison', hashes[0], c.svc.root);
    await handleRequest({ id: 3, type: 'compareWithSelected', hash: hashes[1]! }, c);
    expect(spy).toHaveBeenCalledWith('gitHistoryPlus.compareWithSelected', hashes[1], c.svc.root);
  });

  it('details in file mode name the tracked file as of that commit, following renames', async () => {
    await repo.git('mv', 'a.txt', 'renamed.txt');
    await repo.git('commit', '-m', 'rename');
    const c = ctx({ mode: 'file', path: 'renamed.txt' });
    const newest = (await handleRequest({ id: 1, type: 'details', hash: hashes[2]! }, c)) as CommitDetails;
    expect(newest.focusPath).toBe('a.txt');
    const repoMode = (await handleRequest(
      { id: 2, type: 'details', hash: hashes[2]! },
      ctx(),
    )) as CommitDetails;
    expect(repoMode.focusPath).toBeUndefined();
  });

  it('openVersionDiff opens the stepping diff for that version of the tracked file', async () => {
    const spy = vi.spyOn(diff, 'openHistoryDiff').mockResolvedValue(undefined);
    const c = ctx({ mode: 'file', path: 'a.txt' });
    await handleRequest({ id: 1, type: 'openVersionDiff', hash: hashes[0]! }, c);
    expect(spy).toHaveBeenCalledWith(c.svc, 'a.txt', [hashes[2], hashes[0]], 1);
  });

  it('openVersionDiff fails clearly outside file and line history', async () => {
    await expect(handleRequest({ id: 1, type: 'openVersionDiff', hash: hashes[0]! }, ctx())).rejects.toThrow(
      /file or line history/,
    );
  });

  it('showInCommitView runs gitHistoryPlus.commitView.show with the panel root and hash', async () => {
    const spy = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined);
    const c = ctx();
    expect(await handleRequest({ id: 1, type: 'showInCommitView', hash: hashes[1]! }, c)).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('gitHistoryPlus.commitView.show', c.svc.root, hashes[1]);
  });
  it('refreshRepo invalidates the refs cache so the next refs call sees new refs', async () => {
    const before = (await handleRequest({ id: 1, type: 'refs' }, ctx())) as Ref[];
    expect(before.some((r) => r.name === 'added-later')).toBe(false);
    await repo.git('branch', 'added-later');
    const cached = (await handleRequest({ id: 2, type: 'refs' }, ctx())) as Ref[];
    expect(cached.some((r) => r.name === 'added-later')).toBe(false); // still cached
    expect(await handleRequest({ id: 3, type: 'refreshRepo' }, ctx())).toBeUndefined();
    const after = (await handleRequest({ id: 4, type: 'refs' }, ctx())) as Ref[];
    expect(after.some((r) => r.name === 'added-later')).toBe(true);
  });

  it('action delegates to runCommitAction and returns its result', async () => {
    const spy = vi.spyOn(actions, 'runCommitAction').mockResolvedValue({ changed: true });
    const c = ctx();
    const r = await handleRequest(
      { id: 1, type: 'action', action: 'removeTag', hash: hashes[0]!, ref: 'v1' },
      c,
    );
    expect(r).toEqual({ changed: true });
    expect(spy).toHaveBeenCalledWith('removeTag', hashes[0], 'v1', c);
  });
});

describe('handleRequest: me, head, openExternal', () => {
  it('me answers the configured git user, or undefined without an email', async () => {
    // Repository config wins over the global one, so this never reads the machine's own identity.
    await repo.git('config', 'user.name', 'Safi');
    await repo.git('config', 'user.email', 'safi@example.com');
    expect(await handleRequest({ id: 1, type: 'me' }, ctx())).toEqual({
      name: 'Safi',
      email: 'safi@example.com',
    });
    // `git config --get` exits 1 for a key that is set nowhere.
    vi.spyOn(svc, 'run').mockRejectedValue(new GitError('not set', 1, '', []));
    expect(await handleRequest({ id: 1, type: 'me' }, ctx())).toBeUndefined();
  });

  it('me answers the identity .mailmap maps the configured one to', async () => {
    await repo.git('config', 'user.name', 'Old Name');
    await repo.git('config', 'user.email', 'old@example.com');
    await writeFile(join(repo.dir, '.mailmap'), 'Proper <proper@example.com> <old@example.com>\n');
    expect(await handleRequest({ id: 1, type: 'me' }, ctx())).toEqual({
      name: 'Proper',
      email: 'proper@example.com',
    });
  });

  it('head answers the HEAD commit', async () => {
    expect(await handleRequest({ id: 1, type: 'head' }, ctx())).toBe(hashes[2]);
  });

  it('containing lists the branches (local, then remote, no HEAD alias) and tags that include a commit', async () => {
    await repo.git('branch', 'old', hashes[0]!);
    await repo.git('tag', 'v1', hashes[1]!);
    await repo.git('update-ref', 'refs/remotes/origin/main', hashes[2]!);
    await repo.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const main = (await repo.git('branch', '--show-current')).trim();
    expect(await handleRequest({ id: 1, type: 'containing', hash: hashes[1]! }, ctx())).toEqual({
      branches: [main, 'origin/main'],
      tags: ['v1'],
      branchCount: 2,
      tagCount: 1,
    });
    expect(await handleRequest({ id: 2, type: 'containing', hash: hashes[0]! }, ctx())).toMatchObject({
      branches: [main, 'old', 'origin/main'].sort(),
      branchCount: 3,
    });
  });

  it('containing caps the names at 50 but counts them all', async () => {
    for (let i = 0; i < 55; i++) await repo.git('tag', `t${String(i).padStart(2, '0')}`, hashes[2]!);
    const c = (await handleRequest({ id: 1, type: 'containing', hash: hashes[2]! }, ctx())) as Containing;
    expect(c.tags).toHaveLength(50);
    expect(c.tagCount).toBe(55);
  });

  it('saveLayout merges into the layout remembered in global state', async () => {
    let stored: unknown = { panelWidth: 300, columns: { author: 90 }, bogus: 1 };
    const state = {
      get: () => stored,
      keys: () => [],
      update: vi.fn(async (_k: string, v: unknown) => void (stored = v)),
    } as unknown as vscode.Memento;
    await handleRequest({ id: 1, type: 'saveLayout', layout: { columns: { date: 150 } } }, ctx({ state }));
    expect(state.update).toHaveBeenCalledWith('gitHistoryPlus.layout', {
      panelWidth: 300,
      columns: { author: 90, date: 150 },
    });
    await handleRequest({ id: 2, type: 'saveLayout', layout: { fileTree: true } }, ctx({ state }));
    expect(stored).toEqual({ panelWidth: 300, columns: { author: 90, date: 150 }, fileTree: true });
  });

  it('openExternal opens the link', async () => {
    const open = vi.spyOn(vscode.env, 'openExternal').mockResolvedValue(true);
    await handleRequest({ id: 1, type: 'openExternal', url: 'https://jira.example.com/browse/A-1' }, ctx());
    expect(String(open.mock.calls[0]![0])).toBe('https://jira.example.com/browse/A-1');
  });
});

describe('handleRequest: folder history', () => {
  it('details carry no focusPath and openVersionDiff is refused', async () => {
    const d = (await handleRequest(
      { id: 1, type: 'details', hash: hashes[2]! },
      ctx({ mode: 'folder' }),
    )) as CommitDetails;
    expect(d.focusPath).toBeUndefined();
    await expect(
      handleRequest({ id: 2, type: 'openVersionDiff', hash: hashes[2]! }, ctx({ mode: 'folder' })),
    ).rejects.toThrow('openVersionDiff needs file or line history');
  });
});
