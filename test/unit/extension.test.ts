import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { configurationChanged } from '../mocks/vscode';
import { activate } from '../../src/extension';
import { HistoryPanel } from '../../src/history/historyPanel';

describe('activate', () => {
  const subscriptions: { dispose(): void }[] = [];
  afterEach(() => {
    subscriptions.splice(0).forEach((d) => d.dispose());
    vi.restoreAllMocks();
  });

  it('pushes new view settings to open panels when a gitHistoryPlus setting changes', () => {
    const push = vi.spyOn(HistoryPanel, 'pushSettings').mockImplementation(() => undefined);
    activate({
      subscriptions,
      extensionUri: vscode.Uri.file('/ext'),
      globalState: { get: () => undefined, update: async () => undefined },
    } as unknown as vscode.ExtensionContext);
    configurationChanged.fire({ affectsConfiguration: (s) => s === 'editor' });
    expect(push).not.toHaveBeenCalled();
    configurationChanged.fire({ affectsConfiguration: (s) => s === 'gitHistoryPlus' });
    expect(push).toHaveBeenCalledTimes(1);
  });
});
