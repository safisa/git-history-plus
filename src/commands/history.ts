import { stat } from 'node:fs/promises';
import * as vscode from 'vscode';
import { normalizeUriArg } from '../args';
import { getConfig } from '../config';
import type { GitService } from '../git/gitService';
import { relPath, type RepoLocator } from '../git/repoLocator';
import { HistoryPanel } from '../history/historyPanel';
import type { LogQuery } from '../shared/types';

const REFRESH_DEBOUNCE_MS = 500;

interface RepoStateLike {
  rootUri: vscode.Uri;
  state: { onDidChange: vscode.Event<unknown> };
}

function baseQuery(): LogQuery {
  const { pageSize, defaultMaxCount } = getConfig();
  return {
    branch: { kind: 'current' },
    skip: 0,
    pageSize,
    ...(defaultMaxCount > 0 ? { maxCount: defaultMaxCount } : {}),
  };
}

async function isFolder(uri: vscode.Uri): Promise<boolean> {
  if (uri.scheme !== 'file') return false;
  try {
    return (await stat(uri.fsPath)).isDirectory();
  } catch {
    return false;
  }
}

async function warnNoRepo(target: vscode.Uri | undefined): Promise<void> {
  const where = target?.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'the workspace';
  await vscode.window.showWarningMessage(`Git History Plus: no git repository found for ${where}`);
}

export function registerHistoryCommands(
  ctx: vscode.ExtensionContext,
  locator: RepoLocator,
): vscode.Disposable[] {
  const fileTarget = (arg: unknown): vscode.Uri | undefined =>
    normalizeUriArg(arg) ?? vscode.window.activeTextEditor?.document.uri;

  /**
   * The repository of the given resource (SCM title button, Explorer), else of the active editor's
   * file, else the workspace's (the only one, or a pick). The active editor is only a hint: when it
   * shows something outside any repository (the user settings, a past version, an untitled file) the
   * status bar button and the shortcut still open the workspace's history.
   */
  const viewHistory = async (arg?: unknown): Promise<void> => {
    const given = normalizeUriArg(arg);
    const active = vscode.window.activeTextEditor?.document.uri;
    const editorFile = !given && active?.scheme === 'file' ? active : undefined;
    const { alwaysPromptRepositoryPicker } = getConfig();
    const svc = alwaysPromptRepositoryPicker
      ? await locator.pickRepo(true)
      : given
        ? await locator.repoFor(given)
        : ((editorFile && (await locator.repoFor(editorFile))) ?? (await locator.pickRepo(false)));
    if (svc === 'cancelled') return; // the user dismissed the picker: nothing to report
    if (!svc) return warnNoRepo(given);
    HistoryPanel.show(ctx, svc, 'repo', baseQuery());
  };

  /** A folder's history is every commit touching anything under it; `--follow` only works for one file. */
  const showFolder = async (svc: GitService, uri: vscode.Uri): Promise<void> => {
    const rel = await relPath(svc, uri);
    if (rel === '') HistoryPanel.show(ctx, svc, 'repo', baseQuery());
    else HistoryPanel.show(ctx, svc, 'folder', { ...baseQuery(), path: rel });
  };

  // The Explorer passes folders too: those get folder history.
  const viewFileHistory = async (arg?: unknown): Promise<void> => {
    const uri = fileTarget(arg);
    const svc = uri ? await locator.repoFor(uri) : undefined;
    if (!uri || !svc) return warnNoRepo(uri);
    if (await isFolder(uri)) return showFolder(svc, uri);
    HistoryPanel.show(ctx, svc, 'file', { ...baseQuery(), path: await relPath(svc, uri), follow: true });
  };

  const viewFolderHistory = async (arg?: unknown): Promise<void> => {
    const uri = normalizeUriArg(arg);
    const svc = uri ? await locator.repoFor(uri) : undefined;
    if (!uri || !svc) return warnNoRepo(uri);
    return showFolder(svc, uri);
  };

  const viewLineHistory = async (arg?: unknown): Promise<void> => {
    const editor = vscode.window.activeTextEditor;
    const uri = normalizeUriArg(arg) ?? editor?.document.uri;
    const svc = uri ? await locator.repoFor(uri) : undefined;
    if (!uri || !svc) return warnNoRepo(uri);
    const sel = editor && editor.document.uri.toString() === uri.toString() ? editor.selection : undefined;
    const start = (sel?.start.line ?? 0) + 1;
    let end = (sel?.end.line ?? 0) + 1;
    // A selection ending at column 0 of the next line does not include that line.
    if (sel && !sel.isEmpty && sel.end.character === 0 && end > start) end -= 1;
    HistoryPanel.show(ctx, svc, 'line', {
      ...baseQuery(),
      lines: { path: await relPath(svc, uri), start, end },
    });
  };

  return [
    vscode.commands.registerCommand('gitHistoryPlus.viewHistory', viewHistory),
    vscode.commands.registerCommand('gitHistoryPlus.viewFileHistory', viewFileHistory),
    vscode.commands.registerCommand('gitHistoryPlus.viewFolderHistory', viewFolderHistory),
    vscode.commands.registerCommand('gitHistoryPlus.viewLineHistory', viewLineHistory),
    vscode.commands.registerCommand('gitHistoryPlus.refresh', () => HistoryPanel.refreshAll()),
  ];
}

/**
 * Refreshes a repo's open panels 500 ms after the last vscode.git state change, but only when the
 * repo's history fingerprint (HEAD, refs, current branch) moved: vscode.git fires on every status run
 * (each save or focus), and a reload for nothing would reset the view. Repos are subscribed lazily as
 * vscode.git opens them. A fingerprint that cannot be computed counts as a change. While a repo has no
 * history panel open nothing is computed for it; the first check after one opens then refreshes it.
 */
export function watchRepositoryState(
  locator: RepoLocator,
  getRepos: () => RepoStateLike[],
  fingerprint: (svc: GitService) => Promise<string> = (svc) => svc.stateFingerprint(),
): vscode.Disposable & { sync(): void } {
  const subscribed = new Map<string, vscode.Disposable>();
  const timers = new Map<string, NodeJS.Timeout>();
  const fingerprints = new Map<string, Promise<string | undefined>>();
  let disposed = false;

  const take = (rootPath: string): Promise<string | undefined> => {
    const p = fingerprint(locator.service(rootPath)).catch(() => undefined);
    fingerprints.set(rootPath, p);
    return p;
  };

  const hasPanel = (rootPath: string) => HistoryPanel.hasPanelFor(locator.service(rootPath).root);

  const check = async (rootPath: string): Promise<void> => {
    if (!hasPanel(rootPath)) {
      fingerprints.delete(rootPath); // nothing to keep fresh; a later baseline would be stale anyway
      return;
    }
    const before = await fingerprints.get(rootPath);
    const after = await take(rootPath);
    if (disposed || (after !== undefined && after === before)) return;
    const root = locator.service(rootPath).root;
    if (HistoryPanel.hasPanelFor(root)) HistoryPanel.refreshForRoot(root);
  };

  const schedule = (rootPath: string): void => {
    clearTimeout(timers.get(rootPath));
    timers.set(
      rootPath,
      setTimeout(() => {
        timers.delete(rootPath);
        void check(rootPath);
      }, REFRESH_DEBOUNCE_MS),
    );
  };

  const sync = (): void => {
    for (const repo of getRepos()) {
      const rootPath = repo.rootUri.fsPath;
      if (subscribed.has(rootPath)) continue;
      if (hasPanel(rootPath)) void take(rootPath); // the baseline the first status run is compared with
      subscribed.set(
        rootPath,
        repo.state.onDidChange(() => schedule(rootPath)),
      );
    }
  };
  sync();
  const sub = locator.onDidChangeRepositories(sync);
  return {
    sync,
    dispose() {
      disposed = true;
      sub.dispose();
      subscribed.forEach((d) => d.dispose());
      timers.forEach((t) => clearTimeout(t));
      subscribed.clear();
      timers.clear();
      fingerprints.clear();
    },
  };
}
