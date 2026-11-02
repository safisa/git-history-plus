import { createHash } from 'node:crypto';
import type * as vscode from 'vscode';
import type { AvatarProvider } from './history/requestHandler';

type Mode = 'github' | 'gravatar';
interface Entry {
  data?: string;
  at: number;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 5000;
const CONCURRENCY = 4;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const NOREPLY = /^(?:\d+\+)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)@users\.noreply\.github\.com$/;

/** Fetches avatars on the extension side (never from the webview) and returns them as data: URIs. */
export class AvatarService implements AvatarProvider {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    private readonly mode: Mode,
    private readonly storage: vscode.Memento,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async get(emails: string[]): Promise<Record<string, string>> {
    const keys = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
    const out: Record<string, string> = {};
    await Promise.all(
      keys.map(async (email) => {
        const data = await this.resolve(email);
        if (data) out[email] = data;
      }),
    );
    return out;
  }

  private async resolve(email: string): Promise<string | undefined> {
    const key = `gitHistoryPlus.avatar.${this.mode}.${email}`;
    const cached = this.storage.get<Entry>(key);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
    const url = this.urlFor(email);
    const data = url ? await this.limited(() => this.download(url)) : undefined;
    await this.storage.update(key, { data, at: Date.now() } satisfies Entry);
    return data;
  }

  private urlFor(email: string): string | undefined {
    if (this.mode === 'gravatar') {
      return `https://www.gravatar.com/avatar/${createHash('md5').update(email).digest('hex')}?s=32&d=404`;
    }
    const login = NOREPLY.exec(email)?.[1];
    return login ? `https://github.com/${login}.png?size=32` : undefined;
  }

  private async download(url: string): Promise<string | undefined> {
    try {
      const res = await this.fetchFn(url, {
        redirect: 'follow',
        credentials: 'omit',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return undefined;
      const type = ((res.headers.get('content-type') ?? '').split(';')[0] ?? '').trim().toLowerCase();
      if (!IMAGE_TYPES.has(type)) return undefined;
      const len = Number(res.headers.get('content-length'));
      if (len > MAX_BYTES) return undefined;
      const buf = await readCapped(res);
      if (!buf) return undefined;
      return `data:${type};base64,${buf.toString('base64')}`;
    } catch {
      return undefined;
    }
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= CONCURRENCY) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

/** Reads the body incrementally; cancels and returns undefined as soon as it exceeds MAX_BYTES. */
async function readCapped(res: Response): Promise<Buffer | undefined> {
  if (!res.body) return undefined;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
