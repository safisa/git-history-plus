import * as vscode from 'vscode';
import { NS } from '../constants';
import { fetchAll } from '../git/fetch';
import { runCommitAction } from './actions';
import { compareWithWorkspace, compareWorktree, openDiff, openFileAt, openHistoryDiff } from '../diff';
import type { Settings } from '../config';
import type { GitService } from '../git/gitService';
import type { HistoryMode, Request, ViewLayout } from '../shared/protocol';
import { sanitizeLayout } from '../shared/validate';
import { WORKTREE, type Hash } from '../shared/types';

export interface CompareState {
  selected?: { root: string; hash: Hash };
}

export interface AvatarProvider {
  get(emails: string[]): Promise<Record<string, string>>;
}

export interface HandlerCtx {
  svc: GitService;
  settings: Settings;
  compare: CompareState;
  avatars: AvatarProvider | undefined;
  /** Panel mode and, in file and line history, the tracked path. */
  mode?: HistoryMode;
  path?: string;
  /** Where view layout is remembered (the extension's global state). */
  state?: vscode.Memento;
}

/** globalState key of the view layout (panel and column widths, file tree), shared by every view. */
export const LAYOUT_KEY = `${NS}.layout`;

/** The remembered layout; whatever is malformed in storage is dropped. */
export function storedLayout(state: vscode.Memento | undefined): ViewLayout {
  return sanitizeLayout(state?.get<unknown>(LAYOUT_KEY)) ?? {};
}

/** The requests the uncommitted changes row can make; everything else needs a real commit. */
const WORKTREE_REQUESTS = new Set<Request['type']>(['details', 'openDiff', 'openVersionDiff']);

/** HEAD's commit, for diffs of the uncommitted changes. */
async function headCommit(svc: GitService): Promise<Hash> {
  const head = await svc.resolveCommit('HEAD');
  if (!head) throw new Error('The repository has no commits yet');
  return head;
}

/** Dispatches an already-validated webview request. Throws on failure; the caller turns that into {ok:false}. */
export async function handleRequest(req: Request, ctx: HandlerCtx): Promise<unknown> {
  const { svc, settings } = ctx;
  if ('hash' in req && req.hash === WORKTREE && !WORKTREE_REQUESTS.has(req.type))
    throw new Error('Uncommitted changes are not a commit');
  switch (req.type) {
    case 'log': {
      // A refresh asks for everything it listed in one go; a page is never smaller than the setting.
      const query = { ...req.query, pageSize: Math.max(settings.pageSize, req.count ?? 0) };
      if (query.maxCount === undefined && settings.defaultMaxCount > 0)
        query.maxCount = settings.defaultMaxCount;
      return svc.log(query, settings.includeRemoteBranches);
    }
    case 'details': {
      const details = await svc.details(req.hash, req.path);
      if ((ctx.mode !== 'file' && ctx.mode !== 'line') || !ctx.path) return details;
      if (req.hash === WORKTREE) return { ...details, focusPath: ctx.path };
      const version = (await svc.fileVersions(ctx.path)).find((v) => v.hash === req.hash);
      return { ...details, focusPath: version?.path ?? ctx.path };
    }
    case 'openVersionDiff': {
      if ((ctx.mode !== 'file' && ctx.mode !== 'line') || !ctx.path)
        throw new Error('openVersionDiff needs file or line history');
      if (req.hash === WORKTREE) {
        const path = ctx.path;
        const file = (await svc.worktreeFiles()).find((f) => f.path === path || f.oldPath === path);
        return compareWorktree(svc, await headCommit(svc), file ?? { status: 'M', path });
      }
      const history = await svc.fileHistory(ctx.path);
      const index = history.indexOf(req.hash);
      if (index < 0) throw new Error('This commit is not in the file history');
      return openHistoryDiff(svc, ctx.path, history, index);
    }
    case 'refs':
      return svc.refs();
    case 'containing':
      return svc.containing(req.hash);
    case 'authors':
      return svc.authors();
    case 'openDiff': {
      const pinned = req.pinned === true;
      if (req.hash === WORKTREE) return compareWorktree(svc, await headCommit(svc), req.file, pinned);
      if (ctx.mode === 'file' && ctx.path && (req.file.path === ctx.path || req.file.oldPath === ctx.path)) {
        const history = await svc.fileHistory(ctx.path);
        const index = history.indexOf(req.hash);
        if (index >= 0) return openHistoryDiff(svc, ctx.path, history, index, pinned);
      }
      const parent = (await svc.details(req.hash)).commit.parents[0];
      return openDiff(svc, req.hash, parent, req.file, pinned);
    }
    case 'openFileAt':
      return openFileAt(svc, req.hash, req.path);
    case 'compareWithWorkspace':
      return compareWithWorkspace(svc, req.hash, req.path);
    case 'copy':
      await vscode.env.clipboard.writeText(req.text);
      return undefined;
    case 'avatars':
      return ctx.avatars ? ctx.avatars.get(req.emails) : {};
    case 'action':
      return runCommitAction(req.action, req.hash, req.ref, ctx);
    case 'selectForComparison':
      await vscode.commands.executeCommand(`${NS}.selectForComparison`, req.hash, svc.root);
      return undefined;
    case 'compareWithSelected':
      await vscode.commands.executeCommand(`${NS}.compareWithSelected`, req.hash, svc.root);
      return undefined;
    case 'compareRefs':
      await vscode.commands.executeCommand(`${NS}.compareRefs`, svc.root);
      return undefined;
    case 'showInCommitView':
      await vscode.commands.executeCommand(`${NS}.commitView.show`, svc.root, req.hash);
      return undefined;
    case 'refreshRepo':
      // The webview reloads refs and its first page itself once this resolves.
      svc.invalidate();
      return undefined;
    case 'fetch':
      await fetchAll(svc);
      return undefined;
    case 'me':
      return svc.currentUser();
    case 'head':
      return svc.resolveCommit('HEAD');
    case 'openExternal':
      await vscode.env.openExternal(vscode.Uri.parse(req.url, true));
      return undefined;
    case 'saveLayout': {
      const cur = storedLayout(ctx.state);
      const next: ViewLayout = { ...cur, ...req.layout };
      if (cur.columns || req.layout.columns) next.columns = { ...cur.columns, ...req.layout.columns };
      await ctx.state?.update(LAYOUT_KEY, next);
      return undefined;
    }
  }
}
