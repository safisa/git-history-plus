import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { button, click, flush, key, makeCommit, makeRef, mountApp, typeInto, wait } from './helpers';

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const search = (root: Element) =>
  root.querySelector('input[aria-label="Search commits"]') as HTMLInputElement;
const options = () => [...document.querySelectorAll('[role="option"]')] as HTMLElement[];

const REFS = [
  makeRef({ kind: 'branch', name: 'main', fullName: 'refs/heads/main', current: true }),
  makeRef({ kind: 'branch', name: 'dev', fullName: 'refs/heads/dev' }),
  makeRef({ kind: 'remote', name: 'origin/main', fullName: 'refs/remotes/origin/main', remote: 'origin' }),
  makeRef({ kind: 'tag', name: 'v1.2', fullName: 'refs/tags/v1.2' }),
];

describe('Toolbar', () => {
  it('parses the search and sends one debounced log request after 300 ms', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const before = h.logs().length;
    const box = search(h.container);
    typeInto(box, 'author:da');
    await wait(100);
    typeInto(box, 'author:dana fix');
    await wait(200);
    expect(h.logs()).toHaveLength(before); // still inside the 300 ms window
    await wait(150);
    expect(h.logs()).toHaveLength(before + 1);
    expect(h.logs().at(-1)!.query).toMatchObject({ author: 'dana', text: 'fix', skip: 0 });
  });

  it('shows "Commit <short> ✕" for an exact hash match; ✕ clears the search', async () => {
    const commits = [
      makeCommit(0, { hash: 'aaaaaaa0000000000000000000000000000000aa' }),
      makeCommit(1, { hash: 'bbbbbbb1111111111111111111111111111111bb' }),
    ];
    const h = await mountApp({ width: 900, commits });
    cleanup = h.cleanup;
    typeInto(search(h.container), 'bbbbbbb1');
    await wait(320);
    const chip = h.container.querySelector('.search-chip') as HTMLElement;
    expect(chip.textContent).toContain('Commit bbbbbbb');
    expect(h.store.getState().selected).toBe(commits[1]!.hash);
    click(button(chip, 'Clear commit search'));
    await flush();
    expect(search(h.container).value).toBe('');
    expect(h.container.querySelector('.search-chip')).toBeNull();
    expect(h.logs().at(-1)!.query.text).toBeUndefined();
  });

  it('branch picker lists Current, All branches, then Branches, Remote and Tags', async () => {
    const h = await mountApp({ width: 900, refs: REFS });
    cleanup = h.cleanup;
    const trigger = button(h.container, /^Branch/)!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('listbox');
    click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(options().map((o) => o.textContent)).toEqual([
      'Current branch',
      'All branches',
      'main',
      'dev',
      'origin/main',
      'v1.2',
    ]);
    const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')].map((g) =>
      g.getAttribute('aria-label'),
    );
    expect(groups).toEqual(['Branches', 'Remote', 'Tags']);
    click(options().find((o) => o.textContent === 'v1.2'));
    await flush();
    expect(h.logs().at(-1)!.query.branch).toEqual({ kind: 'ref', ref: 'refs/tags/v1.2' });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(trigger.textContent).toContain('v1.2');
  });

  it('branch picker filters as you type and picks with the keyboard', async () => {
    const h = await mountApp({ width: 900, refs: REFS });
    cleanup = h.cleanup;
    const trigger = button(h.container, /^Branch/)!;
    click(trigger);
    const filter = document.querySelector('[role="combobox"]') as HTMLInputElement;
    expect(document.activeElement).toBe(filter);
    typeInto(filter, 'all');
    expect(options().map((o) => o.textContent)).toEqual(['All branches']);
    key(filter, 'Enter');
    await flush();
    expect(h.logs().at(-1)!.query.branch).toEqual({ kind: 'all' });
    expect(document.activeElement).toBe(trigger);

    click(trigger);
    const f2 = document.querySelector('[role="combobox"]') as HTMLInputElement;
    key(f2, 'ArrowDown');
    const active = f2.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    // the active option starts on the current value (All branches) and moves down from it
    expect(document.getElementById(active!)?.textContent).toBe('main');
    key(f2, 'Escape');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('author picker is populated from the authors request and filters by that person', async () => {
    const h = await mountApp({
      width: 900,
      authors: [
        { name: 'Dana Levi', email: 'dana@example.com' },
        { name: 'Noa', email: 'noa+git@example.com' },
      ],
    });
    cleanup = h.cleanup;
    expect(h.sent.filter((r) => r.type === 'authors')).toHaveLength(0); // fetched on demand
    const trigger = button(h.container, /^Author/)!;
    click(trigger);
    await flush();
    expect(h.sent.filter((r) => r.type === 'authors')).toHaveLength(1);
    expect(options().map((o) => o.textContent)).toEqual([
      'Any author',
      'Dana Levidana@example.com',
      'Noanoa+git@example.com',
    ]);
    click(options()[2]);
    await flush();
    // bracket expressions are literal in every git regex flavour (BRE, ERE, PCRE)
    expect(h.logs().at(-1)!.query.author).toBe('<noa[+]git@example[.]com>');
    expect(trigger.textContent).toContain('Noa');
  });

  it('a failed authors request is asked again the next time the picker opens', async () => {
    let calls = 0;
    const h = await mountApp({
      width: 900,
      authors: () => {
        if (++calls === 1) throw new Error('git shortlog failed');
        return [{ name: 'Dana', email: 'dana@x.io' }];
      },
    });
    cleanup = h.cleanup;
    const trigger = button(h.container, /^Author/)!;
    click(trigger);
    await flush();
    expect(h.sent.filter((r) => r.type === 'authors')).toHaveLength(1);
    expect(options().map((o) => o.textContent)).toEqual(['Any author']);
    click(trigger); // close
    await flush();
    click(trigger); // reopen: retried, not an empty list for good
    await flush();
    expect(h.sent.filter((r) => r.type === 'authors')).toHaveLength(2);
    expect(options().map((o) => o.textContent)).toEqual(['Any author', 'Danadana@x.io']);
  });

  it('the author picker and search text combine in one query', async () => {
    const h = await mountApp({ width: 900, authors: [{ name: 'Noa', email: 'noa+git@example.com' }] });
    cleanup = h.cleanup;
    click(button(h.container, /^Author/));
    await flush();
    click(options()[1]);
    await flush();
    typeInto(search(h.container), 'fix');
    await wait(320);
    expect(h.logs().at(-1)!.query).toMatchObject({ author: '<noa[+]git@example[.]com>', text: 'fix' });
  });

  it('a search author: overrides the picker; clearing the search restores the picked author', async () => {
    const h = await mountApp({ width: 900, authors: [{ name: 'Dana', email: 'dana@x.io' }] });
    cleanup = h.cleanup;
    click(button(h.container, /^Author/));
    await flush();
    click(options()[1]);
    await flush();
    typeInto(search(h.container), 'author:noa');
    await wait(320);
    expect(h.logs().at(-1)!.query.author).toBe('noa');
    key(search(h.container), 'Escape');
    await flush();
    expect(h.logs().at(-1)!.query.author).toBe('<dana@x[.]io>');
  });

  it('date/count control passes "Last N", Since and Until straight through', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    const trigger = button(h.container, 'Date and count filters')!;
    click(trigger);
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const field = (label: string) => {
      const l = [...dialog.querySelectorAll('label')].find((x) => x.textContent?.startsWith(label))!;
      return document.getElementById(l.htmlFor) as HTMLInputElement;
    };
    typeInto(field('Last'), '50');
    typeInto(field('Since'), '2 weeks ago');
    typeInto(field('Until'), '2026-10-01');
    click(button(dialog, 'Apply'));
    await flush();
    expect(h.logs().at(-1)!.query).toMatchObject({
      maxCount: 50,
      since: '2 weeks ago',
      until: '2026-10-01',
    });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(trigger.classList.contains('is-active')).toBe(true);

    click(trigger);
    click(button(document.querySelector('[role="dialog"]')!, 'Clear'));
    await flush();
    const q = h.logs().at(-1)!.query;
    expect(q.maxCount).toBeUndefined();
    expect(q.since).toBeUndefined();
    expect(q.until).toBeUndefined();
  });

  it('Compare… sends compareRefs and Refresh sends refreshRepo then reloads refs and the log', async () => {
    const h = await mountApp({ width: 900 });
    cleanup = h.cleanup;
    click(button(h.container, /^Compare/));
    await flush();
    expect(h.sent.at(-1)).toEqual({ type: 'compareRefs' });
    const n = h.sent.length;
    click(button(h.container, 'Refresh'));
    await flush();
    expect(h.sent.slice(n).map((r) => r.type)).toEqual(['refreshRepo', 'refs', 'log']);
  });

  it('collapses picker labels to icons in narrow mode but keeps accessible names', async () => {
    const h = await mountApp({ width: 500 });
    cleanup = h.cleanup;
    const toolbar = h.container.querySelector('[role="search"]') as HTMLElement;
    expect(toolbar.getAttribute('aria-label')).toBe('History filters');
    const branch = button(toolbar, /^Branch/)!;
    expect(branch.getAttribute('aria-label')).toBe('Branch: Current branch');
    act(() => branch.focus());
    expect(document.activeElement).toBe(branch);
  });
});
