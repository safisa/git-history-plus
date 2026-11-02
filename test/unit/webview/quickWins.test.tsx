import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ViewLayout } from '../../../src/shared/protocol';
import { groupRefs } from '../../../webview/components/RefBadge';
import { flush, hashOf, key, makeCommit, makeRef, mountApp, SETTINGS, typeInto, wait } from './helpers';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const search = (root: Element) => root.querySelector('.search-input') as HTMLInputElement;
const separator = (root: Element) => root.querySelector('[aria-label="Resize details panel"]') as HTMLElement;
const saved = (sent: { type: string }[]) =>
  sent.filter((r) => r.type === 'saveLayout') as { type: 'saveLayout'; layout: ViewLayout }[];

describe('combined local and remote badges', () => {
  const ref = (kind: 'branch' | 'remote' | 'tag', name: string, remote?: string) =>
    makeRef({ kind, name, fullName: `refs/${kind}/${name}`, ...(remote ? { remote } : {}) });

  it('folds origin/main into main, and leaves other remote branches and tags alone', () => {
    const main = ref('branch', 'main');
    const originMain = ref('remote', 'origin/main', 'origin');
    const upstreamMain = ref('remote', 'upstream/main', 'upstream');
    const originDev = ref('remote', 'origin/dev', 'origin');
    const tag = ref('tag', 'v1');
    expect(groupRefs([tag, originDev, originMain, main, upstreamMain])).toEqual([
      { ref: main, remotes: [originMain, upstreamMain] },
      { ref: originDev, remotes: [] },
      { ref: tag, remotes: [] },
    ]);
  });

  it('a remote branch whose name has a slash folds into the local branch of the same name', () => {
    const local = ref('branch', 'feat/x');
    const remote = ref('remote', 'origin/feat/x', 'origin');
    expect(groupRefs([remote, local])).toEqual([{ ref: local, remotes: [remote] }]);
  });

  it('a commit row shows one badge with the remote name, and both full names in its tooltip', async () => {
    const refs = [
      makeRef({ kind: 'branch', name: 'main', fullName: 'refs/heads/main' }),
      makeRef({
        kind: 'remote',
        name: 'origin/main',
        fullName: 'refs/remotes/origin/main',
        remote: 'origin',
      }),
    ];
    const h = await mountApp({ width: 900, commits: [makeCommit(0, { refs })] });
    cleanup = h.cleanup;
    const badges = [...h.row(0).querySelectorAll('.ref-badge')] as HTMLElement[];
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toBe('mainorigin');
    expect(badges[0]!.title).toBe('refs/heads/main\nrefs/remotes/origin/main');
  });

  it("right-clicking the remote part opens the remote branch's menu, the rest the local one's", async () => {
    const refs = [
      makeRef({ kind: 'branch', name: 'main', fullName: 'refs/heads/main' }),
      makeRef({
        kind: 'remote',
        name: 'origin/main',
        fullName: 'refs/remotes/origin/main',
        remote: 'origin',
      }),
    ];
    const h = await mountApp({ width: 900, commits: [makeCommit(0, { refs })] });
    cleanup = h.cleanup;
    const menuItems = () => [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent);
    const rightClick = (el: Element) =>
      act(() => {
        el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5 }));
      });
    rightClick(h.row(0).querySelector('.ref-remote')!);
    expect(menuItems().some((t) => /Delete remote branch/i.test(t ?? ''))).toBe(true);
    key(document.activeElement ?? document.body, 'Escape');
    rightClick(h.row(0).querySelector('.ref-name')!);
    expect(menuItems().some((t) => /Delete remote branch/i.test(t ?? ''))).toBe(false);
    expect(menuItems().length).toBeGreaterThan(0);
  });
});

describe('details panel width', () => {
  it('starts at the width remembered by the extension', async () => {
    const h = await mountApp({ width: 900, layout: { panelWidth: 420 } });
    cleanup = h.cleanup;
    expect(separator(h.container).getAttribute('aria-valuenow')).toBe('420');
    await wait(450);
    expect(saved(h.sent)).toEqual([]); // the remembered width is not echoed back
  });

  it('saves the width once the user stops resizing', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    key(separator(h.container), 'ArrowLeft');
    key(separator(h.container), 'ArrowLeft');
    expect(saved(h.sent)).toEqual([]);
    await wait(450);
    expect(saved(h.sent)).toEqual([{ type: 'saveLayout', layout: { panelWidth: 352 } }]);
  });

  it('saves a drag as soon as it ends', async () => {
    const h = await mountApp({ width: 1200 });
    cleanup = h.cleanup;
    const sep = separator(h.container);
    const pointer = (type: string, clientX: number) =>
      sep.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }));
    act(() => {
      pointer('pointerdown', 800);
      pointer('pointermove', 700);
    });
    act(() => pointer('pointerup', 700));
    await flush();
    expect(saved(h.sent)).toEqual([{ type: 'saveLayout', layout: { panelWidth: 420 } }]);
    await wait(450);
    expect(saved(h.sent)).toHaveLength(1);
  });
});

describe('search keys', () => {
  it('Ctrl+F focuses the search box, even from the list (Windows and Linux)', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    expect(search(h.container).getAttribute('aria-keyshortcuts')).toBe('/ Control+F');
    h.grid().focus();
    const ev = key(h.grid(), 'f', { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(search(h.container));
    vi.restoreAllMocks();
  });

  it('on macOS Cmd+F focuses search and Ctrl+F is left alone', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    expect(search(h.container).getAttribute('aria-keyshortcuts')).toBe('/ Meta+F');
    h.grid().focus();
    expect(key(h.grid(), 'f', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(h.grid());
    key(h.grid(), 'F', { metaKey: true });
    expect(document.activeElement).toBe(search(h.container));
    vi.restoreAllMocks();
  });

  it('Ctrl+F inside an open menu leaves the menu its keys', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    h.grid().focus();
    key(h.grid(), 'ArrowDown');
    key(h.grid(), 'ContextMenu');
    const menu = document.querySelector('[role="menu"]')!;
    const item = menu.querySelector('[role="menuitem"]') as HTMLElement;
    item.focus();
    key(item, 'f', { ctrlKey: true });
    expect(document.activeElement).not.toBe(search(h.container));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('Escape clears the search first, then a second Escape goes back to the list', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const input = search(h.container);
    input.focus();
    typeInto(input, 'fix');
    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    key(input, 'Escape');
    expect(document.activeElement).toBe(h.grid());
  });
});

describe('merge commits', () => {
  const commits = [
    makeCommit(0, { parents: [hashOf(1), hashOf(2)], subject: 'Merge branch dev' }),
    makeCommit(1, { parents: [hashOf(2)] }),
  ];

  it('are dimmed by default', async () => {
    const h = await mountApp({ width: 900, commits });
    cleanup = h.cleanup;
    expect(h.row(0).classList.contains('is-merge')).toBe(true);
    expect(h.row(1).classList.contains('is-merge')).toBe(false);
  });

  it('are not dimmed when dimMergeCommits is off', async () => {
    const h = await mountApp({ width: 900, commits, settings: { ...SETTINGS, dimMergeCommits: false } });
    cleanup = h.cleanup;
    expect(h.row(0).classList.contains('is-merge')).toBe(false);
    await flush();
  });
});
