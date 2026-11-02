import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref as ReactRef,
} from 'react';
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  type Column,
  type ViewSettings,
} from '../../src/shared/protocol';
import { DEFAULT_COLUMNS } from '../layout';
import { WORKTREE, type Commit, type GraphRow, type Hash, type Ref } from '../../src/shared/types';
import { avatarKey } from '../store';
import { CommitRow, rowId } from './CommitRow';
import { LANE_WIDTH, ROW_HEIGHT, laneCount } from './GraphCell';

export interface CommitTableProps {
  commits: Commit[];
  graph: GraphRow[];
  hasMore: boolean;
  loading: boolean;
  /** The last load failed; an empty list then means "unknown", not "no matches". */
  failed?: boolean;
  selected?: Hash;
  /** Changes when the selected commit was explicitly revealed again (Go to HEAD): scroll to it. */
  revealCount?: number;
  settings: ViewSettings;
  /** Known author avatars (data:image/ URIs) by avatarKey(email). */
  avatars?: Record<string, string>;
  /** Narrow layout: hide the Author, Date and Hash columns. */
  compact?: boolean;
  /** Renders `renderDetails(commit)` in a row right under this commit (narrow layout). */
  expanded?: Hash;
  renderDetails?(commit: Commit): ReactNode;
  gridRef?: ReactRef<HTMLDivElement>;
  onSelect(hash: Hash): void;
  onOpen?(hash: Hash): void;
  onLoadMore(): void;
  onGridKeyDown?(e: KeyboardEvent<HTMLDivElement>): void;
  onRowContextMenu?(hash: Hash, e: MouseEvent): void;
  onBadgeContextMenu?(ref: Ref, hash: Hash, e: MouseEvent): void;
  /** Widths of the Author, Date and Hash columns (the message takes the rest). */
  columns?: Record<Column, number>;
  onResizeColumn?(column: Column, width: number): void;
  /** A column drag ended. */
  onResizeColumnEnd?(): void;
  /** The pointer moved onto a commit row (with the point under it), or off the rows. */
  onRowHover?(hash: Hash | undefined, at?: { x: number; y: number }): void;
}

/** Ask for the next page once the last rendered row is this close to the end. */
const LOAD_AHEAD = 20;
const SKELETON_ROWS = 12;
const COLUMNS = ['Graph', 'Message', 'Author', 'Date', 'Hash'] as const;
const COLUMN_CLASS = ['cell-graph', 'cell-message', 'cell-author', 'cell-date', 'cell-hash'] as const;
/** The resizable column under each header, by position. */
const RESIZABLE: (Column | undefined)[] = [undefined, undefined, 'author', 'date', 'hash'];
const COLUMN_STEP = 8;
const COMPACT_COLUMNS = 2;

/** Hidden webviews and detached nodes measure 0; never let a row collapse to nothing. */
const measure = (el: Element) => el.getBoundingClientRect().height || ROW_HEIGHT;

export function CommitTable(p: CommitTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The one column handle in the Tab order (Up/Down move between them). */
  const [activeResizer, setActiveResizer] = useState<Column>('author');
  const columns = p.compact ? COMPACT_COLUMNS : COLUMNS.length;
  const expandedAt = p.expanded && p.renderDetails ? p.commits.findIndex((c) => c.hash === p.expanded) : -1;
  /** Virtual index of the in-place details row, or -1. */
  const detailsAt = expandedAt >= 0 ? expandedAt + 1 : -1;
  const commitAt = (v: number) => (detailsAt >= 0 && v > detailsAt ? v - 1 : v);
  const virtualOf = (i: number) => (detailsAt >= 0 && i >= detailsAt ? i + 1 : i);
  const count = p.commits.length + (detailsAt >= 0 ? 1 : 0) + (p.hasMore ? 1 : 0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    measureElement: measure,
    overscan: 10,
    getItemKey: (v) => (v === detailsAt ? `details:${p.expanded}` : (p.commits[commitAt(v)]?.hash ?? 'more')),
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? -1;
  const lanes = useMemo(() => laneCount(p.graph), [p.graph]);
  const now = useMemo(() => Date.now(), [p.commits]); // relative dates refresh with each reload

  const { hasMore, loading, onLoadMore } = p;
  const total = p.commits.length;
  useEffect(() => {
    if (hasMore && !loading && lastIndex >= total - LOAD_AHEAD) onLoadMore();
  }, [hasMore, loading, lastIndex, total, onLoadMore]);

  // Keep the selected row on screen when the selection moves (keyboard, search hit).
  const selectedAt = p.commits.findIndex((c) => c.hash === p.selected);
  useEffect(() => {
    if (selectedAt < 0) return;
    const v = virtualOf(selectedAt);
    const item = virtualizer.getVirtualItems().find((i) => i.index === v);
    const top = virtualizer.scrollOffset ?? 0;
    const height = scrollRef.current?.clientHeight ?? 0;
    if (!item || item.start < top || item.end > top + height) virtualizer.scrollToIndex(v, { align: 'auto' });
    // Only a selection change (or an explicit reveal) should scroll, not every re-render.
  }, [p.selected, p.revealCount]);

  const empty = total === 0;
  /**
   * Keyboard focus is drawn on the selected row only while that row is rendered; otherwise (nothing
   * selected, or it is virtualized away) the grid outlines itself. aria-activedescendant must point
   * at an element that exists, so it follows the same rule.
   */
  const activeRendered =
    selectedAt >= 0 && !(empty && loading) && items.some((i) => i.index === virtualOf(selectedAt));
  const cols = p.columns ?? DEFAULT_COLUMNS;
  const gridStyle = {
    '--graph-width': `${Math.max(lanes * LANE_WIDTH, 44)}px`,
    '--col-author': `${cols.author}px`,
    '--col-date': `${cols.date}px`,
    '--col-hash': `${cols.hash}px`,
  } as CSSProperties;

  return (
    <div className="commit-table-wrap">
      <div
        ref={p.gridRef}
        role="grid"
        tabIndex={0}
        aria-label="Commits"
        aria-rowcount={count + 1}
        aria-colcount={columns}
        aria-busy={loading}
        aria-activedescendant={activeRendered ? rowId(p.selected!) : undefined}
        className={`commit-table${empty ? ' is-empty' : ''}${activeRendered ? '' : ' no-active-row'}`}
        style={gridStyle}
        onKeyDown={p.onGridKeyDown}
      >
        <div role="rowgroup" className="commit-head">
          <div role="row" aria-rowindex={1} className="commit-row commit-row--header">
            {COLUMNS.slice(0, columns).map((c, i) => {
              const column = RESIZABLE[i];
              return (
                <div key={c} role="columnheader" className={`cell ${COLUMN_CLASS[i]}`}>
                  {column && p.onResizeColumn && (
                    <ColumnResizer
                      label={c}
                      width={cols[column]}
                      tabStop={column === activeResizer}
                      onFocus={() => setActiveResizer(column)}
                      onResize={(w) => p.onResizeColumn!(column, w)}
                      onEnd={p.onResizeColumnEnd}
                    />
                  )}
                  {c}
                </div>
              );
            })}
          </div>
        </div>
        <div
          className="commit-scroll"
          ref={scrollRef}
          onScroll={p.onRowHover && (() => p.onRowHover!(undefined))}
          onMouseOver={
            p.onRowHover &&
            ((e) => {
              const row = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-hash]') : null;
              const hash = row?.dataset.hash;
              if (!row || !hash || hash === WORKTREE) return p.onRowHover!(undefined);
              p.onRowHover!(hash, { x: e.clientX, y: row.getBoundingClientRect().bottom });
            })
          }
          onMouseLeave={p.onRowHover && (() => p.onRowHover!(undefined))}
        >
          {empty && loading ? (
            <Skeleton compact={p.compact} />
          ) : (
            <div role="rowgroup" className="commit-rows" style={{ height: virtualizer.getTotalSize() }}>
              {items.map((item) => {
                const translate = { transform: `translateY(${item.start}px)` };
                if (item.index === detailsAt) {
                  const commit = p.commits[expandedAt]!;
                  return (
                    <div
                      key={item.key}
                      role="row"
                      aria-rowindex={item.index + 2}
                      className="commit-row details-row"
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={translate}
                    >
                      <div role="gridcell" aria-colspan={columns} className="details-cell">
                        {p.renderDetails!(commit)}
                      </div>
                    </div>
                  );
                }
                const commit = p.commits[commitAt(item.index)];
                if (!commit) {
                  return (
                    <div
                      key={item.key}
                      role="row"
                      aria-rowindex={item.index + 2}
                      className="commit-row more-row"
                      data-index={item.index}
                      ref={virtualizer.measureElement}
                      style={translate}
                    >
                      <div role="gridcell" aria-colspan={columns}>
                        Loading more…
                      </div>
                    </div>
                  );
                }
                return (
                  <CommitRow
                    key={item.key}
                    commit={commit}
                    graph={p.graph[commitAt(item.index)]}
                    lanes={lanes}
                    dashedFrom={
                      commitAt(item.index) === 1 && p.commits[0]?.hash === WORKTREE
                        ? p.graph[0]?.lane
                        : undefined
                    }
                    index={item.index}
                    compact={!!p.compact}
                    start={item.start}
                    selected={commit.hash === p.selected}
                    settings={p.settings}
                    avatar={p.avatars?.[avatarKey(commit.author.email)]}
                    now={now}
                    onSelect={p.onSelect}
                    onOpen={p.onOpen}
                    onContextMenu={p.onRowContextMenu}
                    onBadgeContextMenu={p.onBadgeContextMenu}
                    measureRef={virtualizer.measureElement}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
      {empty && !loading && !p.failed && (
        <div role="status" className="empty-state">
          No commits match
        </div>
      )}
    </div>
  );
}

interface ColumnResizerProps {
  label: string;
  width: number;
  /** The handles share one Tab stop; this one holds it. */
  tabStop: boolean;
  onFocus(): void;
  onResize(width: number): void;
  onEnd?(): void;
}

/**
 * The handle on a column's left edge: dragging it left (or ArrowLeft) widens the column, the
 * message column gives up the room. Home and End jump to the limits; Up and Down move to the
 * previous or next column's handle.
 */
function ColumnResizer(p: ColumnResizerProps) {
  const drag = useRef<{ x: number; width: number }>(undefined);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const all = [
        ...(e.currentTarget.closest('[role="row"]')?.querySelectorAll<HTMLElement>('.column-resizer') ?? []),
      ];
      const to = all[all.indexOf(e.currentTarget) + (e.key === 'ArrowUp' ? -1 : 1)];
      e.preventDefault();
      e.stopPropagation();
      to?.focus();
      return;
    }
    const next =
      e.key === 'ArrowLeft'
        ? p.width + COLUMN_STEP
        : e.key === 'ArrowRight'
          ? p.width - COLUMN_STEP
          : e.key === 'Home'
            ? COLUMN_MIN_WIDTH
            : e.key === 'End'
              ? COLUMN_MAX_WIDTH
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    e.stopPropagation(); // not the grid's list keys
    p.onResize(next);
  };
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { x: e.clientX, width: p.width };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) p.onResize(drag.current.width + drag.current.x - e.clientX);
  };
  const onPointerUp = () => {
    if (drag.current) p.onEnd?.();
    drag.current = undefined;
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${p.label} column`}
      aria-valuenow={p.width}
      aria-valuemin={COLUMN_MIN_WIDTH}
      aria-valuemax={COLUMN_MAX_WIDTH}
      tabIndex={p.tabStop ? 0 : -1}
      className="column-resizer"
      onFocus={p.onFocus}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

const SKELETON_WIDTHS = ['w1', 'w2', 'w3', 'w4'] as const;

function Skeleton({ compact }: { compact?: boolean }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="commit-row skeleton-row">
          <div className="cell cell-graph">
            <span className="skeleton-dot" />
          </div>
          <div className="cell cell-message">
            <span className={`skeleton-bar ${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}`} />
          </div>
          {!compact && (
            <>
              <div className="cell cell-author">
                <span className="skeleton-bar" />
              </div>
              <div className="cell cell-date">
                <span className="skeleton-bar" />
              </div>
              <div className="cell cell-hash">
                <span className="skeleton-bar" />
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
