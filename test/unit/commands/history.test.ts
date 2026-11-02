import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as vscodeMock from '../../mocks/vscode';
import { registerHistoryCommands } from '../../../src/commands/history';
import { RepoLocator } from '../../../src/git/repoLocator';
import { HistoryPanel } from '../../../src/history/historyPanel';
import type { LogQuery } from '../../../src/shared/types';
import { configValues } from '../../mocks/vscode';
import { makeRepo, type TestRepo } from '../../helpers/repo';

let cfgDir: string;
let saved: Record<string, string | undefined>;
beforeAll(async () => {
  saved = { nosys: process.env.GIT_CONFIG_NOSYSTEM, global: process.env.GIT_CONFIG_GLOBAL };
  cfgDir = await mkdtemp(join(tmpdir(), 'ghp-cfg-'));
  const empty = join(cfgDir, 'gitconfig');
  await writeFile(empty, '');
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CONFIG_GLOBAL = empty;
});
afterAll(async () => {
  if (saved.nosys === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
  else process.env.GIT_CONFIG_NOSYSTEM = saved.nosys;
  if (saved.global === undefined) delete process.env.GIT_CONFIG_GLOBAL;
  else process.env.GIT_CONFIG_GLOBAL = saved.global;
  await rm(cfgDir, { recursive: true, force: true });
});

const ctx = { extensionUri: vscode.Uri.file('/ext') } as unknown as vscode.ExtensionContext;
const uri = (p: string) => vscodeMock.Uri.file(p) as unknown as vscode.Uri;

let repo: TestRepo;
let extra: string[];
let locator: RepoLocator;
let commands: Map<string, (...args: unknown[]) => unknown>;
let show: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  repo = await makeRepo();
  await repo.commit('dir/a.txt', '1\n2\n', 'one');
  extra = [];
  commands = new Map();
  vi.spyOn(vscode.commands, 'registerCommand').mockImplementation((id, cb) => {
    commands.set(id, cb);
    return { dispose: () => undefined };
  });
  show = vi.spyOn(HistoryPanel, 'show').mockReturnValue(undefined as never);
  locator = new RepoLocator(() => null);
  registerHistoryCommands(ctx, locator);
});
afterEach(async () => {
  vi.restoreAllMocks();
  locator.dispose();
  vscodeMock.window.activeTextEditor = undefined;
  vscodeMock.workspace.workspaceFolders = undefined;
  for (const k of Object.keys(configValues)) delete configValues[k];
  await repo.cleanup();
  await Promise.all(extra.map((d) => rm(d, { recursive: true, force: true })));
});

const run = (id: string, arg?: unknown) => commands.get(`gitHistoryPlus.${id}`)!(arg) as Promise<void>;
const shownQuery = () => (show.mock.calls.at(-1) as unknown[])[3] as LogQuery;

describe('history commands: repo-relative paths (#786)', () => {
  it('viewFileHistory through a symlinked folder passes the repo-relative path', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ghp-link-')));
    extra.push(base);
    const link = join(base, 'link');
    await symlink(repo.dir, link);
    await run('viewFileHistory', uri(join(link, 'dir', 'a.txt')));
    expect(show).toHaveBeenCalledTimes(1);
    expect(shownQuery().path).toBe('dir/a.txt');
  });

  it('viewFileHistory with a non-realpath spelling of the repo (macOS /var -> /private/var)', async () => {
    // tmpdir() is a symlinked path on macOS; elsewhere this still checks the plain case.
    await run('viewFileHistory', uri(join(repo.dir, 'dir', 'a.txt')));
    expect(shownQuery().path).toBe('dir/a.txt');
  });

  it('viewLineHistory through a symlinked folder passes the repo-relative path', async () => {
    const base = await realpath(await mkdtemp(join(tmpdir(), 'ghp-link-')));
    extra.push(base);
    const link = join(base, 'link');
    await symlink(repo.dir, link);
    await run('viewLineHistory', uri(join(link, 'dir', 'a.txt')));
    expect(shownQuery().lines).toEqual({ path: 'dir/a.txt', start: 1, end: 1 });
  });
});

describe('viewHistory repository choice', () => {
  it('uses the rootUri of the SourceControl passed by the scm/title button (#12)', async () => {
    const other = await makeRepo();
    extra.push(other.dir);
    await other.commit('x.txt', 'x', 'x');
    await run('viewHistory', { id: 'git', label: 'Git', rootUri: uri(other.dir) });
    expect(show).toHaveBeenCalledTimes(1);
    expect((show.mock.calls[0] as unknown[])[1]).toMatchObject({ root: await realpath(other.dir) });
  });

  it('shows nothing when the repository quick pick is cancelled (#13)', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage');
    const pick = vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue(undefined);
    configValues.alwaysPromptRepositoryPicker = true;
    vscodeMock.workspace.workspaceFolders = [{ uri: vscodeMock.Uri.file(repo.dir), name: 'r', index: 0 }];
    await run('viewHistory');
    expect(pick).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });

  it("opens the workspace's repository when the active editor shows something outside any (the user settings, a stray file)", async () => {
    vscodeMock.workspace.workspaceFolders = [{ uri: vscodeMock.Uri.file(repo.dir), name: 'r', index: 0 }];
    const warn = vi.spyOn(vscode.window, 'showWarningMessage');
    for (const active of [
      vscodeMock.Uri.from({ scheme: 'vscode-userdata', path: '/user/settings.json' }),
      vscodeMock.Uri.file(join(tmpdir(), 'not-a-repo.txt')),
    ]) {
      show.mockClear();
      vscodeMock.window.activeTextEditor = { document: { uri: active } };
      await run('viewHistory');
      expect(warn).not.toHaveBeenCalled();
      expect(show).toHaveBeenCalledTimes(1);
      expect((show.mock.calls[0] as unknown[])[1]).toMatchObject({ root: await realpath(repo.dir) });
    }
    vscodeMock.window.activeTextEditor = undefined;
  });

  it('still warns when there is no repository to pick', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);
    await run('viewHistory');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toMatch(/no git repository found/);
  });
});

describe('folder history', () => {
  const shownMode = () => (show.mock.calls.at(-1) as unknown[])[2];

  it('viewFolderHistory opens folder history for the folder, without --follow', async () => {
    await run('viewFolderHistory', uri(join(repo.dir, 'dir')));
    expect(shownMode()).toBe('folder');
    expect(shownQuery().path).toBe('dir');
    expect(shownQuery().follow).toBeUndefined();
  });

  it('viewFileHistory given a folder (Explorer on a folder) opens folder history', async () => {
    await run('viewFileHistory', uri(join(repo.dir, 'dir')));
    expect(shownMode()).toBe('folder');
    expect(shownQuery().path).toBe('dir');
  });

  it('the repository root folder opens the repository history', async () => {
    await run('viewFolderHistory', uri(repo.dir));
    expect(shownMode()).toBe('repo');
    expect(shownQuery().path).toBeUndefined();
  });

  it('a file still opens file history', async () => {
    await run('viewFileHistory', uri(join(repo.dir, 'dir', 'a.txt')));
    expect(shownMode()).toBe('file');
    expect(shownQuery().follow).toBe(true);
  });
});
