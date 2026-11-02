import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { PANEL_MAX_WIDTH, PANEL_MIN_WIDTH } from '../src/shared/protocol';
import { WORKTREE, type Commit, type Hash, type Ref } from '../src/shared/types';
import { commitMenu } from './commitActions';
import { CommitTable } from './components/CommitTable';
import { rowId } from './components/CommitRow';
import { DetailsPanel, commitOps, refMenu } from './components/DetailsPanel';
import { HoverCard } from './components/Containing';
import { Menu, isMenuKey, type MenuRequest } from './components/Menu';
import { Toolbar } from './components/Toolbar';
import { useLayout } from './layout';
import { isMac } from './platform';
import { avatarKey, useStore, type Store } from './store';

/** At this width or wider the details sit in a side panel; below it they open in place. */
export const WIDE_MIN = 700;
export const PANEL_MIN = PANEL_MIN_WIDTH;
export const PANEL_MAX = PANEL_MAX_WIDTH;
const PANEL_STEP = 16;
const PAGE_ROWS = 10;
/** The pointer rests on a row this long before its branches card shows. */
export const HOVER_MS = 700;

const isFindKey = (e: KeyboardEvent) =>
  (isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
  !e.altKey &&
  !e.shiftKey &&
  e.key.toLowerCase() === 'f';
const isEditable = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest('input, textarea, select, [contenteditable="true"]');

/** The history view: toolbar, commit table, and the details (side panel when wide, in place when narrow). */
export function App({ store }: { store?: Store }) {
  const [s, actions] = useStore(store);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [width, setWidth] = useState(() => window.innerWidth);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menu, setMenu] = useState<MenuRequest>();
  const [announcement, setAnnouncement] = useState('');
  const [searchFor, setSearchFor] = useState<{ text: string }>();
  const drag = useRef<{ x: number; width: number }>(undefined);
  const selectedRef = useRef(s.selected);
  selectedRef.current = s.selected;
  const [hover, setHover] = useState<{ hash: Hash; at: { x: number; y: number } }>();
  const hovered = useRef<Hash>(undefined);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onRowHover = useCallback(
    (hash: Hash | undefined, at?: { x: number; y: number }) => {
      if (hash === hovered.current) return;
      hovered.current = hash;
      clearTimeout(hoverTimer.current);
      setHover(undefined);
      if (hash === undefined || !at) return;
      hoverTimer.current = setTimeout(() => {
        actions.loadContaining(hash);
        setHover({ hash, at });
      }, HOVER_MS);
    },
    [actions],
  );
  // A click, a key or the wheel puts the card away (until the pointer moves to another row).
  useEffect(() => {
    if (!hover) return;
    const hide = () => setHover(undefined);
    const opts = { capture: true, passive: true };
    for (const t of ['keydown', 'mousedown', 'wheel'] as const) document.addEventListener(t, hide, opts);
    return () => {
      for (const t of ['keydown', 'mousedown', 'wheel'] as const) document.removeEventListener(t, hide, opts);
    };
  }, [hover]);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  // Asks (again) while the card is up without its answer, e.g. after a refresh dropped it.
  useEffect(() => {
    if (hover && s.containing[hover.hash] === undefined) actions.loadContaining(hover.hash);
  }, [actions, hover, s.containing]);
  // Back in the view with the uncommitted changes selected: they may have changed meanwhile.
  useEffect(() => {
    const onFocus = () => {
      if (selectedRef.current === WORKTREE) actions.select(WORKTREE);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [actions]);

  const view = useLayout(s.layout, (l) => void actions.send({ type: 'saveLayout', layout: l }));
  const { panelWidth, resizePanel } = view;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wide = width >= WIDE_MIN;
  const selectedCommit = s.selected ? s.commits.find((c) => c.hash === s.selected) : undefined;
  /** File and line history step through one file's versions; repository and folder history don't. */
  const versionHistory = s.mode === 'file' || s.mode === 'line';

  const closeMenu = useCallback(() => setMenu(undefined), []);
  const announce = useCallback((m: string) => setAnnouncement(m), []);

  const openCommitMenu = useCallback(
    (hash: Hash, at: { x: number; y: number }) =>
      setMenu({
        label: 'Commit actions',
        at,
        restoreFocus: gridRef.current,
        entries: commitMenu({
          hash,
          comparisonBase: s.comparisonBase,
          ...commitOps(hash, actions, announce),
          ...(versionHistory ? {} : { openChanges: undefined }),
        }),
      }),
    [actions, announce, s.comparisonBase, versionHistory],
  );

  // Read through a ref so the callback stays stable and memoized rows don't re-render on every selection.
  const layout = useRef({ wide, selected: s.selected, versionHistory });
  layout.current = { wide, selected: s.selected, versionHistory };
  const onRowClick = useCallback(
    (hash: Hash) => {
      const { wide, selected } = layout.current;
      if (!wide && hash === selected) setDetailsOpen((o) => !o);
      else {
        actions.select(hash);
        if (!wide) setDetailsOpen(true);
      }
    },
    [actions],
  );
  // File and line history: a double-click (like Enter) opens that version's diff; a click only selects.
  const onRowOpen = useCallback(
    (hash: Hash) => {
      if (layout.current.versionHistory) void actions.send({ type: 'openVersionDiff', hash });
    },
    [actions],
  );
  /** Selects a commit; one that isn't in the loaded list (or the next few pages) is searched for by hash. */
  const goTo = useCallback(
    async (hash: Hash) => {
      if ((await actions.reveal(hash)) === false) setSearchFor({ text: hash });
    },
    [actions],
  );
  const goToHead = useCallback(async () => {
    const head = await actions.send<Hash | undefined>({ type: 'head' });
    if (head?.result) await goTo(head.result);
  }, [actions, goTo]);

  const onRowContextMenu = useCallback(
    (hash: Hash, e: MouseEvent) => {
      actions.select(hash);
      openCommitMenu(hash, { x: e.clientX, y: e.clientY });
    },
    [actions, openCommitMenu],
  );
  const onBadgeContextMenu = useCallback(
    (ref: Ref, hash: Hash, e: MouseEvent) => {
      const entries = refMenu(ref, commitOps(hash, actions, announce).runAction);
      if (entries.length)
        setMenu({
          label: `${ref.name} actions`,
          at: { x: e.clientX, y: e.clientY },
          restoreFocus: gridRef.current,
          entries,
        });
    },
    [actions, announce],
  );

  /** ↑/↓/Home/End/PageUp/PageDown move the selection, Enter folds details (narrow), c copies, Shift+F10 = menu. */
  const listKey = (e: KeyboardEvent | ReactKeyboardEvent): boolean => {
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const n = s.commits.length;
    const at = s.commits.findIndex((c) => c.hash === s.selected);
    const go = (i: number) => n > 0 && actions.select(s.commits[Math.max(0, Math.min(n - 1, i))]!.hash);
    if (isMenuKey(e)) {
      if (!s.selected || s.selected === WORKTREE) return false;
      const r = document.getElementById(rowId(s.selected))?.getBoundingClientRect();
      openCommitMenu(s.selected, { x: (r?.left ?? 0) + 24, y: r?.bottom ?? 0 });
      return true;
    }
    if (e.shiftKey) return false;
    switch (e.key) {
      case 'ArrowDown':
        go(at < 0 ? 0 : at + 1);
        return true;
      case 'ArrowUp':
        go(at < 0 ? 0 : at - 1);
        return true;
      case 'Home':
        go(0);
        return true;
      case 'End':
        go(n - 1);
        return true;
      case 'PageDown':
        go(at + PAGE_ROWS);
        return true;
      case 'PageUp':
        go(at - PAGE_ROWS);
        return true;
      case 'Enter':
        if (versionHistory && s.selected) {
          void actions.send({ type: 'openVersionDiff', hash: s.selected });
          return true;
        }
        if (wide || !s.selected) return false;
        setDetailsOpen((o) => !o);
        return true;
      case 'c':
        if (!s.selected || s.selected === WORKTREE) return false;
        commitOps(s.selected, actions, announce).copyHash();
        return true;
      default:
        return false;
    }
  };
  const listKeyRef = useRef(listKey);
  listKeyRef.current = listKey;

  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // keys typed in the in-place details belong to them
    if (listKey(e)) e.preventDefault();
  };

  // "/" and Ctrl/Cmd+F focus search from anywhere; with nothing focused the list keys work too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // An open menu or dialog keeps its keys (and would stay open behind the search box).
      if (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"]')) return;
      if (isFindKey(e)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (isEditable(e.target)) return;
      if (e.key === '/' && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (
        (e.target === document.body || e.target === document.documentElement) &&
        listKeyRef.current(e)
      ) {
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const onSplitterKey = (e: ReactKeyboardEvent) => {
    const next =
      e.key === 'ArrowLeft'
        ? panelWidth + PANEL_STEP
        : e.key === 'ArrowRight'
          ? panelWidth - PANEL_STEP
          : e.key === 'Home'
            ? PANEL_MIN
            : e.key === 'End'
              ? PANEL_MAX
              : undefined;
    if (next === undefined) return;
    e.preventDefault();
    resizePanel(next);
  };
  const onSplitterDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, width: panelWidth };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
  };
  const onSplitterMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) resizePanel(drag.current.width + drag.current.x - e.clientX);
  };
  const onSplitterUp = () => {
    // A drag is saved as soon as it ends: the view may be closed right after.
    if (drag.current) view.flush();
    drag.current = undefined;
  };

  const details = (commit: Commit, inline: boolean) => (
    <DetailsPanel
      commit={commit}
      details={s.details[commit.hash]}
      containing={s.containing[commit.hash]}
      error={s.detailsErrors[commit.hash]}
      settings={s.settings}
      avatar={s.avatars[avatarKey(commit.author.email)]}
      comparisonBase={s.comparisonBase}
      actions={actions}
      openMenu={setMenu}
      announce={announce}
      inline={inline}
      versionHistory={versionHistory}
      onGoTo={(hash) => void goTo(hash)}
      fileTree={view.fileTree}
      onFileTree={view.setFileTree}
    />
  );

  return (
    <div ref={rootRef} className={wide ? 'app is-wide' : 'app is-narrow'}>
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
      <Toolbar
        initQuery={s.initQuery}
        branch={s.query.branch}
        refs={s.refs}
        exactHash={s.exactHash}
        actions={actions}
        searchRef={searchRef}
        searchFor={searchFor}
        onGoToHead={() => void goToHead()}
        onLeaveSearch={() => gridRef.current?.focus()}
      />
      {s.error !== undefined && (
        <div className="error-banner" role="alert">
          <span className="codicon codicon-error" aria-hidden="true" />
          <span className="error-text">{s.error}</span>
          <button type="button" onClick={() => void actions.retry()}>
            Retry
          </button>
        </div>
      )}
      {s.notice !== undefined && (
        <div className="error-banner notice-banner" role="alert">
          <span className="codicon codicon-warning" aria-hidden="true" />
          <span className="error-text">{s.notice}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss"
            title="Dismiss"
            onClick={actions.dismissNotice}
          >
            <span className="codicon codicon-close" aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="app-body">
        {s.loading && s.commits.length > 0 && (
          <div className="progress" role="progressbar" aria-label="Loading commits" />
        )}
        <CommitTable
          commits={s.commits}
          graph={s.graph}
          hasMore={s.hasMore}
          loading={s.loading}
          failed={s.error !== undefined}
          selected={s.selected}
          revealCount={s.revealCount}
          settings={s.settings}
          avatars={s.avatars}
          compact={!wide}
          expanded={!wide && detailsOpen ? s.selected : undefined}
          renderDetails={(c) => details(c, true)}
          gridRef={gridRef}
          onSelect={onRowClick}
          onOpen={onRowOpen}
          onLoadMore={actions.loadMore}
          onGridKeyDown={onGridKeyDown}
          onRowContextMenu={onRowContextMenu}
          onBadgeContextMenu={onBadgeContextMenu}
          columns={view.columns}
          onResizeColumn={view.resizeColumn}
          onResizeColumnEnd={view.flush}
          onRowHover={onRowHover}
        />
        {wide && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize details panel"
              aria-valuenow={panelWidth}
              aria-valuemin={PANEL_MIN}
              aria-valuemax={PANEL_MAX}
              tabIndex={0}
              className="splitter"
              onKeyDown={onSplitterKey}
              onPointerDown={onSplitterDown}
              onPointerMove={onSplitterMove}
              onPointerUp={onSplitterUp}
              onPointerCancel={onSplitterUp}
            />
            <aside className="details-side" aria-label="Commit details" style={{ width: panelWidth }}>
              {selectedCommit ? (
                details(selectedCommit, false)
              ) : (
                <div className="details-empty">Select a commit to see its details.</div>
              )}
            </aside>
          </>
        )}
      </div>
      {menu && <Menu request={menu} onClose={closeMenu} />}
      {hover && !menu && <HoverCard containing={s.containing[hover.hash]} at={hover.at} />}
    </div>
  );
}
