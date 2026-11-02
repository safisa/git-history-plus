import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { AvatarService } from '../../src/avatars';

const mem = () => {
  const m = new Map<string, unknown>();
  return {
    keys: () => [...m.keys()],
    get: <T>(k: string, d?: T) => (m.has(k) ? (m.get(k) as T) : d),
    update: async (k: string, v: unknown) => void m.set(k, v),
  } as never;
};
const img =
  (type = 'image/png', body = 'PNGDATA') =>
  () =>
    Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': type } }));
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const urls = (f: ReturnType<typeof vi.fn>) => f.mock.calls.map((c) => String(c[0]));

describe('AvatarService', () => {
  it('gravatar hashes the lowercased trimmed email', async () => {
    const f = vi.fn(img());
    const r = await new AvatarService('gravatar', mem(), f).get(['Foo@Example.com ']);
    expect(urls(f)).toEqual([`https://www.gravatar.com/avatar/${md5('foo@example.com')}?s=32&d=404`]);
    expect(r['foo@example.com']).toBe(`data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}`);
  });
  it('github maps noreply emails to the login, ignores others', async () => {
    const f = vi.fn(img());
    const r = await new AvatarService('github', mem(), f).get([
      '123+octo@users.noreply.github.com',
      'cat@users.noreply.github.com',
      'x@example.com',
    ]);
    expect(urls(f).sort()).toEqual([
      'https://github.com/cat.png?size=32',
      'https://github.com/octo.png?size=32',
    ]);
    expect(Object.keys(r).sort()).toEqual([
      '123+octo@users.noreply.github.com',
      'cat@users.noreply.github.com',
    ]);
  });
  it('drops non-image, svg, oversized, failed and non-ok responses', async () => {
    const big = 'x'.repeat(256 * 1024 + 1);
    for (const fn of [
      img('text/html'),
      img('image/svg+xml', '<svg/>'),
      img('image/png', big),
      () => Promise.reject(new Error('net')),
      () => Promise.resolve(new Response('', { status: 404, headers: { 'content-type': 'image/png' } })),
    ]) {
      expect(await new AvatarService('gravatar', mem(), vi.fn(fn)).get(['a@b.c'])).toEqual({});
    }
  });
  it('serves repeat calls (including misses) from cache; dedupes in-call', async () => {
    const f = vi.fn(img());
    const s = new AvatarService('gravatar', mem(), f);
    await s.get(['a@b.c', 'A@B.c']);
    expect(f).toHaveBeenCalledTimes(1);
    await s.get(['a@b.c']);
    expect(f).toHaveBeenCalledTimes(1);
    const miss = vi.fn(img('text/html'));
    const s2 = new AvatarService('gravatar', mem(), miss);
    await s2.get(['a@b.c']);
    await s2.get(['a@b.c']);
    expect(miss).toHaveBeenCalledTimes(1);
  });
  it('expires after 7 days and keys by mode', async () => {
    const store = mem();
    const f = vi.fn(img());
    const email = '1+u@users.noreply.github.com';
    await new AvatarService('github', store, f).get([email]);
    await new AvatarService('gravatar', store, f).get([email]);
    expect(f).toHaveBeenCalledTimes(2);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 8 * 86400_000);
    await new AvatarService('github', store, f).get([email]);
    vi.restoreAllMocks();
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('limits concurrency to 4 and sends only the URL with timeout/redirect', async () => {
    let cur = 0,
      max = 0;
    const f = vi.fn<typeof fetch>(async () => {
      max = Math.max(max, ++cur);
      await new Promise((r) => setTimeout(r, 5));
      cur--;
      return new Response('x', { headers: { 'content-type': 'image/gif' } });
    });
    await new AvatarService('gravatar', mem(), f).get(Array.from({ length: 12 }, (_, i) => `u${i}@x.io`));
    expect(max).toBe(4);
    const o = f.mock.calls[0]![1]!;
    expect(o.redirect).toBe('follow');
    expect(o.signal).toBeInstanceOf(AbortSignal);
    expect(o.headers).toBeUndefined();
  });
  it('accepts case-variant content types with parameters', async () => {
    const r = await new AvatarService('gravatar', mem(), vi.fn(img('IMAGE/PNG; charset=binary'))).get([
      'a@b.c',
    ]);
    expect(r['a@b.c']).toMatch(/^data:image\/png;base64,/);
  });
  it('stops reading a chunked body without content-length once over the cap', async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        pulls++;
        c.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const f = vi.fn(() => Promise.resolve(new Response(body, { headers: { 'content-type': 'image/png' } })));
    expect(await new AvatarService('gravatar', mem(), f).get(['a@b.c'])).toEqual({});
    expect(pulls).toBeLessThan(10);
  });
});
