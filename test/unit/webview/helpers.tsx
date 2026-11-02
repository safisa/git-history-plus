import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  Commit,
  Containing,
  FileChange,
  GraphRow,
  LogPage,
  Person,
  Ref,
} from '../../../src/shared/types';
import type { Push, ViewLayout, ViewSettings } from '../../../src/shared/protocol';
import { App } from '../../../webview/App';
import { createStore, type RequestBody } from '../../../webview/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function render(el: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(el));
  return {
    container,
    rerender: (next: ReactElement) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** A fake 40-hex hash; never all zeros (that is WORKTREE, the uncommitted changes row). */
export const hashOf = (i: number) => `${i.toString(16).padStart(39, '0')}1`;

export function makeCommit(i: number, over: Partial<Commit> = {}): Commit {
  const who = { name: `Author ${i}`, email: `a${i}@example.com` };
  return {
    hash: hashOf(i),
    parents: [hashOf(i + 1)],
    author: who,
    authorDate: 1_700_000_000_000 - i * 60_000,
    committer: who,
    commitDate: 1_700_000_000_000 - i * 60_000,
    subject: `subject ${i}`,
    body: '',
    refs: [],
    ...over,
  };
}

export const linearRow = (): GraphRow => ({ lane: 0, color: 0, segments: [] });

export function makeRef(over: Partial<Ref> & Pick<Ref, 'kind' | 'name'>): Ref {
  return { fullName: `refs/x/${over.name}`, target: hashOf(0), current: false, ...over };
}

export const SETTINGS: ViewSettings = { dateFormat: 'iso', avatars: 'off', locale: 'en' };

/**
 * jsdom has no layout, so every element is 0 px tall and the virtualizer would render nothing.
 * Gives every element a fixed clientHeight (the virtualizer reads the scroll element's) until restored.
 */
export function stubViewport(height = 480): () => void {
  // Shadows Element.prototype.clientHeight; deleting the shadow restores jsdom's getter.
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => height });
  return () => {
    delete (proto as { clientHeight?: number }).clientHeight;
  };
}

/**
 * A ResizeObserver stand-in that reports every observed element as `width` px wide, synchronously
 * on `observe` (jsdom has no layout and no ResizeObserver). `resize(w)` re-reports a new width.
 */
export function installResizeObserver(width: number) {
  const observers = new Set<FakeResizeObserver>();
  let current = width;
  class FakeResizeObserver {
    private readonly targets = new Set<Element>();
    constructor(private readonly cb: ResizeObserverCallback) {
      observers.add(this);
    }
    observe(target: Element) {
      this.targets.add(target);
      this.fire(target);
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      observers.delete(this);
    }
    fire(target: Element) {
      const contentRect = { width: current, height: 480, top: 0, left: 0, right: current, bottom: 480 };
      this.cb([{ target, contentRect } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    fireAll() {
      for (const t of this.targets) this.fire(t);
    }
  }
  const g = globalThis as { ResizeObserver?: unknown };
  const w = window as { ResizeObserver?: unknown };
  const prevG = g.ResizeObserver;
  const prevW = w.ResizeObserver;
  g.ResizeObserver = FakeResizeObserver;
  w.ResizeObserver = FakeResizeObserver;
  return {
    resize(next: number) {
      current = next;
      act(() => {
        for (const o of observers) o.fireAll();
      });
    },
    restore() {
      g.ResizeObserver = prevG;
      w.ResizeObserver = prevW;
    },
  };
}

/** Sets an input's value the way a user edit does, so React's onChange fires. */
export function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export function key(target: Element | Document, k: string, init: KeyboardEventInit = {}) {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(ev);
  });
  return ev;
}

export function click(el: Element | null | undefined) {
  if (!el) throw new Error('click: element not found');
  act(() => (el as HTMLElement).click());
}

export const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
export const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

/** Finds a button by its accessible name (aria-label, else text content). */
export function button(root: ParentNode, name: string | RegExp): HTMLButtonElement | undefined {
  return [...root.querySelectorAll('button')].find((b) => {
    const n = b.getAttribute('aria-label') ?? b.textContent ?? '';
    return typeof name === 'string' ? n.trim() === name : name.test(n);
  });
}

export interface HostOptions {
  width: number;
  commits?: Commit[];
  files?: (hash: string) => FileChange[];
  refs?: Ref[];
  /** The `authors` answer, or a function computing it (it may throw to fail the request). */
  authors?: Person[] | (() => Person[]);
  settings?: ViewSettings;
  /** The `avatars` answer: email -> URI. */
  avatars?: Record<string, string>;
  /** Panel mode (default repo); file and line history track `path`. */
  mode?: 'repo' | 'file' | 'folder' | 'line';
  path?: string;
  /** The `details` answer's focusPath for a commit (file and line history). */
  focusPath?: (hash: string) => string | undefined;
  /** The `me` answer (the configured git user). */
  me?: Person;
  /** The `head` answer (HEAD's commit hash). */
  head?: string;
  /** The `containing` answer for a commit. */
  containing?: (hash: string) => Containing;
  /** The remembered layout sent with `init`. */
  layout?: ViewLayout;
}

/**
 * Mounts the whole App against a fake extension host. Every request is recorded in `sent`;
 * `log` answers with `commits` (an exact-hash search answers with that one commit).
 */
export async function mountApp(opts: HostOptions) {
  const ro = installResizeObserver(opts.width);
  const restoreViewport = stubViewport(480);
  const commits = opts.commits ?? Array.from({ length: 5 }, (_, i) => makeCommit(i));
  const sent: RequestBody[] = [];
  const listeners: ((p: Push) => void)[] = [];
  const store = createStore({
    request: async <T,>(req: RequestBody): Promise<T> => {
      sent.push(req);
      switch (req.type) {
        case 'log': {
          const hit = req.query.text && commits.find((c) => c.hash.startsWith(req.query.text!));
          const list = hit ? [hit] : commits;
          const page: LogPage = {
            commits: list,
            graph: list.map(linearRow),
            carry: { lanes: [], colors: [], nextColor: 0 },
            hasMore: false,
            ...(hit ? { exactHash: hit.hash } : {}),
          };
          return page as T;
        }
        case 'refs':
          return (opts.refs ?? []) as T;
        case 'authors':
          return (typeof opts.authors === 'function' ? opts.authors() : (opts.authors ?? [])) as T;
        case 'avatars':
          return (opts.avatars ?? {}) as T;
        case 'me':
          return opts.me as T;
        case 'head':
          return opts.head as T;
        case 'containing':
          return opts.containing?.(req.hash) as T;
        case 'details': {
          const commit = commits.find((c) => c.hash === req.hash)!;
          const focusPath = opts.focusPath?.(req.hash);
          return { commit, files: opts.files?.(req.hash) ?? [], ...(focusPath ? { focusPath } : {}) } as T;
        }
        default:
          return undefined as T;
      }
    },
    onPush: (l) => {
      listeners.push(l);
      return () => undefined;
    },
  });
  const r = render(<App store={store} />);
  act(() =>
    listeners.forEach((l) =>
      l({
        type: 'init',
        mode: opts.mode ?? 'repo',
        query: {
          branch: { kind: 'current' },
          skip: 0,
          pageSize: 100,
          ...(opts.mode === 'line' && opts.path
            ? { lines: { path: opts.path, start: 1, end: 2 } }
            : opts.path
              ? { path: opts.path, follow: true }
              : {}),
        },
        settings: opts.settings ?? SETTINGS,
        repoName: 'repo',
        ...(opts.layout === undefined ? {} : { layout: opts.layout }),
      }),
    ),
  );
  await flush();
  return {
    ...r,
    store,
    sent,
    commits,
    resize: ro.resize,
    logs: () => sent.filter((q) => q.type === 'log') as Extract<RequestBody, { type: 'log' }>[],
    push: (p: Push) => act(() => listeners.forEach((l) => l(p))),
    row: (i: number) => r.container.querySelector(`[data-hash="${commits[i]!.hash}"]`) as HTMLElement,
    grid: () => r.container.querySelector('[role="grid"]') as HTMLElement,
    cleanup: () => {
      r.unmount();
      ro.restore();
      restoreViewport();
    },
  };
}
