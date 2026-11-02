import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import * as vscodeMock from '../../mocks/vscode';
import type { GitService } from '../../../src/git/gitService';
import { RepoLocator } from '../../../src/git/repoLocator';
import { makeRepo, type TestRepo } from '../../helpers/repo';

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

let repos: TestRepo[] = [];
let extra: string[] = [];
let locators: RepoLocator[] = [];
beforeEach(() => {
  mock.workspace.workspaceFolders = undefined;
  mock.window.activeTextEditor = undefined;
  mock.extensions.getExtension = () => undefined;
  mock.window.showQuickPick = async () => undefined;
});
afterEach(async () => {
  locators.forEach((l) => l.dispose());
  await Promise.all(repos.map((r) => r.cleanup()));
  await Promise.all(extra.map((d) => rm(d, { recursive: true, force: true })));
  repos = [];
  extra = [];
  locators = [];
});
const repo = async () => {
  const r = await makeRepo();
  repos.push(r);
  return r;
};
const tmp = async () => {
  const d = await realpath(await mkdtemp(join(tmpdir(), 'ghp-loc-')));
  extra.push(d);
  return d;
};
const locator = (setting: string | null = null) => {
  const l = new RepoLocator(() => setting);
  locators.push(l);
  return l;
};
const uri = (p: string) => vscodeMock.Uri.file(p) as unknown as vscode.Uri;
const mock = vscodeMock; // writable view of the stubbed module state (real types are read-only)

function mockGitApi(roots: string[], gitPath = '/opt/mygit') {
  const open = new vscodeMock.EventEmitter<unknown>();
  const close = new vscodeMock.EventEmitter<unknown>();
  const api = {
    git: { path: gitPath },
    repositories: roots.map((r) => ({ rootUri: uri(r) })),
    onDidOpenRepository: open.event,
    onDidCloseRepository: close.event,
  };
  mock.extensions.getExtension = (id: string) =>
    id === 'vscode.git' ? { isActive: true, exports: { getAPI: () => api } } : undefined;
  return { api, open, close };
}

describe('RepoLocator.repoFor', () => {
  it('falls back to rev-parse when there is no git API', async () => {
    const r = await repo();
    await r.commit('sub/a.txt', 'x', 'c1');
    const svc = await locator().repoFor(uri(join(r.dir, 'sub', 'a.txt')));
    expect(svc?.root).toBe(await realpath(r.dir));
  });

  it('resolves a directory uri', async () => {
    const r = await repo();
    await r.commit('sub/a.txt', 'x', 'c1');
    const svc = await locator().repoFor(uri(join(r.dir, 'sub')));
    expect(svc?.root).toBe(await realpath(r.dir));
  });

  it('returns the realpath root for a file inside a symlinked folder (#786)', async () => {
    const r = await repo();
    await r.commit('a.txt', 'x', 'c1');
    const base = await tmp();
    const link = join(base, 'link');
    await symlink(r.dir, link);
    const svc = await locator().repoFor(uri(join(link, 'a.txt')));
    expect(svc?.root).toBe(await realpath(r.dir));
  });

  it('picks the inner repo of two nested repos via the git API (longest root)', async () => {
    const outer = await repo();
    await outer.commit('o.txt', 'x', 'c1');
    const innerDir = join(outer.dir, 'inner');
    await mkdir(innerDir);
    await outer.git('init', '-b', 'main', innerDir);
    await writeFile(join(innerDir, 'f.txt'), 'x');
    mockGitApi([outer.dir, innerDir]);
    const svc = await locator().repoFor(uri(join(innerDir, 'f.txt')));
    expect(svc?.root).toBe(await realpath(innerDir));
  });

  it('uses the git API path for the git binary', async () => {
    mockGitApi([], '/opt/mygit');
    expect(locator('/other/git').gitPath()).toBe('/opt/mygit');
    mock.extensions.getExtension = () => undefined;
    expect(locator('/other/git').gitPath()).toBe('/other/git');
    expect(locator(null).gitPath()).toBe('git');
  });

  it('returns undefined outside any repo', async () => {
    const d = await tmp();
    await writeFile(join(d, 'f.txt'), 'x');
    expect(await locator().repoFor(uri(join(d, 'f.txt')))).toBeUndefined();
  });

  it('resolves a file deleted from the work tree via its existing parent', async () => {
    const r = await repo();
    await r.commit('sub/gone.txt', 'x', 'c1');
    await rm(join(r.dir, 'sub', 'gone.txt'));
    expect((await locator().repoFor(uri(join(r.dir, 'sub', 'gone.txt'))))?.root).toBe(await realpath(r.dir));
    await rm(join(r.dir, 'sub'), { recursive: true });
    expect((await locator().repoFor(uri(join(r.dir, 'sub', 'gone.txt'))))?.root).toBe(await realpath(r.dir));
  });

  it('returns undefined for a missing path', async () => {
    const d = await tmp();
    expect(await locator().repoFor(uri(join(d, 'nope', 'f.txt')))).toBeUndefined();
  });

  it('handles paths with spaces and unicode', async () => {
    const r = await repo();
    await r.commit('dir ü/файл 名.txt', 'x', 'c1');
    const svc = await locator().repoFor(uri(join(r.dir, 'dir ü', 'файл 名.txt')));
    expect(svc?.root).toBe(await realpath(r.dir));
  });

  it('uses the active editor when no uri is given', async () => {
    const r = await repo();
    await r.commit('a.txt', 'x', 'c1');
    mock.window.activeTextEditor = { document: { uri: uri(join(r.dir, 'a.txt')) } };
    expect((await locator().repoFor())?.root).toBe(await realpath(r.dir));
  });

  it('falls back to workspace folders when no uri and no editor', async () => {
    const d = await tmp();
    const r = await repo();
    await r.commit('a.txt', 'x', 'c1');
    mock.workspace.workspaceFolders = [
      { uri: uri(d), name: 'd', index: 0 },
      { uri: uri(r.dir), name: 'r', index: 1 },
    ];
    expect((await locator().repoFor())?.root).toBe(await realpath(r.dir));
  });

  it('propagates non-128 git errors', async () => {
    const r = await repo();
    await r.commit('a.txt', 'x', 'c1');
    const l = new RepoLocator(() => '/definitely/not/git');
    locators.push(l);
    await expect(l.repoFor(uri(join(r.dir, 'a.txt')))).rejects.toThrow();
  });
});

describe.skipIf(process.platform !== 'win32')('RepoLocator Windows paths', () => {
  const flipDrive = (p: string): string =>
    /^[a-z]:/i.test(p)
      ? (p[0] === p[0]!.toUpperCase() ? p[0]!.toLowerCase() : p[0]!.toUpperCase()) + p.slice(1)
      : p;

  it('matches a git API root whose drive letter case differs from the file path (c:\\ vs C:\\)', async () => {
    const r = await repo();
    await r.commit('a.txt', 'x', 'c1');
    const real = await realpath(r.dir);
    mockGitApi([flipDrive(real)]);
    const svc = await locator().repoFor(uri(join(real, 'a.txt')));
    expect(svc?.root.toLowerCase()).toBe(real.toLowerCase());
  });

  it('resolves a file addressed through a UNC root (\\\\localhost\\C$\\...)', async (ctx) => {
    const r = await repo();
    await r.commit('a.txt', 'x', 'c1');
    const real = await realpath(r.dir);
    const unc = `\\\\localhost\\${real[0]}$${real.slice(2)}`;
    // The administrative share needs the Server service; CI runners usually don't offer it.
    if (!existsSync(join(unc, 'a.txt'))) return ctx.skip();
    const svc = await locator().repoFor(uri(join(unc, 'a.txt')));
    expect(svc).toBeDefined();
    expect(basename(svc!.root).toLowerCase()).toBe(basename(real).toLowerCase());
  });
});

describe('RepoLocator.service', () => {
  it('caches per realpath', async () => {
    const r = await repo();
    const base = await tmp();
    const link = join(base, 'l');
    await symlink(r.dir, link);
    const l = locator();
    expect(l.service(link)).toBe(l.service(r.dir));
    expect(l.service(r.dir).root).toBe(await realpath(r.dir));
  });
});

describe('RepoLocator.knownService', () => {
  it('returns undefined for a root it has never seen, and the cached service after service()', async () => {
    const r = await repo();
    const l = locator();
    expect(await l.knownService(r.dir)).toBeUndefined();
    const svc = l.service(r.dir);
    expect(await l.knownService(svc.root)).toBe(svc);
    expect(await l.knownService(r.dir)).toBe(svc); // the non-realpath spelling of the same root
  });
  it('knows the repositories vscode.git has open', async () => {
    const r = await repo();
    mockGitApi([r.dir]);
    expect((await locator().knownService(r.dir))?.root).toBe(await realpath(r.dir));
  });
  it('does not accept a subfolder or a missing path as a root', async () => {
    const r = await repo();
    await r.commit('sub/a.txt', 'x', 'c1');
    mockGitApi([r.dir]);
    const l = locator();
    expect(await l.knownService(join(r.dir, 'sub'))).toBeUndefined();
    expect(await l.knownService(join(r.dir, 'missing'))).toBeUndefined();
  });
});

describe('RepoLocator.pickRepo', () => {
  it('returns the only candidate without prompting', async () => {
    const r = await repo();
    mockGitApi([r.dir]);
    const spy = vi.fn(async () => undefined);
    mock.window.showQuickPick = spy;
    expect(((await locator().pickRepo(false)) as GitService).root).toBe(await realpath(r.dir));
    expect(spy).not.toHaveBeenCalled();
  });

  it('prompts when alwaysPrompt, with folder-name label and full-path description', async () => {
    const r = await repo();
    mockGitApi([r.dir]);
    const spy = vi.fn(async (items: unknown[]) => items[0]);
    mock.window.showQuickPick = spy as never;
    const svc = (await locator().pickRepo(true)) as GitService;
    expect(svc.root).toBe(await realpath(r.dir));
    const items = (spy.mock.calls[0] as unknown as [unknown])[0] as { label: string; description: string }[];
    expect(items[0]!.label).toBe(basename(await realpath(r.dir)));
    expect(items[0]!.description).toBe(await realpath(r.dir));
  });

  it("returns 'cancelled' on cancel and undefined with no candidates", async () => {
    const a = await repo();
    const b = await repo();
    mockGitApi([a.dir, b.dir]);
    expect(await locator().pickRepo(false)).toBe('cancelled');
    mock.extensions.getExtension = () => undefined;
    expect(await locator().pickRepo(false)).toBeUndefined();
  });

  it('uses workspace folders that are repos when there is no git API', async () => {
    const d = await tmp();
    const r = await repo();
    mock.workspace.workspaceFolders = [
      { uri: uri(d), name: 'd', index: 0 },
      { uri: uri(r.dir), name: 'r', index: 1 },
    ];
    expect(((await locator().pickRepo(false)) as GitService).root).toBe(await realpath(r.dir));
  });
});

describe('RepoLocator.onDidChangeRepositories', () => {
  it('subscribes lazily when the git API appears (or activates) after construction', async () => {
    const l = locator();
    const fn = vi.fn();
    l.onDidChangeRepositories(fn);
    const open = new vscodeMock.EventEmitter<unknown>();
    const api = {
      git: { path: 'git' },
      repositories: [],
      onDidOpenRepository: open.event,
      onDidCloseRepository: new vscodeMock.EventEmitter<unknown>().event,
    };
    let active = false;
    const ext = {
      get isActive() {
        return active;
      },
      get exports() {
        return active ? { getAPI: () => api } : undefined;
      },
      activate: async () => {
        active = true;
      },
    };
    mock.extensions.getExtension = () => ext;
    await l.repoFor(uri(await tmp()));
    open.fire({});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on extensions.onDidChange', async () => {
    const l = locator();
    const fn = vi.fn();
    l.onDidChangeRepositories(fn);
    const { open } = mockGitApi([]);
    vscodeMock.extensionsDidChange.fire();
    await new Promise((r) => setTimeout(r, 10));
    open.fire({});
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fires on open/close and stops after dispose', async () => {
    const { open, close } = mockGitApi([]);
    const l = locator();
    const fn = vi.fn();
    l.onDidChangeRepositories(fn);
    open.fire({});
    close.fire({});
    expect(fn).toHaveBeenCalledTimes(2);
    l.dispose();
    open.fire({});
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
