import * as vscode from 'vscode';
import { CONTEXT_KEYS, NS } from '../constants';
import { historyEntryFor, openHistoryDiff } from '../diff';

/** URI string of the modified (right-hand) side of the active diff, falling back to the active text editor. */
function activeRightUri(): string | undefined {
  const input = vscode.window.tabGroups?.activeTabGroup?.activeTab?.input as
    { modified?: vscode.Uri } | undefined;
  if (input?.modified) return input.modified.toString();
  return vscode.window.activeTextEditor?.document.uri.toString();
}

function currentEntry() {
  const key = activeRightUri();
  return key === undefined ? undefined : historyEntryFor(key);
}

async function step(delta: 1 | -1): Promise<void> {
  const entry = currentEntry();
  if (!entry) return;
  const index = entry.index + delta;
  if (index < 0) {
    await vscode.window.showInformationMessage('Already at the newest version');
    return;
  }
  if (index >= entry.history.length) {
    await vscode.window.showInformationMessage('Already at the oldest version');
    return;
  }
  await openHistoryDiff(entry.svc, entry.path, entry.history, index);
}

export const previousVersion = (): Promise<void> => step(1);
export const nextVersion = (): Promise<void> => step(-1);

function updateContext(): void {
  void vscode.commands.executeCommand(
    'setContext',
    CONTEXT_KEYS.inFileHistoryDiff,
    currentEntry() !== undefined,
  );
}

export function registerFileVersionCommands(): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(`${NS}.previousVersion`, previousVersion),
    vscode.commands.registerCommand(`${NS}.nextVersion`, nextVersion),
    // Optional chaining: these events may be missing in Theia.
    vscode.window.onDidChangeActiveTextEditor?.(updateContext),
    vscode.window.tabGroups?.onDidChangeTabs?.(updateContext),
  ].filter((d): d is vscode.Disposable => d !== undefined);
}
