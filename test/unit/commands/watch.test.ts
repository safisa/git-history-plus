import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscodeMock from '../../mocks/vscode';
import { watchRepositoryState } from '../../../src/commands/history';
import type { GitService } from '../../../src/git/gitService';
import type { RepoLocator } from '../../../src/git/repoLocator';
import { HistoryPanel } from '../../../src/history/historyPanel';

const ROOT = '/work/repo';

let stateChanged: vscodeMock.EventEmitter<unknown>;
let fingerprint: string;
let fingerprintCalls: number;
let refresh: ReturnType<typeof vi.spyOn>;
let watcher: ReturnType<typeof watchRepositoryState>;

beforeEach(() => {
  vi.useFakeTimers();
  stateChanged = new vscodeMock.EventEmitter<unknown>();
  fingerprint = 'head-a refs-1';
  fingerprintCalls = 0;
  const reposChanged = new vscodeMock.EventEmitter<void>();
  const svc = { root: ROOT } as GitService;
  const locator = {
    service: () => svc,
    onDidChangeRepositories: reposChanged.event,
  } as unknown as RepoLocator;
  vi.spyOn(HistoryPanel, 'hasPanelFor').mockReturnValue(true);
  refresh = vi.spyOn(HistoryPanel, 'refreshForRoot').mockImplementation(() => undefined);
  watcher = watchRepositoryState(
    locator,
    () => [{ rootUri: vscodeMock.Uri.file(ROOT) as never, state: { onDidChange: stateChanged.event } }],
    async () => {
      fingerprintCalls++;
      return fingerprint;
    },
  );
});
afterEach(() => {
  watcher.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A burst of vscode.git status events (save, focus, …), then the debounce elapses. */
async function statusBurst(): Promise<void> {
  stateChanged.fire(undefined);
  stateChanged.fire(undefined);
  await vi.advanceTimersByTimeAsync(600);
}

describe('watchRepositoryState', () => {
  it('does not refresh when a status run leaves HEAD and refs unchanged', async () => {
    await statusBurst();
    await statusBurst();
    expect(refresh).not.toHaveBeenCalled();
    expect(fingerprintCalls).toBe(3); // baseline + one per debounced burst
  });

  it('refreshes once when HEAD (or a ref) moves, then not again until the next change', async () => {
    await statusBurst();
    fingerprint = 'head-b refs-1';
    await statusBurst();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(ROOT);
    await statusBurst();
    expect(refresh).toHaveBeenCalledTimes(1);
    fingerprint = 'head-b refs-2';
    await statusBurst();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('computes nothing while the repo has no history panel, and refreshes once one is open', async () => {
    vi.spyOn(HistoryPanel, 'hasPanelFor').mockReturnValue(false);
    fingerprintCalls = 0;
    await statusBurst();
    await statusBurst();
    expect(fingerprintCalls).toBe(0);
    vi.spyOn(HistoryPanel, 'hasPanelFor').mockReturnValue(true);
    await statusBurst(); // no baseline from before the panel: refresh to be safe
    expect(refresh).toHaveBeenCalledTimes(1);
    await statusBurst();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes when the fingerprint cannot be computed (fails open)', async () => {
    watcher.dispose();
    const reposChanged = new vscodeMock.EventEmitter<void>();
    const locator = {
      service: () => ({ root: ROOT }) as GitService,
      onDidChangeRepositories: reposChanged.event,
    } as unknown as RepoLocator;
    watcher = watchRepositoryState(
      locator,
      () => [{ rootUri: vscodeMock.Uri.file(ROOT) as never, state: { onDidChange: stateChanged.event } }],
      async () => {
        throw new Error('git failed');
      },
    );
    await statusBurst();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
