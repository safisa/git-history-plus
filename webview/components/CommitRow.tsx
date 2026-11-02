import { memo, type MouseEvent } from 'react';
import type { ViewSettings } from '../../src/shared/protocol';
import { formatDate } from '../../src/shared/dateFormat';
import { WORKTREE, type Commit, type GraphRow, type Hash, type Ref } from '../../src/shared/types';
import { GraphCell } from './GraphCell';
import { RefBadge, groupRefs } from './RefBadge';

export interface CommitRowProps {
  commit: Commit;
  graph: GraphRow | undefined;
  lanes: number;
  /** Under the uncommitted row: its lane, whose line down is dashed. */
  dashedFrom?: number;
  /** Position in the virtual list (0-based); the in-place details row counts too. */
  index: number;
  /** Narrow layout: only the graph and message columns. */
  compact: boolean;
  /** Pixel offset from the virtualizer. */
  start: number;
  selected: boolean;
  settings: ViewSettings;
  /** The author's avatar as a data:image/ URI, when one is known. */
  avatar?: string;
  now: number;
  onSelect(hash: Hash): void;
  /** Double-click: open the commit (file and line history open that version's diff). */
  onOpen?(hash: Hash): void;
  onContextMenu?(hash: Hash, e: MouseEvent): void;
  onBadgeContextMenu?(ref: Ref, hash: Hash, e: MouseEvent): void;
  measureRef(el: HTMLElement | null): void;
}

/** DOM id of a commit's row, for aria-activedescendant. */
export const rowId = (hash: Hash) => `commit-${hash}`;

/** One dense commit row: graph | badges + subject | author | date | short hash. */
export const CommitRow = memo(function CommitRow(p: CommitRowProps) {
  const { commit, settings } = p;
  const worktree = commit.hash === WORKTREE;
  return (
    <div
      role="row"
      id={rowId(commit.hash)}
      aria-rowindex={p.index + 2}
      aria-selected={p.selected}
      className={`commit-row${p.selected ? ' is-selected' : ''}${
        settings.dimMergeCommits !== false && commit.parents.length > 1 ? ' is-merge' : ''
      }${worktree ? ' is-worktree' : ''}`}
      data-index={p.index}
      data-hash={commit.hash}
      ref={p.measureRef}
      style={{ transform: `translateY(${p.start}px)` }}
      // The second click of a double-click must not select (or fold the details) again.
      onClick={(e) => e.detail < 2 && p.onSelect(commit.hash)}
      onDoubleClick={p.onOpen && (() => p.onOpen!(commit.hash))}
      onContextMenu={
        p.onContextMenu &&
        ((e) => {
          e.preventDefault();
          if (!worktree) p.onContextMenu!(commit.hash, e); // the uncommitted row has no commit actions
        })
      }
    >
      <div role="gridcell" className="cell cell-graph">
        {p.graph && <GraphCell row={p.graph} lanes={p.lanes} worktree={worktree} dashedFrom={p.dashedFrom} />}
      </div>
      <div role="gridcell" className="cell cell-message">
        {groupRefs(commit.refs).map(({ ref: r, remotes }) => (
          <RefBadge
            key={r.fullName}
            gitRef={r}
            remotes={remotes}
            onRemoteContextMenu={
              p.onBadgeContextMenu &&
              ((remote, e) => {
                e.preventDefault();
                e.stopPropagation();
                p.onBadgeContextMenu!(remote, commit.hash, e);
              })
            }
            onContextMenu={
              p.onBadgeContextMenu &&
              ((e) => {
                e.preventDefault();
                e.stopPropagation();
                p.onBadgeContextMenu!(r, commit.hash, e);
              })
            }
          />
        ))}
        <span className="subject">{commit.subject}</span>
      </div>
      {!p.compact && worktree && (
        <>
          <div role="gridcell" className="cell cell-author" />
          <div role="gridcell" className="cell cell-date" />
          <div role="gridcell" className="cell cell-hash" />
        </>
      )}
      {!p.compact && !worktree && (
        <>
          <div
            role="gridcell"
            className="cell cell-author"
            title={`${commit.author.name} <${commit.author.email}>`}
          >
            {p.avatar !== undefined && (
              <img className="avatar" src={p.avatar} alt="" width={16} height={16} />
            )}
            {commit.author.name}
          </div>
          <div role="gridcell" className="cell cell-date" title={new Date(commit.authorDate).toISOString()}>
            {formatDate(commit.authorDate, settings.dateFormat, settings.locale, p.now)}
          </div>
          <div role="gridcell" className="cell cell-hash" title={commit.hash}>
            {commit.hash.slice(0, 7)}
          </div>
        </>
      )}
    </div>
  );
});
