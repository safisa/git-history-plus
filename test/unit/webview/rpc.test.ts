import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Push } from '../../../src/shared/protocol';

type Rpc = typeof import('../../../webview/rpc');

let posted: { id?: number; type: string }[];
let acquire: ReturnType<typeof vi.fn>;

async function load(): Promise<Rpc> {
  vi.resetModules();
  return import('../../../webview/rpc');
}

const deliver = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { data }));

beforeEach(() => {
  posted = [];
  acquire = vi.fn(() => ({ postMessage: (m: { type: string }) => posted.push(m) }));
  vi.stubGlobal('acquireVsCodeApi', acquire);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rpc', () => {
  it('resolves on the response with the matching id, with increasing ids', async () => {
    const rpc = await load();
    const p1 = rpc.request<string[]>({ type: 'refs' });
    const p2 = rpc.request<string>({ type: 'authors' });
    const [m1, m2] = posted;
    expect(m1).toMatchObject({ type: 'refs' });
    expect(m2!.id).toBeGreaterThan(m1!.id!);
    deliver({ id: m2!.id, ok: true, result: 'second' });
    deliver({ id: m1!.id, ok: true, result: ['first'] });
    await expect(p1).resolves.toEqual(['first']);
    await expect(p2).resolves.toBe('second');
  });

  it('rejects with the error message on ok:false', async () => {
    const rpc = await load();
    const p = rpc.request({ type: 'details', hash: 'abcd' });
    deliver({ id: posted[0]!.id, ok: false, error: 'bad revision' });
    await expect(p).rejects.toThrow('bad revision');
  });

  it('calls acquireVsCodeApi exactly once', async () => {
    const rpc = await load();
    void rpc.request({ type: 'refs' });
    void rpc.request({ type: 'refs' });
    rpc.post({ type: 'ready' });
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(posted[2]).toEqual({ type: 'ready' });
  });

  it('rejects after 30 s without a response', async () => {
    vi.useFakeTimers();
    const rpc = await load();
    const p = rpc.request({ type: 'refs' });
    const settled = vi.fn();
    p.catch(settled);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toThrow(/timed out/);
    // a late response is ignored rather than throwing
    deliver({ id: posted[0]!.id, ok: true, result: [] });
  });

  it('routes pushes to push listeners and ignores unrelated messages', async () => {
    const rpc = await load();
    const pushes: Push[] = [];
    const off = rpc.onPush((p) => pushes.push(p));
    const p = rpc.request<number>({ type: 'refs' });
    deliver({ type: 'refresh' });
    deliver({ id: 999_999, ok: true, result: 1 }); // unknown id
    deliver('noise');
    deliver(null);
    deliver({ id: posted[0]!.id, ok: true, result: 7 });
    await expect(p).resolves.toBe(7);
    expect(pushes).toEqual([{ type: 'refresh' }]);
    off();
    deliver({ type: 'refresh' });
    expect(pushes).toHaveLength(1);
  });

  it('routes a settings push', async () => {
    const rpc = await load();
    const pushes: Push[] = [];
    rpc.onPush((p) => pushes.push(p));
    const settings = { dateFormat: 'iso', avatars: 'github' as const, locale: 'en' };
    deliver({ type: 'settings', settings });
    expect(pushes).toEqual([{ type: 'settings', settings }]);
  });
});
