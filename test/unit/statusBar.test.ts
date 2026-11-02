import { afterEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { configValues, configurationChanged, statusBarItems, workspace } from '../mocks/vscode';
import { activate } from '../../src/extension';
import { createStatusBarButton } from '../../src/statusBar';

afterEach(() => {
  for (const k of Object.keys(configValues)) delete configValues[k];
  statusBarItems.length = 0;
});

describe('status bar button', () => {
  it('opens the repository history, and shows only with a repository and the setting on', () => {
    let repo = false;
    const button = createStatusBarButton(() => repo);
    const item = statusBarItems.at(-1)!;
    expect(item).toMatchObject({ command: 'gitHistoryPlus.viewHistory', text: '$(history)', visible: false });
    expect(item.alignment).toBe(vscode.StatusBarAlignment.Left);
    repo = true;
    button.update();
    expect(item.visible).toBe(true);
    configValues.showStatusBarItem = false;
    button.update();
    expect(item.visible).toBe(false);
    button.dispose();
    expect(item.disposed).toBe(true);
  });

  it('activate shows it for a workspace folder and hides it when the setting is turned off', () => {
    const subscriptions: { dispose(): void }[] = [];
    workspace.workspaceFolders = [{ uri: vscode.Uri.file('/work/repo'), name: 'repo', index: 0 }];
    try {
      activate({
        subscriptions,
        extensionUri: vscode.Uri.file('/ext'),
        globalState: { get: () => undefined, update: async () => undefined },
      } as unknown as vscode.ExtensionContext);
      const item = statusBarItems.at(-1)!;
      expect(item.visible).toBe(true);
      configValues.showStatusBarItem = false;
      configurationChanged.fire({ affectsConfiguration: (s) => s === 'gitHistoryPlus' });
      expect(item.visible).toBe(false);
    } finally {
      workspace.workspaceFolders = undefined;
      subscriptions.splice(0).forEach((d) => d.dispose());
    }
  });
});
