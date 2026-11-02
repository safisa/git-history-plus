import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Commit, GraphRow } from '../../../src/shared/types';
import { CommitTable, type CommitTableProps } from '../../../webview/components/CommitTable';
import { SETTINGS, linearRow, makeCommit, makeRef, render, stubViewport } from './helpers';

let cleanup: (() => void) | undefined;
let restoreViewport: () => void;
beforeEach(() => {
  restoreViewport = stubViewport(480);
});
afterEach(() => {
  cleanup?.();
  restoreViewport();
});

function table(commits: Commit[], over: Partial<CommitTableProps> = {}) {
  const props: CommitTableProps = {
    commits,
    graph: commits.map(linearRow) as GraphRow[],
    hasMore: false,
    loading: false,
    settings: SETTINGS,
    onSelect: vi.fn(),
    onLoadMore: vi.fn(),
    ...over,
  };
  const r = render(<CommitTable {...props} />);
  cleanup = r.unmount;
  return { ...r, props };
}

const dataRows = (root: Element) => [...root.querySelectorAll('[role="row"][data-hash]')];

describe('CommitTable', () => {
  it('virtualizes: 10,000 commits render fewer than 100 rows', () => {
    const commits = Array.from({ length: 10_000 }, (_, i) => makeCommit(i));
    const { container } = table(commits);
    const rows = container.querySelectorAll('[role="row"]');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
  });

  it('is a grid whose aria-rowcount counts the header, the loaded rows and a pending page', () => {
    const commits = Array.from({ length: 30 }, (_, i) => makeCommit(i));
    const grid = table(commits, { hasMore: true }).container.querySelector('[role="grid"]')!;
    expect(grid.getAttribute('aria-rowcount')).toBe('32');
    cleanup!();
    const grid2 = table(commits, { hasMore: false }).container.querySelector('[role="grid"]')!;
    expect(grid2.getAttribute('aria-rowcount')).toBe('31');
    expect(grid2.querySelectorAll('[role="columnheader"]')).toHaveLength(5);
  });

  it('renders repository text as literal text (XSS)', () => {
    const evilRef = makeRef({ kind: 'branch', name: '<svg/onload=alert(1)>' });
    const evilTag = makeRef({ kind: 'tag', name: '"><img src=x onerror=alert(2)>' });
    const commit = makeCommit(0, {
      subject: '<img src=x onerror=alert(1)>',
      author: { name: '<script>alert(3)</script>', email: '"><img src=x>' },
      refs: [evilRef, evilTag],
    });
    const { container } = table([commit]);
    const text = container.textContent ?? '';
    expect(text).toContain('<img src=x onerror=alert(1)>');
    expect(text).toContain('<svg/onload=alert(1)>');
    expect(text).toContain('"><img src=x onerror=alert(2)>');
    expect(text).toContain('<script>alert(3)</script>');
    expect(container.querySelector('svg[onload], img, script')).toBeNull();
    // no data reaches a style attribute
    for (const el of container.querySelectorAll('[style]')) {
      expect(el.getAttribute('style')).not.toMatch(/alert|img|svg/);
    }
  });

  it('shows short hash, author and a formatted date', () => {
    const commit = makeCommit(0, { authorDate: Date.UTC(2024, 0, 2, 3, 4) });
    const row = dataRows(table([commit]).container)[0]!;
    expect(row.textContent).toContain(commit.hash.slice(0, 7));
    expect(row.textContent).toContain('Author 0');
    expect(row.textContent).toContain('2024-01-02 03:04');
  });

  it('renders ref badges with codicons, the current branch bold', () => {
    const commit = makeCommit(0, {
      refs: [
        makeRef({ kind: 'branch', name: 'main', current: true }),
        makeRef({ kind: 'branch', name: 'dev' }),
        makeRef({ kind: 'remote', name: 'origin/feature', remote: 'origin' }),
        makeRef({ kind: 'tag', name: 'v1.2' }),
      ],
    });
    const { container } = table([commit]);
    const badges = [...container.querySelectorAll('.ref-badge')];
    expect(badges.map((b) => b.textContent)).toEqual(['main', 'dev', 'origin/feature', 'v1.2']);
    const icon = (b: Element) => b.querySelector('.codicon')!.className;
    expect(icon(badges[0]!)).toContain('codicon-git-branch');
    expect(icon(badges[2]!)).toContain('codicon-cloud');
    expect(icon(badges[3]!)).toContain('codicon-tag');
    expect(badges[0]!.classList.contains('ref-badge--current')).toBe(true);
    expect(badges[1]!.classList.contains('ref-badge--current')).toBe(false);
  });

  it('selects a row on click and marks it aria-selected', () => {
    const commits = [makeCommit(0), makeCommit(1)];
    const { container, props, rerender } = table(commits);
    act(() => (dataRows(container)[1] as HTMLElement).click());
    expect(props.onSelect).toHaveBeenCalledWith(commits[1]!.hash);
    rerender(<CommitTable {...props} selected={commits[1]!.hash} />);
    const rows = dataRows(container);
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true');
    expect(rows[0]!.getAttribute('aria-selected')).toBe('false');
  });

  it('asks for more when the last rendered row is within 20 of the end', () => {
    const commits = Array.from({ length: 25 }, (_, i) => makeCommit(i));
    const onLoadMore = vi.fn();
    table(commits, { hasMore: true, onLoadMore });
    expect(onLoadMore).toHaveBeenCalled();
  });

  it('does not ask for more when there is nothing more or a page is loading', () => {
    const commits = Array.from({ length: 25 }, (_, i) => makeCommit(i));
    const a = vi.fn();
    table(commits, { hasMore: false, onLoadMore: a });
    cleanup!();
    const b = vi.fn();
    table(commits, { hasMore: true, loading: true, onLoadMore: b });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('does not ask for more when far from the end', () => {
    const commits = Array.from({ length: 500 }, (_, i) => makeCommit(i));
    const onLoadMore = vi.fn();
    table(commits, { hasMore: true, onLoadMore });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('shows skeleton rows while the first page loads', () => {
    const { container } = table([], { loading: true });
    expect(container.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    expect(container.querySelector('[role="grid"]')!.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).not.toContain('No commits match');
  });

  it('says "No commits match" for an empty result', () => {
    const { container } = table([], { loading: false });
    expect(container.textContent).toContain('No commits match');
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(0);
  });
});
