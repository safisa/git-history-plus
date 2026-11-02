import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

export interface PickerOption {
  id: string;
  label: string;
  detail?: string;
}
export interface PickerGroup {
  /** Groups without a label render their options at the top level. */
  label?: string;
  options: PickerOption[];
}

export interface PickerProps {
  /** What is being picked, e.g. "Branch"; the trigger's accessible name is "<name>: <value>". */
  name: string;
  icon: string;
  valueLabel: string;
  selectedId: string;
  groups: PickerGroup[];
  /** Shown instead of options while they are fetched. */
  loading?: boolean;
  onOpen?(): void;
  onPick(id: string): void;
}

/** Long ref/author lists stay responsive: only this many matches render; typing narrows them. */
const MAX_SHOWN = 200;

/**
 * A dropdown with a filter box (WAI-ARIA combobox + listbox). The filter keeps focus; arrows move the
 * active option (aria-activedescendant), Enter picks it, Escape closes and returns focus to the trigger.
 */
export function Picker(p: PickerProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optId = (i: number) => `${baseId}-opt-${i}`;

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    let budget = MAX_SHOWN;
    let hidden = 0;
    const groups: PickerGroup[] = [];
    for (const g of p.groups) {
      const matches = f
        ? g.options.filter((o) => `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(f))
        : g.options;
      const take = matches.slice(0, Math.max(0, budget));
      budget -= take.length;
      hidden += matches.length - take.length;
      if (take.length) groups.push({ ...g, options: take });
    }
    return { groups, flat: groups.flatMap((g) => g.options), hidden };
  }, [p.groups, filter]);

  const close = (refocus: boolean) => {
    setOpen(false);
    setFilter('');
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (o: PickerOption | undefined) => {
    if (!o) return;
    close(true);
    p.onPick(o.id);
  };

  const toggle = () => {
    if (open) return close(false);
    p.onOpen?.();
    setOpen(true);
  };

  // Start on the current value; when the filter changes, start on the first match.
  useEffect(() => {
    if (!open) return;
    const i = shown.flat.findIndex((o) => o.id === p.selectedId);
    setActive(filter ? 0 : Math.max(0, i));
  }, [open, filter, p.loading]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const outside = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('mousedown', outside, true);
    return () => document.removeEventListener('mousedown', outside, true);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = shown.flat.length;
    switch (e.key) {
      case 'ArrowDown':
        setActive((a) => (n ? (a + 1) % n : 0));
        break;
      case 'ArrowUp':
        setActive((a) => (n ? (a - 1 + n) % n : 0));
        break;
      case 'Enter':
        pick(shown.flat[active]);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        close(false);
        return; // let focus move on
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  let index = 0;
  const renderOption = (o: PickerOption) => {
    const i = index++;
    return (
      <div
        key={o.id}
        id={optId(i)}
        role="option"
        aria-selected={o.id === p.selectedId}
        className={i === active ? 'picker-option is-active' : 'picker-option'}
        onMouseDown={(e) => e.preventDefault()} // keep focus in the filter box
        onMouseMove={() => setActive(i)}
        onClick={() => pick(o)}
      >
        <span className="picker-option-label">{o.label}</span>
        {o.detail && <span className="picker-option-detail">{o.detail}</span>}
      </div>
    );
  };

  return (
    <div className="picker" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="toolbar-button picker-trigger"
        aria-label={`${p.name}: ${p.valueLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${p.name}: ${p.valueLabel}`}
        onClick={toggle}
      >
        <span className={`codicon codicon-${p.icon}`} aria-hidden="true" />
        <span className="picker-label">{p.valueLabel}</span>
        <span className="codicon codicon-chevron-down" aria-hidden="true" />
      </button>
      {open && (
        <div className="popover picker-popover">
          <input
            ref={inputRef}
            className="picker-filter"
            role="combobox"
            aria-label={`Filter ${p.name.toLowerCase()} list`}
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={shown.flat.length ? optId(active) : undefined}
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <div id={listId} role="listbox" aria-label={p.name} className="picker-list">
            {p.loading ? (
              <div className="picker-note">Loading…</div>
            ) : (
              shown.groups.map((g, gi) =>
                g.label ? (
                  <div key={g.label} role="group" aria-label={g.label}>
                    <div className="picker-group-label" aria-hidden="true">
                      {g.label}
                    </div>
                    {g.options.map(renderOption)}
                  </div>
                ) : (
                  <div key={`g${gi}`} role="presentation">
                    {g.options.map(renderOption)}
                  </div>
                ),
              )
            )}
            {!p.loading && shown.flat.length === 0 && <div className="picker-note">No matches</div>}
            {shown.hidden > 0 && <div className="picker-note">{shown.hidden} more — type to filter</div>}
          </div>
        </div>
      )}
    </div>
  );
}
