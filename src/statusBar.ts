import * as vscode from 'vscode';
import { getConfig } from './config';

/**
 * A status bar button that opens the repository history. It shows while
 * `gitHistoryPlus.showStatusBarItem` is on and there is a repository to show; `update` re-checks both.
 */
export function createStatusBarButton(hasRepository: () => boolean): vscode.Disposable & { update(): void } {
  const item = vscode.window.createStatusBarItem('gitHistoryPlus.status', vscode.StatusBarAlignment.Left, 0);
  item.name = 'Git History Plus';
  item.text = '$(history)';
  item.tooltip = 'Git History Plus: View History';
  item.command = 'gitHistoryPlus.viewHistory';
  const update = (): void => {
    if (getConfig().showStatusBarItem && hasRepository()) item.show();
    else item.hide();
  };
  update();
  return { update, dispose: () => item.dispose() };
}
