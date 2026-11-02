import * as vscode from 'vscode';
import { CONTEXT_KEYS, NS, VIEW_IDS } from '../constants';
import { normalizeUriArg } from '../args';
import { compareFiles, compareWithWorkspace, openDiff, short } from '../diff';
import type { GitService } from '../git/gitService';
import { relPath, type RepoLocator } from '../git/repoLocator';
import type { CompareState } from '../history/requestHandler';
import type { FileChange, Hash } from '../shared/types';
import { CommitTreeProvider } from '../views/commitTree';
import { CompareCommitsTreeProvider, type ChangesTreeProvider } from '../views/compareTree';

/** The single source of truth for the "select for comparison" state, shared with the history panel. */
export const compareState: CompareState = {};

const setContext = (key: string, value: boolean): Thenable<unknown> =>
  vscode.commands.executeCommand('setContext', key, value);

export async function selectForComparison(svc: GitService, hash: Hash, state: CompareState): Promise<void> {
  state.selected = { root: svc.root, hash };
  await setContext(CONTEXT_KEYS.hasSelection, true);
  // Not awaited: the promise only settles when the notification is dismissed.
  void vscode.window.showInformationMessage(`Selected ${short(hash)} for comparison`);
}

export async function compareWithSelected(
  svc: GitService,
  hash: Hash,
  state: CompareState,
  provider: Pick<CompareCommitsTreeProvider, 'show'>,
): Promise<void> {
  const sel = state.selected;
  if (!sel) {
    void vscode.window.showInformationMessage('Select a commit for comparison first.');
    return;
  }
  if (sel.root !== svc.root) {
    void vscode.window.showErrorMessage('Cannot compare commits from different repositories.');
    return;
  }
  await provider.show(svc, sel.hash, hash);
}

interface RefItem extends vscode.QuickPickItem {
  hash?: Hash;
  enter?: boolean;
}

const ENTER_HASH = 'Enter a commit hash…';

/** The picked commit and how to name it (the ref name, or the short hash of a typed revision). */
async function pickRev(
  svc: GitService,
  items: RefItem[],
  placeHolder: string,
): Promise<{ hash: Hash; label: string } | undefined> {
  const picked = (await vscode.window.showQuickPick(items, { placeHolder })) as RefItem | undefined;
  if (!picked) return undefined;
  if (!picked.enter) return picked.hash ? { hash: picked.hash, label: picked.label } : undefined;
  const text = await vscode.window.showInputBox({
    prompt: 'Commit hash or revision',
    validateInput: async (v) => ((await svc.resolveCommit(v.trim())) ? undefined : 'Not a known commit'),
  });
  const hash = text ? await svc.resolveCommit(text.trim()) : undefined;
  return hash ? { hash, label: short(hash) } : undefined;
}

/** Every branch, remote branch and tag, then "Enter a commit hash…". */
async function refItems(svc: GitService): Promise<RefItem[]> {
  const refs = await svc.refs();
  return [
    ...refs
      .filter((r) => r.kind !== 'head')
      .map((r) => ({ label: r.name, description: `${r.kind} • ${short(r.target)}`, hash: r.target })),
    { label: ENTER_HASH, enter: true },
  ];
}

export async function compareRefs(
  svc: GitService,
  provider: Pick<CompareCommitsTreeProvider, 'show'>,
): Promise<void> {
  const items = await refItems(svc);
  const a = (await pickRev(svc, items, 'Compare: pick the first commit, branch or tag'))?.hash;
  if (!a) return;
  const b = (await pickRev(svc, items, `Compare ${short(a)} with…`))?.hash;
  if (!b) return;
  await provider.show(svc, a, b);
}

/** Diffs `path` (repo-relative) as of a picked branch, tag or commit against the working file. */
export async function compareFileWithRef(svc: GitService, path: string): Promise<void> {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const picked = await pickRev(svc, await refItems(svc), `Compare ${base} with the version in…`);
  if (picked) await compareWithWorkspace(svc, picked.hash, path, picked.label);
}

/** Creates both Explorer tree views and registers every compare / commit-view command. */
export function registerCompareCommands(locator: RepoLocator): vscode.Disposable[] {
  const compare = new CompareCommitsTreeProvider();
  const commit = new CommitTreeProvider();
  const compareView = vscode.window.createTreeView(VIEW_IDS.compare, { treeDataProvider: compare });
  const commitView = vscode.window.createTreeView(VIEW_IDS.commit, { treeDataProvider: commit });

  const reveal = async (
    provider: ChangesTreeProvider,
    view: { description?: string },
    viewId: string,
    key: string,
    show: () => Promise<void>,
  ): Promise<void> => {
    await show();
    view.description = provider.description;
    await setContext(key, true);
    try {
      await vscode.commands.executeCommand(`${viewId}.focus`);
    } catch {
      // Focus is best-effort; the view may not support it on every host.
    }
  };

  const serviceFor = async (root?: unknown): Promise<GitService | undefined> => {
    if (typeof root === 'string') return locator.service(root);
    const uri = vscode.window.activeTextEditor?.document.uri;
    const svc = (uri && (await locator.repoFor(uri))) || (await locator.pickRepo(false));
    return svc === 'cancelled' ? undefined : svc;
  };
  const guarded = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (e) {
      void vscode.window.showErrorMessage(`Git History Plus: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const showProvider = {
    show: (svc: GitService, l: Hash, r: Hash) =>
      reveal(compare, compareView, VIEW_IDS.compare, CONTEXT_KEYS.compareViewVisible, () =>
        compare.show(svc, l, r),
      ),
  };

  const hide = (provider: ChangesTreeProvider, key: string) => (): Thenable<unknown> => {
    provider.clear();
    return setContext(key, false);
  };

  const reg = (name: string, fn: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(`${NS}.${name}`, fn);

  return [
    compareView,
    commitView,
    reg('selectForComparison', (hash: Hash, root?: unknown) =>
      guarded(async () => {
        const svc = await serviceFor(root);
        if (svc) await selectForComparison(svc, hash, compareState);
      }),
    ),
    reg('compareWithSelected', (hash: Hash, root?: unknown) =>
      guarded(async () => {
        const svc = await serviceFor(root);
        if (svc) await compareWithSelected(svc, hash, compareState, showProvider);
      }),
    ),
    reg('compareRefs', (root?: unknown) =>
      guarded(async () => {
        const svc = await serviceFor(root);
        if (svc) await compareRefs(svc, showProvider);
      }),
    ),
    reg('compareFileWithRef', (arg?: unknown) =>
      guarded(async () => {
        const uri = normalizeUriArg(arg) ?? vscode.window.activeTextEditor?.document.uri;
        const svc = uri && (await locator.repoFor(uri));
        if (!uri || !svc) {
          void vscode.window.showWarningMessage('Git History Plus: open a file in a git repository first.');
          return;
        }
        await compareFileWithRef(svc, await relPath(svc, uri));
      }),
    ),
    reg('compareView.hide', hide(compare, CONTEXT_KEYS.compareViewVisible)),
    reg('compareView.showFilesOnly', () => compare.setMode('files')),
    reg('compareView.showFolderView', () => compare.setMode('folders')),
    reg('compareView.openFile', (root: string, l: Hash, r: Hash, file: FileChange) =>
      compareFiles(locator.service(root), l, r, file),
    ),
    reg('commitView.show', (root: string, hash: Hash) =>
      guarded(() =>
        reveal(commit, commitView, VIEW_IDS.commit, CONTEXT_KEYS.commitViewVisible, () =>
          commit.show(locator.service(root), hash),
        ),
      ),
    ),
    reg('commitView.hide', hide(commit, CONTEXT_KEYS.commitViewVisible)),
    reg('commitView.showFilesOnly', () => commit.setMode('files')),
    reg('commitView.showFolderView', () => commit.setMode('folders')),
    reg('commitView.openFile', (root: string, hash: Hash, parent: Hash | undefined, file: FileChange) =>
      openDiff(locator.service(root), hash, parent, file),
    ),
  ];
}
