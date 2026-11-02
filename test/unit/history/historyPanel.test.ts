import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { configValues, type MockWebview } from '../../mocks/vscode';
import * as nodePath from 'node:path';
import { HistoryPanel, baseName } from '../../../src/history/historyPanel';
import * as requestHandler from '../../../src/history/requestHandler';
import { logger } from '../../../src/logger';
import type { GitService } from '../../../src/git/gitService';
import type { LogQuery } from '../../../src/shared/types';

interface MockPanel {
  webview: MockWebview;
  dispose(): void;
}

const query: LogQuery = { branch: { kind: 'current' }, skip: 0, pageSize: 100 };
const ctx = { extensionUri: vscode.Uri.file('/ext') } as unknown as vscode.ExtensionContext;
const svc = { root: '/work/my-repo', invalidate: vi.fn() } as unknown as GitService;

let panels: MockPanel[];
let posts: unknown[];

beforeEach(() => {
  panels = [];
  posts = [];
  const orig = vscode.window.createWebviewPanel;
  vi.spyOn(vscode.window, 'createWebviewPanel').mockImplementation((...args) => {
    const p = orig(...args) as unknown as MockPanel;
    p.webview.postMessage = async (m) => {
      posts.push(m);
      return true;
    };
    panels.push(p);
    return p as unknown as vscode.WebviewPanel;
  });
});
afterEach(() => {
  for (const p of panels) p.dispose();
  for (const k of Object.keys(configValues)) delete configValues[k];
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('HistoryPanel message boundary', () => {
  it('answers an invalid request that has an integer id with ok:false, and logs a warning', async () => {
    const warn = vi.spyOn(logger, 'warn');
    HistoryPanel.show(ctx, svc, 'repo', query);
    panels[0]!.webview.receive({ id: 1, type: 'log', query: 'nope' });
    panels[0]!.webview.receive({ id: 2, type: 'log', query: { ...query, pageSize: 5000 } });
    await flush();
    expect(posts).toEqual([
      { id: 1, ok: false, error: 'Invalid request' },
      { id: 2, ok: false, error: 'Invalid request' },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('drops a message without an integer id silently (nothing to answer), and logs a warning', async () => {
    const warn = vi.spyOn(logger, 'warn');
    HistoryPanel.show(ctx, svc, 'repo', query);
    panels[0]!.webview.receive('garbage');
    panels[0]!.webview.receive({ id: 1.5, type: 'refs' });
    panels[0]!.webview.receive({ id: '3', type: 'refs' });
    await flush();
    expect(posts).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('posts init on ready with mode, query, settings and repoName', async () => {
    configValues.dateFormat = 'iso';
    configValues.avatars = 'gravatar';
    (vscode.env as { language: string }).language = 'de';
    HistoryPanel.show(ctx, svc, 'repo', query);
    panels[0]!.webview.receive({ type: 'ready' });
    await flush();
    expect(posts).toEqual([
      {
        type: 'init',
        mode: 'repo',
        query,
        settings: {
          dateFormat: 'iso',
          avatars: 'gravatar',
          locale: 'de',
          issueLinks: [],
          dimMergeCommits: true,
        },
        repoName: 'my-repo',
        layout: {},
      },
    ]);
    (vscode.env as { language: string }).language = 'en';
  });

  it('init carries the remembered layout, without the malformed parts', async () => {
    const stored: Record<string, unknown> = {
      'gitHistoryPlus.layout': { panelWidth: 420, columns: { author: 9000, hash: 80 }, fileTree: 'x' },
    };
    const withState = {
      ...ctx,
      globalState: { get: (k: string) => stored[k], update: async () => undefined },
    } as unknown as vscode.ExtensionContext;
    HistoryPanel.show(withState, svc, 'repo', { ...query, path: 'layout-a' });
    panels[0]!.webview.receive({ type: 'ready' });
    await flush();
    expect(posts[0]).toMatchObject({ type: 'init', layout: { panelWidth: 420, columns: { hash: 80 } } });
    expect((posts[0] as { layout: object }).layout).not.toHaveProperty('fileTree');
  });

  it('reports handler failures as {id, ok:false, error} with no stack trace', async () => {
    vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    vi.spyOn(requestHandler, 'handleRequest').mockRejectedValue(new Error('boom'));
    HistoryPanel.show(ctx, svc, 'repo', query);
    panels[0]!.webview.receive({ id: 7, type: 'refs' });
    await flush();
    expect(posts).toEqual([{ id: 7, ok: false, error: 'boom' }]);
    expect(JSON.stringify(posts)).not.toContain('\n    at ');
  });

  it('returns the same instance for the same key, a new one after dispose', () => {
    const a = HistoryPanel.show(ctx, svc, 'repo', query);
    expect(HistoryPanel.show(ctx, svc, 'repo', query)).toBe(a);
    expect(panels).toHaveLength(1);
    expect(HistoryPanel.show(ctx, svc, 'file', { ...query, path: 'a.txt' })).not.toBe(a);
    panels[0]!.dispose();
    const b = HistoryPanel.show(ctx, svc, 'repo', query);
    expect(b).not.toBe(a);
    expect(panels).toHaveLength(3);
  });
  it('keys line-history panels by range: same range reuses, a different range opens a new panel', () => {
    const line = (start: number, end: number): LogQuery => ({
      ...query,
      lines: { path: 'a.txt', start, end },
    });
    const a = HistoryPanel.show(ctx, svc, 'line', line(1, 3));
    expect(HistoryPanel.show(ctx, svc, 'line', line(1, 3))).toBe(a);
    const b = HistoryPanel.show(ctx, svc, 'line', line(5, 9));
    expect(b).not.toBe(a);
    expect(panels).toHaveLength(2);
  });

  it('never posts or throws after the panel is disposed, and tolerates a throwing postMessage', async () => {
    const a = HistoryPanel.show(ctx, svc, 'repo', query);
    panels[0]!.webview.postMessage = () => {
      throw new Error('Webview is disposed');
    };
    expect(() => a.refresh()).not.toThrow();
    posts.length = 0;
    panels[0]!.webview.postMessage = async (m) => {
      posts.push(m);
      return true;
    };
    panels[0]!.dispose();
    a.refresh();
    await flush();
    expect(posts).toEqual([]);
  });

  it("refreshForRoot refreshes only that repo's panels and reports whether any is open", () => {
    const invalidate = vi.fn();
    const other = { root: '/work/other', invalidate } as unknown as GitService;
    HistoryPanel.show(ctx, svc, 'repo', query);
    expect(HistoryPanel.hasPanelFor('/work/my-repo')).toBe(true);
    expect(HistoryPanel.hasPanelFor('/work/other')).toBe(false);
    HistoryPanel.refreshForRoot('/work/other');
    expect(invalidate).not.toHaveBeenCalled();
    HistoryPanel.show(ctx, other, 'repo', query);
    HistoryPanel.refreshForRoot('/work/other');
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('refreshes after a successful action response with changed:true, not otherwise', async () => {
    const handle = vi.spyOn(requestHandler, 'handleRequest');
    const invalidate = vi.fn();
    const s = { root: '/work/act', invalidate } as unknown as GitService;
    HistoryPanel.show(ctx, s, 'repo', query);
    const action = { type: 'action', action: 'resetHard', hash: 'abc123' };
    handle.mockResolvedValueOnce({ changed: false });
    panels[0]!.webview.receive({ id: 1, ...action });
    await flush();
    expect(posts).toEqual([{ id: 1, ok: true, result: { changed: false } }]);
    expect(invalidate).not.toHaveBeenCalled();
    posts.length = 0;
    handle.mockResolvedValueOnce({ changed: true });
    panels[0]!.webview.receive({ id: 2, ...action });
    await flush();
    expect(posts).toEqual([{ id: 2, ok: true, result: { changed: true } }, { type: 'refresh' }]);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe('HistoryPanel settings push', () => {
  it('pushSettings posts the current view settings to every open panel', async () => {
    HistoryPanel.show(ctx, svc, 'repo', query);
    HistoryPanel.show(ctx, svc, 'file', { ...query, path: 'a.txt' });
    configValues.dateFormat = 'iso';
    configValues.avatars = 'github';
    HistoryPanel.pushSettings();
    await flush();
    const settings = {
      dateFormat: 'iso',
      avatars: 'github',
      locale: 'en',
      issueLinks: [],
      dimMergeCommits: true,
    };
    expect(posts).toEqual([
      { type: 'settings', settings },
      { type: 'settings', settings },
    ]);
  });
});

describe('panel titles (#14)', () => {
  it('names the panel after the repo folder or the file, with a trailing separator tolerated', () => {
    const titles = () =>
      (vscode.window.createWebviewPanel as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
        (c) => c[1],
      );
    HistoryPanel.show(
      ctx,
      { root: '/work/my-repo/', invalidate: vi.fn() } as unknown as GitService,
      'repo',
      query,
    );
    HistoryPanel.show(ctx, svc, 'file', { ...query, path: 'dir/sub/a.txt' });
    expect(titles()).toEqual(['Git History (my-repo)', 'Git History (a.txt)']);
  });

  it('baseName uses the platform path rules (Windows roots use backslashes)', () => {
    expect(baseName('C:\\work\\repo', nodePath.win32)).toBe('repo');
    expect(baseName('C:\\work\\repo\\', nodePath.win32)).toBe('repo');
    expect(baseName('/work/repo/', nodePath.posix)).toBe('repo');
    expect(baseName('dir/a.txt', nodePath.win32)).toBe('a.txt');
    expect(baseName('/', nodePath.posix)).toBe('/');
  });
});

describe('panel icon', () => {
  it('gives the history tab a light and dark icon, so it stays visible when docked in a side bar', () => {
    HistoryPanel.show(ctx, svc, 'repo', { ...query, path: 'icon-test' });
    const p = panels.at(-1) as unknown as { iconPath?: { light: vscode.Uri; dark: vscode.Uri } };
    expect(p.iconPath?.light.path).toBe('/ext/images/history-light.svg');
    expect(p.iconPath?.dark.path).toBe('/ext/images/history-dark.svg');
  });

  it('after a fetch, refreshes every panel of that repository and no other', async () => {
    vi.spyOn(requestHandler, 'handleRequest').mockResolvedValue(undefined);
    const mine = vi.fn();
    const theirs = vi.fn();
    const a = { root: '/work/fetch', invalidate: mine } as unknown as GitService;
    const b = { root: '/work/elsewhere', invalidate: theirs } as unknown as GitService;
    HistoryPanel.show(ctx, a, 'repo', query);
    HistoryPanel.show(ctx, a, 'file', { ...query, path: 'x.txt' });
    HistoryPanel.show(ctx, b, 'repo', query);
    panels[0]!.webview.receive({ id: 1, type: 'fetch' });
    await flush();
    expect(mine).toHaveBeenCalledTimes(2);
    expect(theirs).not.toHaveBeenCalled();
  });

  it('a folder-history panel tracks no file: its requests carry mode folder and no path', async () => {
    const handle = vi.spyOn(requestHandler, 'handleRequest').mockResolvedValue(undefined);
    HistoryPanel.show(ctx, { root: '/work/folder', invalidate: vi.fn() } as unknown as GitService, 'folder', {
      ...query,
      path: 'src',
    });
    panels[0]!.webview.receive({ id: 1, type: 'refs' });
    await flush();
    expect(handle.mock.calls[0]![1]).toMatchObject({ mode: 'folder', path: undefined });
  });
});
