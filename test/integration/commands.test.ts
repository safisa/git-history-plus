import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import * as vscode from 'vscode';

interface FirstLog {
  mode: 'repo' | 'file' | 'folder' | 'line';
  path?: string;
  ok: boolean;
  error?: string;
  subjects: string[];
}
interface TestApi {
  refs(root: string): Promise<{ name: string }[]>;
  panelCount(): number;
  firstLogs(): FirstLog[];
}

const repoDir = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
const norepo = process.env.GHP_NOREPO!;
const file = vscode.Uri.file(join(repoDir, 'alpha.txt'));

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension('safisa.githistory-plus')!;
  return (await ext.activate()) as TestApi;
}

function webviewLabels(): string[] {
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputWebview)
    .map((t) => t.label);
}

async function waitFor(pred: () => boolean, ms = 10000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

suite('Git History Plus commands', () => {
  teardown(closeAll);

  test('activates from commands alone and registers all commands', async () => {
    // Executing a contributed command must activate the extension even before startup has finished.
    await vscode.commands.executeCommand('gitHistoryPlus.refresh');
    assert.ok(vscode.extensions.getExtension('safisa.githistory-plus')!.isActive);
    const all = await vscode.commands.getCommands(true);
    for (const c of [
      'gitHistoryPlus.viewHistory',
      'gitHistoryPlus.viewFileHistory',
      'gitHistoryPlus.viewLineHistory',
      'gitHistoryPlus.viewFolderHistory',
      'gitHistoryPlus.compareFileWithRef',
      'gitHistoryPlus.refresh',
    ]) {
      assert.ok(all.includes(c), `${c} registered`);
    }
  });

  test('viewFileHistory with a bare Uri opens a tab labelled with the file name', async () => {
    await vscode.commands.executeCommand('gitHistoryPlus.viewFileHistory', file);
    await waitFor(() => webviewLabels().some((l) => l.includes('alpha.txt')));
  });

  test('viewFileHistory with {resourceUri}', async () => {
    await vscode.commands.executeCommand('gitHistoryPlus.viewFileHistory', {
      resourceUri: vscode.Uri.file(join(repoDir, 'file1.txt')),
    });
    await waitFor(() => webviewLabels().some((l) => l.includes('file1.txt')));
  });

  test('viewFileHistory with no argument uses the active editor', async () => {
    await vscode.window.showTextDocument(vscode.Uri.file(join(repoDir, 'file2.txt')));
    await vscode.commands.executeCommand('gitHistoryPlus.viewFileHistory');
    await waitFor(() => webviewLabels().some((l) => l.includes('file2.txt')));
  });

  test('viewLineHistory opens a tab for the selection and a different range opens another', async () => {
    const ed = await vscode.window.showTextDocument(file);
    ed.selection = new vscode.Selection(0, 0, 0, 3);
    await vscode.commands.executeCommand('gitHistoryPlus.viewLineHistory');
    const a = await api();
    await waitFor(() => a.panelCount() === 1);
    ed.selection = new vscode.Selection(1, 0, 2, 2);
    await vscode.commands.executeCommand('gitHistoryPlus.viewLineHistory');
    await waitFor(() => a.panelCount() === 2);
  });

  // The fixture lives under the OS temp dir, a symlinked path on macOS (/var -> /private/var), so the
  // file case also proves the repo-relative path is derived from the realpath (#786).
  test('a repo-history panel answers its first log with commits (data reaches the webview)', async () => {
    const a = await api();
    const before = a.firstLogs().length;
    await vscode.commands.executeCommand('gitHistoryPlus.viewHistory');
    await waitFor(
      () =>
        a
          .firstLogs()
          .slice(before)
          .some((l) => l.mode === 'repo'),
      30000,
    );
    const log = a
      .firstLogs()
      .slice(before)
      .find((l) => l.mode === 'repo')!;
    assert.ok(log.ok, `first log failed: ${log.error}`);
    assert.deepStrictEqual(log.subjects.slice(0, 3), ['commit three', 'commit two', 'commit one']);
  });

  test("a file-history panel answers its first log with the file's commits", async () => {
    const a = await api();
    const before = a.firstLogs().length;
    await vscode.commands.executeCommand(
      'gitHistoryPlus.viewFileHistory',
      vscode.Uri.file(join(repoDir, 'file1.txt')),
    );
    await waitFor(
      () =>
        a
          .firstLogs()
          .slice(before)
          .some((l) => l.mode === 'file'),
      30000,
    );
    const log = a
      .firstLogs()
      .slice(before)
      .find((l) => l.mode === 'file')!;
    assert.strictEqual(log.path, 'file1.txt');
    assert.ok(log.ok, `first log failed: ${log.error}`);
    assert.deepStrictEqual(log.subjects, ['commit two']);
  });

  test('viewFileHistory on a folder (the Explorer passes folders too) opens its folder history', async () => {
    const a = await api();
    const before = a.firstLogs().length;
    await vscode.commands.executeCommand(
      'gitHistoryPlus.viewFileHistory',
      vscode.Uri.file(join(repoDir, 'docs')),
    );
    await waitFor(
      () =>
        a
          .firstLogs()
          .slice(before)
          .some((l) => l.mode === 'folder'),
      30000,
    );
    const log = a
      .firstLogs()
      .slice(before)
      .find((l) => l.mode === 'folder')!;
    assert.strictEqual(log.path, 'docs');
    assert.ok(log.ok, `first log failed: ${log.error}`);
    assert.deepStrictEqual(log.subjects, ['commit two']);
    assert.ok(webviewLabels().some((l) => l.includes('docs')));
  });

  test('viewHistory in a folder with no repo shows the warning', async () => {
    const orig = vscode.window.showWarningMessage;
    const seen: string[] = [];
    (vscode.window as { showWarningMessage: unknown }).showWarningMessage = async (m: string) => {
      seen.push(m);
      return undefined;
    };
    try {
      await vscode.commands.executeCommand('gitHistoryPlus.viewHistory', vscode.Uri.file(norepo));
    } finally {
      (vscode.window as { showWarningMessage: unknown }).showWarningMessage = orig;
    }
    assert.strictEqual(seen.length, 1);
    assert.ok(seen[0]!.startsWith('Git History Plus: no git repository found for'), seen[0]);
  });

  test('refresh makes refs include a branch created outside the extension', async () => {
    const a = await api();
    await vscode.commands.executeCommand('gitHistoryPlus.viewHistory');
    await waitFor(() => a.panelCount() >= 1);
    const first = await a.refs(repoDir);
    assert.ok(!first.some((r) => r.name === 'x'));
    execFileSync('git', ['checkout', '-b', 'x'], { cwd: repoDir });
    await vscode.commands.executeCommand('gitHistoryPlus.refresh');
    const after = await a.refs(repoDir);
    assert.ok(
      after.some((r) => r.name === 'x'),
      JSON.stringify(after.map((r) => r.name)),
    );
  });
});
