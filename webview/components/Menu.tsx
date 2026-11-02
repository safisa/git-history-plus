import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { MenuEntry, MenuItem } from '../commitActions';

export interface MenuRequest {
  /** Accessible name of the menu. */
  label: string;
  entries: MenuEntry[];
  /** Viewport coordinates of the top-left corner (clamped to stay on screen). */
  at: { x: number; y: number };
  /** Gets focus back when the menu closes from the keyboard or runs an item. */
  restoreFocus?: HTMLElement | null;
}

/** Where to open a menu for a trigger element: just below its left edge. */
export function below(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.bottom + 2 };
}

/** True for the keys that open a context menu from the keyboard. */
export const isMenuKey = (e: { key: string; shiftKey: boolean }) =>
  e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey);

const MARGIN = 4;

/**
 * A popover context menu (WAI-ARIA menu pattern): focus moves to the first item, arrows/Home/End move
 * (wrapping), Enter/Space run an item, Escape/Tab close. A mousedown elsewhere or losing the window closes it.
 */
export function Menu({ request, onClose }: { request: MenuRequest; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(request.at);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      x: Math.max(MARGIN, Math.min(request.at.x, window.innerWidth - r.width - MARGIN)),
      y: Math.max(MARGIN, Math.min(request.at.y, window.innerHeight - r.height - MARGIN)),
    });
    items()[0]?.focus();
  }, [request]);

  useEffect(() => {
    const outside = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const blur = () => onClose();
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('resize', blur);
    };
  }, [onClose]);

  const items = () => [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];

  const close = () => {
    onClose();
    request.restoreFocus?.focus();
  };
  const run = (item: MenuItem) => {
    if (item.disabled) return;
    close();
    item.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => all[(i + all.length) % all.length]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        focus(at + 1);
        break;
      case 'ArrowUp':
        focus(at < 0 ? -1 : at - 1);
        break;
      case 'Home':
        focus(0);
        break;
      case 'End':
        focus(-1);
        break;
      case 'Escape':
      case 'Tab':
        close();
        break;
      case 'Enter':
      case ' ': {
        const i = Number((document.activeElement as HTMLElement | null)?.dataset.item);
        const entry = request.entries[i];
        if (entry && entry !== '-') run(entry);
        break;
      }
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={request.label}
      className="menu"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {request.entries.map((entry, i) =>
        entry === '-' ? (
          <div key={i} role="separator" className="menu-separator" />
        ) : (
          <div
            key={i}
            role="menuitem"
            tabIndex={-1}
            data-item={i}
            aria-disabled={entry.disabled || undefined}
            className="menu-item"
            onClick={() => run(entry)}
            onMouseEnter={(e) => e.currentTarget.focus()}
          >
            <span className={`codicon codicon-${entry.icon ?? 'blank'}`} aria-hidden="true" />
            {entry.label}
          </div>
        ),
      )}
    </div>
  );
}
