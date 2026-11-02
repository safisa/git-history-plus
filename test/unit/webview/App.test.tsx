import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Push } from '../../../src/shared/protocol';
import type { LogPage } from '../../../src/shared/types';
import { App } from '../../../webview/App';
import { createStore, type RequestBody } from '../../../webview/store';
import { SETTINGS, linearRow, makeCommit, render, stubViewport } from './helpers';

let cleanup: (() => void) | undefined;
let restoreViewport: () => void;
beforeEach(() => {
  restoreViewport = stubViewport(480);
});
afterEach(() => {
  cleanup?.();
  restoreViewport();
});

const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

function setup(results: (LogPage | Error)[]) {
  const listeners: ((p: Push) => void)[] = [];
  const logs: RequestBody[] = [];
  const store = createStore({
    request: async <T,>(req: RequestBody): Promise<T> => {
      if (req.type === 'refs') return [] as T;
      logs.push(req);
      const next = results.shift();
      if (!next) return new Promise<T>(() => undefined);
      if (next instanceof Error) throw next;
      return next as T;
    },
    onPush: (l) => {
      listeners.push(l);
      return () => undefined;
    },
  });
  const r = render(<App store={store} />);
  cleanup = r.unmount;
  const init = () =>
    act(() =>
      listeners.forEach((l) =>
        l({
          type: 'init',
          mode: 'repo',
          query: { branch: { kind: 'current' }, skip: 0, pageSize: 50 },
          settings: SETTINGS,
          repoName: 'repo',
        }),
      ),
    );
  return { ...r, store, init, logs };
}

describe('App', () => {
  it('shows skeleton rows until the first page arrives, then the commits', async () => {
    const commits = [makeCommit(0), makeCommit(1)];
    const page: LogPage = {
      commits,
      graph: commits.map(linearRow),
      carry: { lanes: [], colors: [], nextColor: 0 },
      hasMore: false,
    };
    const { container, init } = setup([page]);
    expect(container.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0);
    init();
    await flush();
    expect(container.querySelectorAll('.skeleton-row')).toHaveLength(0);
    expect(container.textContent).toContain('subject 1');
  });

  it('shows an inline error banner with a Retry button that reloads', async () => {
    const empty: LogPage = {
      commits: [],
      graph: [],
      carry: { lanes: [], colors: [], nextColor: 0 },
      hasMore: false,
    };
    const { container, init, logs } = setup([new Error('fatal: <b>bad</b> revision'), empty]);
    init();
    await flush();
    const banner = container.querySelector('[role="alert"]')!;
    expect(banner.textContent).toContain('fatal: <b>bad</b> revision');
    expect(banner.querySelector('b')).toBeNull();
    expect(container.textContent).not.toContain('No commits match'); // a failure is not an empty result
    const retry = [...banner.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!;
    act(() => retry.click());
    await flush();
    expect(logs).toHaveLength(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('No commits match');
  });

  it('selects a commit in the store when its row is clicked', async () => {
    const commits = [makeCommit(0), makeCommit(1)];
    const { container, init, store } = setup([
      {
        commits,
        graph: commits.map(linearRow),
        carry: { lanes: [], colors: [], nextColor: 0 },
        hasMore: false,
      },
    ]);
    init();
    await flush();
    const row = container.querySelector(`[data-hash="${commits[1]!.hash}"]`) as HTMLElement;
    act(() => row.click());
    expect(store.getState().selected).toBe(commits[1]!.hash);
    expect(row.getAttribute('aria-selected')).toBe('true');
  });
});
