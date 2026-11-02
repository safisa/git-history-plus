import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ChangeStatus, FileChange } from '../../src/shared/types';
import { fileEntries, type FileEntry } from '../fileTree';
import { isMenuKey } from './Menu';

export interface FileListProps {
  files: FileChange[];
  /** Show the files as a folder tree (single-child folders merged) instead of a flat list. */
  tree?: boolean;
  /** Opens the file's diff: a preview tab, or `pinned` (double-click) one that stays. */
  onOpen(file: FileChange, pinned?: boolean): void;
  /** Opens the file's context menu at viewport coordinates; focus returns to `from`. */
  onMenu(file: FileChange, at: { x: number; y: number }, from: HTMLElement): void;
}

/** Lists longer than this are virtualized. */
export const VIRTUALIZE_AFTER = 500;
const FILE_ROW_HEIGHT = 22;
const INDENT = 12;

export const STATUS_NAME: Record<ChangeStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Unmerged',
};

const split = (path: string) => {
  const i = path.lastIndexOf('/');
  return i < 0 ? { name: path, dir: '' } : { name: path.slice(i + 1), dir: path.slice(0, i) };
};

const measure = (el: Element) => el.getBoundingClientRect().height || FILE_ROW_HEIGHT;

/**
 * Changed files: status letter, path and +/− counts. One tab stop (roving tabindex); arrows,
 * Home and End move between rows, Enter opens the diff, Shift+F10 / the "…" button open the menu.
 * In the tree, Enter or a click folds a folder, and Right/Left open, close or go to the parent.
 */
export function FileList(p: FileListProps) {
  const [active, setActive] = useState(0);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const entries = useMemo(() => fileEntries(p.files, !!p.tree, collapsed), [p.files, p.tree, collapsed]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusPending = useRef(false);
  const virtual = entries.length > VIRTUALIZE_AFTER;
  const virtualizer = useVirtualizer({
    count: virtual ? entries.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    measureElement: measure,
    overscan: 10,
  });
  const rows = virtual
    ? virtualizer.getVirtualItems().map((v) => ({ index: v.index, start: v.start as number | undefined }))
    : entries.map((_, index) => ({ index, start: undefined as number | undefined }));
  // Folding a folder can leave the active row past the end.
  const current = Math.min(active, Math.max(0, entries.length - 1));

  useEffect(() => {
    if (!focusPending.current) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-file-index="${current}"] .file-open`);
    if (el) {
      focusPending.current = false;
      el.focus();
    }
  });

  const moveTo = (i: number) => {
    const next = Math.max(0, Math.min(entries.length - 1, i));
    focusPending.current = true;
    setActive(next);
    if (virtual) virtualizer.scrollToIndex(next, { align: 'auto' });
  };

  const fold = (path: string, open: boolean) =>
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  /** The folder row that contains row `i`, if any. */
  const parentOf = (i: number) => {
    const depth = entries[i]!.depth;
    for (let j = i - 1; j >= 0; j--) if (entries[j]!.depth < depth) return j;
    return -1;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number, entry: FileEntry) => {
    if (isMenuKey(e)) {
      if (entry.kind !== 'file') return;
      const r = e.currentTarget.getBoundingClientRect();
      p.onMenu(entry.file, { x: r.left + 16, y: r.bottom }, e.currentTarget);
    } else if (e.altKey || e.ctrlKey || e.metaKey) {
      return;
    } else if (e.key === 'ArrowDown') moveTo(i + 1);
    else if (e.key === 'ArrowUp') moveTo(i - 1);
    else if (e.key === 'Home') moveTo(0);
    else if (e.key === 'End') moveTo(entries.length - 1);
    else if (e.key === 'ArrowRight' && entry.kind === 'dir') {
      if (entry.open) moveTo(i + 1);
      else fold(entry.path, true);
    } else if (e.key === 'ArrowLeft' && entry.kind === 'dir' && entry.open) fold(entry.path, false);
    else if (e.key === 'ArrowLeft' && parentOf(i) >= 0) moveTo(parentOf(i));
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const onContextMenu = (e: MouseEvent<HTMLElement>, file: FileChange, from: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();
    p.onMenu(file, { x: e.clientX, y: e.clientY }, from);
  };

  const list = (
    <div
      role="list"
      aria-label="Changed files"
      className="file-list"
      style={virtual ? { height: virtualizer.getTotalSize() } : undefined}
    >
      {rows.map(({ index, start }) => {
        const entry = entries[index]!;
        const rowProps = {
          role: 'listitem',
          className: entry.kind === 'dir' ? 'file-row dir-row' : 'file-row',
          'data-index': virtual ? index : undefined,
          'data-file-index': index,
          'aria-level': p.tree ? entry.depth + 1 : undefined,
          ref: virtual ? virtualizer.measureElement : undefined,
          style: {
            ...(start === undefined ? {} : { transform: `translateY(${start}px)` }),
            ...(entry.depth > 0 ? { paddingLeft: entry.depth * INDENT } : {}),
          },
        };
        if (entry.kind === 'dir') {
          return (
            <div key={`dir\0${entry.path}`} {...rowProps}>
              <button
                type="button"
                className="file-open"
                tabIndex={index === current ? 0 : -1}
                aria-expanded={entry.open}
                title={entry.path}
                onClick={() => fold(entry.path, !entry.open)}
                onFocus={() => setActive(index)}
                onKeyDown={(e) => onKeyDown(e, index, entry)}
              >
                <span
                  className={`codicon codicon-chevron-${entry.open ? 'down' : 'right'}`}
                  aria-hidden="true"
                />
                <span className="sr-only">Folder: </span>
                <span className="file-name dir-name">{entry.name}</span>
              </button>
            </div>
          );
        }
        const file = entry.file;
        const { name, dir } = split(file.path);
        const status = STATUS_NAME[file.status];
        return (
          <div key={virtual ? index : `${file.oldPath ?? ''}\0${file.path}`} {...rowProps}>
            <button
              type="button"
              className="file-open"
              tabIndex={index === current ? 0 : -1}
              title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
              // As in VS Code: a click opens a preview tab, a double-click keeps it open.
              onClick={(e) => e.detail < 2 && p.onOpen(file)}
              onDoubleClick={() => p.onOpen(file, true)}
              onFocus={() => setActive(index)}
              onKeyDown={(e) => onKeyDown(e, index, entry)}
              onContextMenu={(e) => onContextMenu(e, file, e.currentTarget)}
            >
              <span className={`file-status status-${file.status}`} title={status} aria-hidden="true">
                {file.status}
              </span>
              <span className="sr-only">{status}: </span>
              <span className="file-name">{name}</span>
              {dir && !p.tree && <span className="file-dir">{dir}</span>}
              {file.oldPath && <span className="file-dir">← {file.oldPath}</span>}
              <span className="file-stats">
                {file.binary ? (
                  'binary'
                ) : (
                  <>
                    {file.additions !== undefined && <span className="stat-add">+{file.additions}</span>}
                    {file.deletions !== undefined && <span className="stat-del">−{file.deletions}</span>}
                  </>
                )}
              </span>
            </button>
            <button
              type="button"
              className="icon-button file-more"
              tabIndex={-1}
              aria-label={`More actions for ${file.path}`}
              title="More actions"
              aria-haspopup="menu"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                const open = e.currentTarget.previousElementSibling as HTMLElement;
                p.onMenu(file, { x: r.left, y: r.bottom + 2 }, open);
              }}
            >
              <span className="codicon codicon-ellipsis" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div ref={scrollRef} className={virtual ? 'file-scroll is-virtual' : 'file-scroll'}>
      {list}
    </div>
  );
}
