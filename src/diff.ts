import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { toGitUri } from './content/gitContentProvider';
import type { GitService } from './git/gitService';
import type { FileChange, Hash } from './shared/types';

export const short = (hash: Hash): string => hash.slice(0, 7);

const basename = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/**
 * Opens a diff as a preview tab (the next preview replaces it), or `pinned` as a tab that stays; a
 * pinned open of a diff already shown as a preview keeps that tab.
 */
function showDiff(
  left: vscode.Uri,
  right: vscode.Uri,
  title: string,
  viewColumn?: vscode.ViewColumn,
  pinned = false,
): Promise<void> {
  const preview = !pinned;
  const options = viewColumn === undefined ? { preview } : { preview, viewColumn };
  return Promise.resolve(vscode.commands.executeCommand('vscode.diff', left, right, title, options)).then(
    () => undefined,
  );
}

export function openDiff(
  svc: GitService,
  hash: Hash,
  parent: Hash | undefined,
  file: FileChange,
  pinned = false,
): Promise<void> {
  const left =
    file.status === 'A' || !parent
      ? toGitUri(svc.root, file.path, 'EMPTY')
      : toGitUri(svc.root, file.oldPath ?? file.path, parent);
  const right =
    file.status === 'D' ? toGitUri(svc.root, file.path, 'EMPTY') : toGitUri(svc.root, file.path, hash);
  const title = `${basename(file.path)} (${parent ? short(parent) : 'empty'} ↔ ${short(hash)})`;
  return showDiff(left, right, title, undefined, pinned);
}

export async function openFileAt(svc: GitService, hash: Hash, path: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.open', toGitUri(svc.root, path, hash), { preview: true });
}

/** The absolute work-tree path of a repo-relative `path`; throws when it would leave the repository. */
function workTreePath(root: string, path: string): string {
  const abs = nodePath.resolve(root, path);
  const rel = nodePath.relative(root, abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(rel)) {
    throw new Error(`"${path}" is outside the repository`);
  }
  return abs;
}

/** `label` names the old side in the title (a branch or tag name); the short hash by default. */
export async function compareWithWorkspace(
  svc: GitService,
  hash: Hash,
  path: string,
  label = short(hash),
): Promise<void> {
  const right = vscode.Uri.file(workTreePath(svc.root, path));
  const left = toGitUri(svc.root, path, hash);
  await showDiff(left, right, `${basename(path)} (${label} ↔ workspace)`);
}

/** A file's uncommitted change: HEAD against the working tree (empty sides for added or deleted). */
export function compareWorktree(
  svc: GitService,
  head: Hash,
  file: FileChange,
  pinned = false,
): Promise<void> {
  const left =
    file.status === 'A'
      ? toGitUri(svc.root, file.path, 'EMPTY')
      : toGitUri(svc.root, file.oldPath ?? file.path, head);
  const right =
    file.status === 'D'
      ? toGitUri(svc.root, file.path, 'EMPTY')
      : vscode.Uri.file(workTreePath(svc.root, file.path));
  return showDiff(left, right, `${basename(file.path)} (HEAD ↔ working tree)`, undefined, pinned);
}

export function compareFiles(svc: GitService, left: Hash, right: Hash, file: FileChange): Promise<void> {
  const l =
    file.status === 'A'
      ? toGitUri(svc.root, file.path, 'EMPTY')
      : toGitUri(svc.root, file.oldPath ?? file.path, left);
  const r =
    file.status === 'D' ? toGitUri(svc.root, file.path, 'EMPTY') : toGitUri(svc.root, file.path, right);
  return showDiff(l, r, `${basename(file.path)} (${short(left)} ↔ ${short(right)})`);
}

interface HistoryEntry {
  svc: GitService;
  /** The followed path, as the history was opened with. */
  path: string;
  history: Hash[];
  index: number;
}

const historyEntries = new Map<string, HistoryEntry>();

/** Per file history (root + path): the right-hand URI of the version diff it last opened. */
const versionTabs = new Map<string, string>();

/** The open diff tab whose right-hand side is `rightUri`. Hosts without the tab API have none. */
function diffTab(rightUri: string): vscode.Tab | undefined {
  for (const group of vscode.window.tabGroups?.all ?? []) {
    for (const tab of group.tabs) {
      const input = tab.input as { modified?: vscode.Uri } | undefined;
      if (input?.modified?.toString() === rightUri) return tab;
    }
  }
  return undefined;
}

/** The file-history position of a diff whose right-hand side is `rightUri` (a Uri string), if any. */
export function historyEntryFor(rightUri: string): HistoryEntry | undefined {
  return historyEntries.get(rightUri);
}

/**
 * Opens the diff for `history[index]` (history is newest first): `history[index+1] <-> history[index]`,
 * following renames. The path at every version comes from one cached `git log --follow --name-status`
 * (GitService.fileVersions), so a deep index costs no extra git calls. Remembers the position so
 * previous/next version can step from the open editor.
 */
export async function openHistoryDiff(
  svc: GitService,
  path: string,
  history: Hash[],
  index: number,
  pinned = false,
): Promise<void> {
  const hash = history[index];
  if (hash === undefined) throw new Error('No such version');
  const version = (await svc.fileVersions(path)).find((v) => v.hash === hash);
  const cur = version?.path ?? path;
  const prev = history[index + 1];
  const added = prev === undefined || version?.status === 'A';
  const left = added ? toGitUri(svc.root, cur, 'EMPTY') : toGitUri(svc.root, version?.oldPath ?? cur, prev);
  const right = version?.status === 'D' ? toGitUri(svc.root, cur, 'EMPTY') : toGitUri(svc.root, cur, hash);
  const rightUri = right.toString();
  historyEntries.set(rightUri, { svc, path, history, index });

  // One version tab per file history: the next version takes the previous one's place, so stepping
  // doesn't pile up tabs whatever the host's preview-editor setting. A pinned tab is left alone.
  const key = `${svc.root}\0${path}`;
  const previous = versionTabs.get(key);
  const replace = previous !== undefined && previous !== rightUri ? diffTab(previous) : undefined;
  const reuse = replace && !replace.isPinned ? replace : undefined;
  const title = `${basename(cur)} (${added ? 'empty' : short(prev)} ↔ ${short(hash)})`;
  await showDiff(left, right, title, reuse?.group.viewColumn, pinned);
  versionTabs.set(key, rightUri);
  if (reuse && previous !== undefined) {
    historyEntries.delete(previous);
    try {
      await vscode.window.tabGroups.close(reuse, true);
    } catch {
      /* already closed by the user */
    }
  }
}
