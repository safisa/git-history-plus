import { useEffect, useRef, useState } from 'react';
import {
  COLUMN_MAX_WIDTH,
  COLUMN_MIN_WIDTH,
  PANEL_MAX_WIDTH,
  PANEL_MIN_WIDTH,
  type Column,
  type ViewLayout,
} from '../src/shared/protocol';

export const PANEL_DEFAULT = 320;
export const DEFAULT_COLUMNS: Readonly<Record<Column, number>> = { author: 120, date: 120, hash: 64 };
/** A resize is saved once the user has stopped for this long. */
const SAVE_MS = 400;

const clamp = (w: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(w)));
export const clampPanel = (w: number) => clamp(w, PANEL_MIN_WIDTH, PANEL_MAX_WIDTH);
export const clampColumn = (w: number) => clamp(w, COLUMN_MIN_WIDTH, COLUMN_MAX_WIDTH);

/** Merges `patch` into `base`, column by column. */
function merge(base: ViewLayout, patch: ViewLayout): ViewLayout {
  const out = { ...base, ...patch };
  if (base.columns || patch.columns) out.columns = { ...base.columns, ...patch.columns };
  return out;
}

/**
 * The layout the user can change (details panel width, column widths, file tree), starting from
 * the one the extension remembered. Changes are saved back once the user stops; `flush` saves now.
 * The remembered layout never overrides something the user has already changed in this view.
 */
export function useLayout(remembered: ViewLayout | undefined, save: (layout: ViewLayout) => void) {
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [columns, setColumns] = useState<Record<Column, number>>({ ...DEFAULT_COLUMNS });
  const [fileTree, setFileTree] = useState(false);
  /** What the user changed in this view: panelWidth, fileTree and `column:<name>`. */
  const touched = useRef(new Set<string>());
  const pending = useRef<ViewLayout>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!remembered) return;
    const t = touched.current;
    if (remembered.panelWidth !== undefined && !t.has('panelWidth'))
      setPanelWidth(clampPanel(remembered.panelWidth));
    if (remembered.fileTree !== undefined && !t.has('fileTree')) setFileTree(remembered.fileTree);
    const cols = remembered.columns;
    if (cols)
      setColumns((cur) => {
        const next = { ...cur };
        for (const c of Object.keys(cols) as Column[])
          if (!t.has(`column:${c}`) && cols[c] !== undefined) next[c] = clampColumn(cols[c]);
        return next;
      });
  }, [remembered]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const flush = () => {
    clearTimeout(timer.current);
    if (Object.keys(pending.current).length === 0) return;
    saveRef.current(pending.current);
    pending.current = {};
  };
  const queue = (patch: ViewLayout, delay = SAVE_MS) => {
    pending.current = merge(pending.current, patch);
    clearTimeout(timer.current);
    if (delay === 0) flush();
    else timer.current = setTimeout(flush, delay);
  };

  return {
    panelWidth,
    columns,
    fileTree,
    /** Sets the details panel width; saved once the user stops. */
    resizePanel(w: number) {
      const width = clampPanel(w);
      touched.current.add('panelWidth');
      setPanelWidth(width);
      queue({ panelWidth: width });
    },
    /** Sets a column width; saved once the user stops. */
    resizeColumn(column: Column, w: number) {
      const width = clampColumn(w);
      touched.current.add(`column:${column}`);
      setColumns((cur) => ({ ...cur, [column]: width }));
      queue({ columns: { [column]: width } });
    },
    /** Shows changed files as a tree or a list; saved at once. */
    setFileTree(tree: boolean) {
      touched.current.add('fileTree');
      setFileTree(tree);
      queue({ fileTree: tree }, 0);
    },
    /** Saves pending changes now (the end of a drag: the view may be closed right after). */
    flush,
  };
}
