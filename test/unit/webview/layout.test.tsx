import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { click, flush, key, mountApp } from './helpers';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const headers = (root: Element) =>
  [...root.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent);

describe('adaptive layout', () => {
  it('at 900 px renders the side panel and the Author, Date and Hash columns', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const side = h.container.querySelector('aside[aria-label="Commit details"]');
    expect(side).not.toBeNull();
    expect(headers(h.container)).toEqual(['Graph', 'Message', 'Author', 'Date', 'Hash']);
    expect(h.row(0).querySelector('.cell-hash')?.textContent).toBe(h.commits[0]!.hash.slice(0, 7));
    expect(side!.textContent).toContain('Select a commit');

    click(h.row(2));
    await flush();
    expect(side!.querySelector('h2')?.textContent).toBe('subject 2');
    expect(h.container.querySelector('.details-row')).toBeNull(); // never in place when wide
  });

  it('at 500 px hides Author, Date and Hash and renders the details right after the selected row', async () => {
    const h = await mountApp({ width: 500 });
    cleanup = h.cleanup;
    expect(h.container.querySelector('aside')).toBeNull();
    expect(headers(h.container)).toEqual(['Graph', 'Message']);
    expect(h.container.querySelector('.cell-hash')).toBeNull();
    expect(h.container.querySelector('.cell-author')).toBeNull();

    click(h.row(1));
    await flush();
    const rows = [...h.container.querySelectorAll('.commit-rows > [role="row"]')];
    const at = rows.indexOf(h.row(1));
    expect(at).toBeGreaterThanOrEqual(0);
    const next = rows[at + 1]!;
    expect(next.classList.contains('details-row')).toBe(true);
    expect(next.querySelector('[aria-label="Commit details"] h2')?.textContent).toBe('subject 1');
    expect(rows[at + 2]).toBe(h.row(2));

    click(h.row(1)); // clicking the open row folds it away again
    expect(h.container.querySelector('.details-row')).toBeNull();
  });

  it('switches layouts when the view is resized', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    click(h.row(0));
    await flush();
    h.resize(650);
    expect(h.container.querySelector('aside')).toBeNull();
    expect(headers(h.container)).not.toContain('Hash');
    h.resize(700); // 700 is already wide
    expect(h.container.querySelector('aside')).not.toBeNull();
    expect(headers(h.container)).toContain('Hash');
  });

  it('the side panel starts at 320 px and resizes from the keyboard between 240 and 600 px', async () => {
    const h = await mountApp({ width: 1200 });
    cleanup = h.cleanup;
    const sep = h.container.querySelector('[aria-label="Resize details panel"]') as HTMLElement;
    const side = h.container.querySelector('aside') as HTMLElement;
    expect(sep.getAttribute('aria-valuenow')).toBe('320');
    expect(sep.getAttribute('aria-valuemin')).toBe('240');
    expect(sep.getAttribute('aria-valuemax')).toBe('600');
    expect(side.style.width).toBe('320px');
    key(sep, 'ArrowLeft'); // dragging the splitter left widens the panel
    expect(sep.getAttribute('aria-valuenow')).toBe('336');
    key(sep, 'End');
    expect(sep.getAttribute('aria-valuenow')).toBe('600');
    key(sep, 'ArrowLeft');
    expect(sep.getAttribute('aria-valuenow')).toBe('600');
    key(sep, 'Home');
    expect(sep.getAttribute('aria-valuenow')).toBe('240');
    expect(side.style.width).toBe('240px');
  });

  it('drags the splitter with the pointer, clamped to 240–600 px', async () => {
    const h = await mountApp({ width: 1200 });
    cleanup = h.cleanup;
    const sep = h.container.querySelector('[aria-label="Resize details panel"]') as HTMLElement;
    const pointer = (type: string, clientX: number) =>
      sep.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }));
    act(() => {
      pointer('pointerdown', 800);
      pointer('pointermove', 700);
    });
    expect(sep.getAttribute('aria-valuenow')).toBe('420');
    act(() => {
      pointer('pointermove', 0);
      pointer('pointerup', 0);
    });
    expect(sep.getAttribute('aria-valuenow')).toBe('600');
  });
});
