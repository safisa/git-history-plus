import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FileChange } from '../../../src/shared/types';
import { click, flush, key, mountApp } from './helpers';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const FILES: FileChange[] = [
  { status: 'D', path: 'deploy.flow', additions: 0, deletions: 191 },
  { status: 'M', path: '.theia/settings.json', additions: 0, deletions: 1 },
  { status: 'D', path: 'Globals.java', additions: 0, deletions: 15 },
];

const panel = (root: Element) => root.querySelector('aside[aria-label="Commit details"]') as HTMLElement;
const versionDiffs = (sent: { type: string }[]) => sent.filter((r) => r.type === 'openVersionDiff');

async function mount(mode: 'repo' | 'file' | 'line') {
  const h = await mountApp({
    width: 900,
    files: () => FILES,
    mode,
    ...(mode === 'repo' ? {} : { path: '.theia/settings.json', focusPath: () => '.theia/settings.json' }),
  });
  cleanup = h.cleanup;
  return h;
}

describe('file history details', () => {
  it('lists the tracked file first and folds the other files of the commit away', async () => {
    const h = await mount('file');
    click(h.row(1));
    await flush();
    const p = panel(h.container);
    const mine = p.querySelector('[aria-label="This file"]') as HTMLElement;
    expect(mine.textContent).toContain('settings.json');
    expect(mine.textContent).not.toContain('deploy.flow');
    const others = p.querySelector('details.details-other-files') as HTMLDetailsElement;
    expect(others.open).toBe(false);
    expect(others.querySelector('summary')!.textContent).toBe('Other files in this commit (2)');
    expect(others.textContent).toContain('deploy.flow');
  });

  it('keeps one plain file list in repository history', async () => {
    const h = await mount('repo');
    click(h.row(1));
    await flush();
    const p = panel(h.container);
    expect(p.querySelector('[aria-label="This file"]')).toBeNull();
    expect(p.querySelector('details.details-other-files')).toBeNull();
    expect(p.textContent).toContain('deploy.flow');
  });
});

const dblclick = (el: Element) =>
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  });
const rightClick = (el: Element) =>
  act(() => {
    el.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }),
    );
  });
const menuItem = (label: string) =>
  [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === label) as
    HTMLElement | undefined;

describe('file history rows: click selects, double-click / menu / Enter open the version diff', () => {
  it.each(['file', 'line'] as const)('a single click in %s history only selects', async (mode) => {
    const h = await mount(mode);
    click(h.row(2));
    await flush();
    expect(h.row(2).getAttribute('aria-selected')).toBe('true');
    expect(versionDiffs(h.sent)).toEqual([]);
  });

  it.each(['file', 'line'] as const)('a double-click opens that version in %s history', async (mode) => {
    const h = await mount(mode);
    dblclick(h.row(2));
    await flush();
    expect(versionDiffs(h.sent)).toEqual([{ type: 'openVersionDiff', hash: h.commits[2]!.hash }]);
  });

  it('the row menu offers Open Changes first, and it opens that version', async () => {
    const h = await mount('file');
    rightClick(h.row(1));
    await flush();
    expect(document.querySelector('[role="menuitem"]')!.textContent).toBe('Open Changes');
    click(menuItem('Open Changes'));
    await flush();
    expect(versionDiffs(h.sent)).toEqual([{ type: 'openVersionDiff', hash: h.commits[1]!.hash }]);
  });

  it('the details "More actions" menu offers Open Changes too', async () => {
    const h = await mount('file');
    click(h.row(1));
    await flush();
    click(panel(h.container).querySelector('button[aria-label="More actions"]'));
    await flush();
    click(menuItem('Open Changes'));
    await flush();
    expect(versionDiffs(h.sent)).toEqual([{ type: 'openVersionDiff', hash: h.commits[1]!.hash }]);
  });

  it('arrow keys only move the selection; Enter opens the selected version', async () => {
    const h = await mount('file');
    click(h.row(0));
    await flush();
    key(h.grid(), 'ArrowDown');
    await flush();
    expect(versionDiffs(h.sent)).toEqual([]);
    key(h.grid(), 'Enter');
    await flush();
    expect(versionDiffs(h.sent)).toEqual([{ type: 'openVersionDiff', hash: h.commits[1]!.hash }]);
  });

  it('repository history: double-click opens nothing and the menu has no Open Changes', async () => {
    const h = await mount('repo');
    dblclick(h.row(2));
    await flush();
    expect(versionDiffs(h.sent)).toEqual([]);
    rightClick(h.row(1));
    await flush();
    expect(menuItem('Open Changes')).toBeUndefined();
  });

  it('a double-click in the narrow layout leaves the details open', async () => {
    const h = await mountApp({ width: 500, files: () => FILES, mode: 'file', path: '.theia/settings.json' });
    cleanup = h.cleanup;
    dblclick(h.row(1));
    await flush();
    expect(h.container.querySelector('section[aria-label="Commit details"]')).not.toBeNull();
  });
});
