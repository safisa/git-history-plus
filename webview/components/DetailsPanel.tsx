import { useEffect, useMemo, type ReactNode } from 'react';
import type { ViewSettings } from '../../src/shared/protocol';
import { formatDate } from '../../src/shared/dateFormat';
import {
  WORKTREE,
  type Commit,
  type CommitAction,
  type CommitDetails,
  type Containing,
  type FileChange,
  type Hash,
  type Person,
  type Ref,
} from '../../src/shared/types';
import { COMMIT_ACTIONS, commitMenu, refActions, type MenuEntry } from '../commitActions';
import { compileIssueLinks, linkify } from '../issueLinks';
import type { Actions } from '../store';
import { ContainingLines } from './Containing';
import { FileList } from './FileList';
import { below, type MenuRequest } from './Menu';
import { RefBadge, sortRefs } from './RefBadge';

export interface DetailsPanelProps {
  /** The commit as listed in the log (its refs are the freshest). */
  commit: Commit;
  details?: CommitDetails;
  error?: string;
  /** Branches and tags that include the commit, once loaded (null: they could not be listed). */
  containing?: Containing | null;
  settings: ViewSettings;
  /** The author's avatar as a data:image/ URI, when one is known. */
  avatar?: string;
  comparisonBase?: Hash;
  actions: Actions;
  openMenu(req: MenuRequest): void;
  /** Says something to screen readers (copy confirmations). */
  announce(message: string): void;
  /** Rendered in place under its row (narrow layout) rather than in the side panel. */
  inline?: boolean;
  /** File or line history: the commit menu can open this version's diff. */
  versionHistory?: boolean;
  /** Selects a commit in the list (loading or searching for it when needed): parent links. */
  onGoTo?(hash: Hash): void;
  /** Changed files as a folder tree rather than a list, and the toggle between them. */
  fileTree?: boolean;
  onFileTree?(tree: boolean): void;
}

/** Everything the details panel, the row menu and badge menus can do with one commit. */
export function commitOps(hash: Hash, actions: Actions, announce: (m: string) => void) {
  return {
    runAction: (action: CommitAction, ref?: string) =>
      void actions.send({ type: 'action', action, hash, ...(ref === undefined ? {} : { ref }) }),
    copyHash: () => void copyText(hash, actions).then((ok) => ok && announce('Copied commit hash')),
    selectForComparison: () => void actions.selectForComparison(hash),
    compareWithSelected: () => void actions.send({ type: 'compareWithSelected', hash }),
    showInExplorer: () => void actions.send({ type: 'showInCommitView', hash }),
    openChanges: () => void actions.send({ type: 'openVersionDiff', hash }),
  };
}

/** The menu for one branch/remote/tag badge. */
export function refMenu(ref: Ref, runAction: (a: CommitAction, ref?: string) => void): MenuEntry[] {
  return refActions(ref).map((a) => ({
    label: a.label,
    icon: a.icon,
    onSelect: () => runAction(a.action, ref.name),
  }));
}

/**
 * Copies in the webview when its clipboard works (Theia's host-side clipboard may not reach the
 * browser); when it is missing or refuses, asks the extension to copy. Resolves whether it copied.
 */
async function copyText(text: string, actions: Actions): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* not allowed here: fall back to the extension */
  }
  return (await actions.send({ type: 'copy', text })) !== undefined;
}

/** In file and line history: the commit's entries for the tracked file (empty elsewhere). */
const trackedFiles = (d: CommitDetails) =>
  d.focusPath === undefined ? [] : d.files.filter((f) => f.path === d.focusPath || f.oldPath === d.focusPath);

interface ChangedFilesProps {
  hash: Hash;
  details: CommitDetails;
  tree?: boolean;
  onOpen(file: FileChange, pinned?: boolean): void;
  onMenu(file: FileChange, at: { x: number; y: number }, from: HTMLElement): void;
}

/**
 * The commit's files. In file and line history the tracked file comes first, on its own, and the
 * rest of the commit is folded away: that file is what the user is investigating.
 */
function ChangedFiles(p: ChangedFilesProps) {
  const mine = trackedFiles(p.details);
  if (mine.length === 0) {
    return (
      <FileList key={p.hash} files={p.details.files} tree={p.tree} onOpen={p.onOpen} onMenu={p.onMenu} />
    );
  }
  const others = p.details.files.filter((f) => !mine.includes(f));
  return (
    <>
      <div aria-label="This file" role="group">
        <FileList key={p.hash} files={mine} tree={p.tree} onOpen={p.onOpen} onMenu={p.onMenu} />
      </div>
      {others.length > 0 && (
        <details className="details-other-files" key={`${p.hash}-others`}>
          <summary>Other files in this commit ({others.length})</summary>
          <FileList files={others} tree={p.tree} onOpen={p.onOpen} onMenu={p.onMenu} />
        </details>
      )}
    </>
  );
}

/** How long a selection rests before its branches and tags are looked up. */
export const CONTAINING_DELAY_MS = 300;

const samePerson = (a: Person, b: Person) => a.name === b.name && a.email === b.email;

/** Subject, body, people and dates, actions, compare entry points and the changed files. */
export function DetailsPanel(p: DetailsPanelProps) {
  const { commit, actions, settings } = p;
  const hash = commit.hash;
  // Also re-runs when a refresh empties the cache; a failure waits for Retry instead of looping.
  const missing = p.details === undefined && p.error === undefined;
  useEffect(() => {
    if (missing) void actions.loadDetails(hash);
  }, [actions, hash, missing]);
  /** The uncommitted changes row: files only, no commit metadata or actions. */
  const worktree = hash === WORKTREE;
  const containingMissing = p.containing === undefined && !worktree;
  // Only once the selection rests: holding an arrow key must not start a branch walk per commit.
  useEffect(() => {
    if (!containingMissing) return;
    const t = setTimeout(() => actions.loadContaining(hash), CONTAINING_DELAY_MS);
    return () => clearTimeout(t);
  }, [actions, hash, containingMissing]);

  const ops = commitOps(hash, actions, p.announce);
  const now = Date.now();
  const when = (ms: number) => (
    <time dateTime={new Date(ms).toISOString()} title={new Date(ms).toISOString()}>
      {formatDate(ms, settings.dateFormat, settings.locale, now)}
    </time>
  );
  const canCompare = p.comparisonBase !== undefined && p.comparisonBase !== hash;

  // Commit text is rendered as text nodes; only matches of the user's issueLinks rules become links.
  // They are buttons, not <a href>: the webview host opens any clicked href itself, so an anchor
  // would open twice and skip the extension's URL check.
  const rules = useMemo(() => compileIssueLinks(settings.issueLinks), [settings.issueLinks]);
  const rich = (text: string): ReactNode[] =>
    linkify(text, rules).map((part, i) =>
      typeof part === 'string' ? (
        part
      ) : (
        <button
          key={i}
          type="button"
          className="link-button issue-link"
          title={`Open ${part.url}`}
          onClick={() => void actions.send({ type: 'openExternal', url: part.url })}
        >
          {part.text}
        </button>
      ),
    );

  // What a click on the file does, first in its menu as in the commit menu ("Open Changes").
  const fileMenu = (file: FileChange, at: { x: number; y: number }, from: HTMLElement) => {
    // Asked for by name, so it opens a tab that stays (like a double-click).
    const openChanges: MenuEntry = {
      label: 'Open Changes',
      icon: 'diff',
      onSelect: () => void actions.send({ type: 'openDiff', hash, file, pinned: true }),
    };
    return p.openMenu({
      label: `Actions for ${file.path}`,
      at,
      restoreFocus: from,
      entries: worktree
        ? [openChanges]
        : [
            openChanges,
            '-',
            {
              label: 'View file at this commit',
              icon: 'go-to-file',
              disabled: file.status === 'D',
              onSelect: () => void actions.send({ type: 'openFileAt', hash, path: file.path }),
            },
            {
              label: 'Compare with working copy',
              icon: 'compare-changes',
              disabled: file.status === 'D',
              onSelect: () => void actions.send({ type: 'compareWithWorkspace', hash, path: file.path }),
            },
            { label: 'Select for comparison', icon: 'target', onSelect: ops.selectForComparison },
          ],
    });
  };

  const body = (
    <>
      <header className="details-header">
        <h2 className="details-subject">{worktree ? commit.subject : rich(commit.subject)}</h2>
        {!worktree && (
          <button
            type="button"
            className="icon-button"
            aria-label="More actions"
            title="More actions"
            aria-haspopup="menu"
            onClick={(e) =>
              p.openMenu({
                label: 'Commit actions',
                at: below(e.currentTarget),
                restoreFocus: e.currentTarget,
                entries: commitMenu({
                  hash,
                  comparisonBase: p.comparisonBase,
                  ...ops,
                  openChanges: p.versionHistory ? ops.openChanges : undefined,
                }),
              })
            }
          >
            <span className="codicon codicon-ellipsis" aria-hidden="true" />
          </button>
        )}
      </header>

      {worktree ? (
        <div className="details-meta">
          <div className="details-line">Staged, unstaged and untracked changes, compared with HEAD.</div>
        </div>
      ) : (
        <>
          <div className="details-meta">
            <div className="details-line">
              <span className="details-hash" title={hash}>
                {hash.slice(0, 10)}
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label="Copy commit hash"
                title="Copy commit hash (c)"
                onClick={ops.copyHash}
              >
                <span className="codicon codicon-copy" aria-hidden="true" />
              </button>
              {commit.refs.length > 0 && (
                <span className="details-refs">
                  {sortRefs(commit.refs).map((r) => {
                    const menu = refMenu(r, ops.runAction);
                    return (
                      <RefBadge
                        key={r.fullName}
                        gitRef={r}
                        onMenu={
                          menu.length
                            ? (at, from) =>
                                p.openMenu({
                                  label: `${r.name} actions`,
                                  at,
                                  restoreFocus: from,
                                  entries: menu,
                                })
                            : undefined
                        }
                        onRemove={
                          r.kind === 'remote' ? () => ops.runAction('removeRemoteBranch', r.name) : undefined
                        }
                      />
                    );
                  })}
                </span>
              )}
            </div>
            {commit.parents.length > 0 && p.onGoTo && (
              <div className="details-line details-parents">
                <span className="details-label">{commit.parents.length > 1 ? 'Parents' : 'Parent'}</span>
                {commit.parents.map((parent) => (
                  <button
                    key={parent}
                    type="button"
                    className="link-button details-hash"
                    aria-label={`Go to parent ${parent.slice(0, 7)}`}
                    title={`Go to ${parent}`}
                    onClick={() => p.onGoTo!(parent)}
                  >
                    {parent.slice(0, 7)}
                  </button>
                ))}
              </div>
            )}
            {p.containing && <ContainingLines containing={p.containing} max={10} />}
            <div className="details-line">
              {p.avatar !== undefined ? (
                <img className="avatar avatar--large" src={p.avatar} alt="" width={32} height={32} />
              ) : (
                <span className="codicon codicon-person" aria-hidden="true" />
              )}
              <span className="details-name">{commit.author.name}</span>
              <span className="details-email">{commit.author.email}</span>
              <span aria-hidden="true">·</span>
              {when(commit.authorDate)}
            </div>
            {!samePerson(commit.author, commit.committer) && (
              <div className="details-line details-committer">
                <span className="codicon codicon-git-commit" aria-hidden="true" />
                Committed by <span className="details-name">{commit.committer.name}</span>
                <span className="details-email">{commit.committer.email}</span>
                <span aria-hidden="true">·</span>
                {when(commit.commitDate)}
              </div>
            )}
          </div>

          {commit.body && <div className="details-body">{rich(commit.body)}</div>}

          <div role="group" aria-label="Actions" className="details-actions">
            {COMMIT_ACTIONS.map((a) => (
              <button
                key={a.action}
                type="button"
                className="secondary small"
                onClick={() => ops.runAction(a.action)}
              >
                <span className={`codicon codicon-${a.icon}`} aria-hidden="true" />
                {a.label}
              </button>
            ))}
          </div>
          <div role="group" aria-label="Compare" className="details-actions">
            <button type="button" className="secondary small" onClick={ops.selectForComparison}>
              <span className="codicon codicon-target" aria-hidden="true" />
              Select for comparison
            </button>
            {canCompare && (
              <button
                type="button"
                className="secondary small"
                title={`Compare with ${p.comparisonBase!.slice(0, 7)}`}
                onClick={ops.compareWithSelected}
              >
                <span className="codicon codicon-git-compare" aria-hidden="true" />
                Compare with selected
              </button>
            )}
            <button type="button" className="secondary small" onClick={ops.showInExplorer}>
              <span className="codicon codicon-list-tree" aria-hidden="true" />
              Show in Explorer
            </button>
          </div>
        </>
      )}

      <div className="details-files-bar">
        <h3 className="details-files-heading">
          {p.details && trackedFiles(p.details).length > 0
            ? 'This file'
            : `Files${p.details ? ` (${p.details.files.length})` : ''}`}
        </h3>
        {/* Like VS Code's own toggles: the button shows and names what a click switches to. */}
        {p.onFileTree && (
          <button
            type="button"
            className="icon-button"
            aria-label={p.fileTree ? 'View as list' : 'View as tree'}
            title={p.fileTree ? 'View as list' : 'View as tree'}
            onClick={() => p.onFileTree!(!p.fileTree)}
          >
            <span
              className={`codicon codicon-${p.fileTree ? 'list-flat' : 'list-tree'}`}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
      {p.error !== undefined ? (
        <div className="details-error" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          <span className="error-text">{p.error}</span>
          <button type="button" className="secondary small" onClick={() => void actions.loadDetails(hash)}>
            Retry
          </button>
        </div>
      ) : p.details ? (
        <ChangedFiles
          hash={hash}
          details={p.details}
          tree={p.fileTree}
          onOpen={(file, pinned) =>
            void actions.send({ type: 'openDiff', hash, file, ...(pinned ? { pinned } : {}) })
          }
          onMenu={fileMenu}
        />
      ) : (
        <div className="details-note" role="status">
          Loading files…
        </div>
      )}
    </>
  );

  return p.inline ? (
    <section className="details details--inline" aria-label="Commit details">
      {body}
    </section>
  ) : (
    <div className="details details--side">{body}</div>
  );
}
