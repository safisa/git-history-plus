import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { click, flush, key, mountApp, typeInto, wait } from './helpers';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const search = (root: Element) =>
  root.querySelector('input[aria-label="Search commits"]') as HTMLInputElement;
const selectedRows = (root: Element) =>
  [...root.querySelectorAll('[role="row"][aria-selected="true"]')].map((r) => r.getAttribute('data-hash'));

describe('keyboard', () => {
  it('"/" focuses the search input from anywhere outside a text field', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    act(() => h.grid().focus());
    const ev = key(h.grid(), '/');
    expect(document.activeElement).toBe(search(h.container));
    expect(ev.defaultPrevented).toBe(true); // the "/" is not typed into the box
    const typed = key(search(h.container), '/'); // inside the box it is just a character
    expect(typed.defaultPrevented).toBe(false);
  });

  it('ArrowDown / ArrowUp move aria-selected through the rows and the grid tracks it', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const grid = h.grid();
    expect(grid.getAttribute('tabindex')).toBe('0');
    act(() => grid.focus());
    expect(selectedRows(h.container)).toEqual([]);
    key(grid, 'ArrowDown');
    expect(selectedRows(h.container)).toEqual([h.commits[0]!.hash]);
    key(grid, 'ArrowDown');
    key(grid, 'ArrowDown');
    expect(selectedRows(h.container)).toEqual([h.commits[2]!.hash]);
    expect(grid.getAttribute('aria-activedescendant')).toBe(h.row(2).id);
    key(grid, 'ArrowUp');
    expect(selectedRows(h.container)).toEqual([h.commits[1]!.hash]);
    key(grid, 'End');
    expect(selectedRows(h.container)).toEqual([h.commits[4]!.hash]);
    key(grid, 'ArrowDown'); // stays on the last row
    expect(selectedRows(h.container)).toEqual([h.commits[4]!.hash]);
    key(grid, 'Home');
    expect(selectedRows(h.container)).toEqual([h.commits[0]!.hash]);
  });

  it('the grid carries its own focus ring until a rendered row is selected', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const grid = h.grid();
    // nothing selected: focus must show on the grid itself (styles.css outlines .no-active-row on :focus-visible)
    expect(grid.classList.contains('no-active-row')).toBe(true);
    expect(grid.hasAttribute('aria-activedescendant')).toBe(false);
    act(() => grid.focus());
    key(grid, 'ArrowDown');
    expect(grid.classList.contains('no-active-row')).toBe(false);
    expect(document.getElementById(grid.getAttribute('aria-activedescendant')!)).toBe(h.row(0));
  });

  it('ignores arrows with modifiers and arrows typed in nested controls', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    key(h.grid(), 'ArrowDown', { metaKey: true });
    expect(selectedRows(h.container)).toEqual([]);
    key(search(h.container), 'ArrowDown');
    expect(selectedRows(h.container)).toEqual([]);
  });

  it('Escape in the search box clears it and reloads without the filter', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const box = search(h.container);
    act(() => box.focus());
    typeInto(box, 'fix');
    await wait(320);
    expect(h.logs().at(-1)!.query.text).toBe('fix');
    key(box, 'Escape');
    await flush();
    expect(box.value).toBe('');
    expect(h.logs().at(-1)!.query.text).toBeUndefined();
  });

  it('"c" copies the selected commit hash', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    key(h.grid(), 'c');
    expect(h.sent.filter((r) => r.type === 'copy')).toEqual([]); // nothing selected yet
    click(h.row(3));
    key(h.grid(), 'c');
    await flush();
    expect(h.sent.filter((r) => r.type === 'copy')).toEqual([{ type: 'copy', text: h.commits[3]!.hash }]);
    expect(h.container.querySelector('[aria-live="polite"]')?.textContent).toContain('Copied');
  });

  it('Enter toggles the in-place details in narrow mode', async () => {
    const h = await mountApp({ width: 500 });
    cleanup = h.cleanup;
    const grid = h.grid();
    act(() => grid.focus());
    key(grid, 'ArrowDown');
    expect(h.container.querySelector('.details-row')).toBeNull();
    key(grid, 'Enter');
    await flush();
    expect(h.container.querySelector('.details-row h2')?.textContent).toBe('subject 0');
    key(grid, 'ArrowDown'); // the open details follow the selection
    await flush();
    expect(h.container.querySelector('.details-row h2')?.textContent).toBe('subject 1');
    key(grid, 'Enter');
    expect(h.container.querySelector('.details-row')).toBeNull();
  });

  it('Shift+F10 opens the commit menu; arrows move, Escape closes and restores focus', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const grid = h.grid();
    act(() => grid.focus());
    key(grid, 'ArrowDown');
    key(grid, 'F10', { shiftKey: true });
    const menu = document.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).not.toBeNull();
    const items = [...menu.querySelectorAll('[role="menuitem"]')] as HTMLElement[];
    expect(items.map((i) => i.textContent)).toContain('Cherry-pick');
    expect(document.activeElement).toBe(items[0]);
    key(menu, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(menu, 'End');
    expect(document.activeElement).toBe(items.at(-1));
    key(menu, 'ArrowDown'); // wraps
    expect(document.activeElement).toBe(items[0]);
    key(menu, 'Escape');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(grid);
  });

  it('the ContextMenu key opens the same menu, and Enter on an item runs it', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    click(h.row(1));
    key(h.grid(), 'ContextMenu');
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(
      (i) => i.textContent === 'Cherry-pick',
    ) as HTMLElement;
    act(() => item.focus());
    key(item, 'Enter');
    await flush();
    expect(h.sent.filter((r) => r.type === 'action')).toEqual([
      { type: 'action', action: 'cherryPick', hash: h.commits[1]!.hash },
    ]);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('marks keyboard focus with the focusBorder outline in the stylesheet', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const css = readFileSync(resolve(process.cwd(), 'webview/styles.css'), 'utf8');
    expect(css).toMatch(/:focus-visible[^{]*\{[^}]*outline:\s*1px solid var\(--vscode-focusBorder\)/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
