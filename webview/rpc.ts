import type { Push, Request, Response } from '../src/shared/protocol';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A request without its id; distributive so each variant keeps its own fields. */
export type RequestBody = DistributiveOmit<Request, 'id'>;

interface VsCodeApi {
  postMessage(msg: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const TIMEOUT_MS = 30_000;

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let api: VsCodeApi | undefined;
let nextId = 1;
const pending = new Map<number, Pending>();
const pushListeners = new Set<(p: Push) => void>();

const isResponse = (m: unknown): m is Response =>
  typeof m === 'object' &&
  m !== null &&
  typeof (m as { id?: unknown }).id === 'number' &&
  typeof (m as { ok?: unknown }).ok === 'boolean';

const isPush = (m: unknown): m is Push => {
  const t = typeof m === 'object' && m !== null ? (m as { type?: unknown }).type : undefined;
  return t === 'init' || t === 'refresh' || t === 'settings';
};

function onMessage(e: MessageEvent): void {
  const m: unknown = e.data;
  if (isResponse(m)) {
    const p = pending.get(m.id);
    if (!p) return; // timed out or not ours
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(new Error(m.error));
  } else if (isPush(m)) {
    for (const l of pushListeners) l(m);
  }
}

/** acquireVsCodeApi() may only be called once per webview, so it is cached here. */
function vscodeApi(): VsCodeApi {
  if (!api) {
    api = acquireVsCodeApi();
    window.addEventListener('message', onMessage);
  }
  return api;
}

/** Sends a request and resolves with its result; rejects on `ok:false` or after 30 s. */
export function request<T>(req: RequestBody): Promise<T> {
  const host = vscodeApi();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Request '${req.type}' timed out`));
    }, TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    host.postMessage({ ...req, id });
  });
}

/** Posts a message that expects no response (e.g. `{type:'ready'}`). */
export function post(msg: { type: 'ready' }): void {
  vscodeApi().postMessage(msg);
}

/** Subscribes to extension pushes (`init`, `refresh`, `settings`); returns an unsubscribe function. */
export function onPush(listener: (p: Push) => void): () => void {
  vscodeApi();
  pushListeners.add(listener);
  return () => pushListeners.delete(listener);
}
