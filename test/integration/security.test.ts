import * as assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { toGitUri } from '../../src/content/gitContentProvider';
import { openHistoryDiff } from '../../src/diff';
import { GitService } from '../../src/git/gitService';
import { validateRequest } from '../../src/shared/validate';

interface TestApi {
  refs(root: string): Promise<{ name: string }[]>;
  panelCount(): number;
  getHtml(): string[];
}

const repoDir = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
const EVIL = '<svg/onload=alert(1)>';
const CSP_RE =
  /default-src 'none'; script-src 'nonce-([A-Za-z0-9_-]+)'; style-src (.+?) 'nonce-\1'; img-src \2 data:; font-src \2;/;

async function api(): Promise<TestApi> {
  const ext = vscode.extensions.getExtension('safisa.githistory-plus')!;
  return (await ext.activate()) as TestApi;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE']) delete env[k];
  // makeFixture.mjs writes an empty gitconfig next to the fixture repo.
  return {
    ...env,
    GIT_CONFIG_GLOBAL: join(process.env.GHP_FIXTURE!, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
  };
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: repoDir, stdio: 'pipe', env: gitEnv() });

suite('Git History Plus security', () => {
  suiteSetup(() => {
    try {
      git('branch', '-D', EVIL); // leftover from an aborted run
    } catch {
      /* not present */
    }
    git('branch', EVIL);
  });
  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    git('branch', '-D', EVIL);
  });

  test('a branch named like an svg payload is data, and the panel CSP is intact', async () => {
    const a = await api();
    const refs = await a.refs(repoDir);
    assert.ok(
      refs.some((r) => r.name === EVIL),
      'payload branch is returned as plain data',
    );
    await vscode.commands.executeCommand('gitHistoryPlus.viewHistory');
    const end = Date.now() + 10000;
    while (a.getHtml().length === 0 && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
    const [html] = a.getHtml();
    assert.ok(html, 'panel html available');
    const meta = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)![1]!;
    assert.match(meta, CSP_RE);
    assert.ok(meta.endsWith(';') && !/unsafe-|localhost/.test(meta), `no unsafe directive in: ${meta}`);
    assert.ok(!html.includes(EVIL), 'repository data is never baked into the shell html');
    assert.ok(!/<script(?![^>]*nonce=)/.test(html), 'every script tag carries the nonce');
    assert.ok(!/\son\w+=/.test(html), 'no inline event handlers');
  });

  test('validateRequest drops a forged action with an option-like ref', () => {
    assert.strictEqual(
      validateRequest({ id: 1, type: 'action', action: 'checkout', hash: 'abc1234', ref: '--upload-pack=x' }),
      undefined,
    );
    assert.strictEqual(validateRequest({ id: 2, type: 'action', ref: '--upload-pack=x' }), undefined);
    assert.ok(validateRequest({ id: 3, type: 'action', action: 'checkout', hash: 'abc1234', ref: 'main' }));
  });

  test('past versions open with their content, and their file system is read-only', async () => {
    await vscode.commands.executeCommand('gitHistoryPlus.viewHistory'); // makes the repo known
    const first = git('rev-list', '--max-parents=0', 'HEAD').toString().trim();
    const uri = toGitUri(realpathSync(repoDir), 'alpha.txt', first);
    const doc = await vscode.workspace.openTextDocument(uri);
    assert.strictEqual(doc.getText(), 'one\nline2\nline3\n');
    assert.strictEqual(vscode.workspace.fs.isWritableFileSystem('git-history-plus'), false);
    await assert.rejects(Promise.resolve(vscode.workspace.fs.writeFile(uri, Buffer.from('edited'))));
  });

  test('stepping through file versions keeps a single version tab', async () => {
    // With preview editors off every diff would get its own tab, so this proves our replacement.
    const editorConfig = vscode.workspace.getConfiguration('workbench.editor');
    await editorConfig.update('enablePreview', false, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('gitHistoryPlus.viewHistory'); // makes the repo known
    const svc = new GitService(realpathSync(repoDir), 'git');
    const history = await svc.fileHistory('alpha.txt');
    assert.ok(history.length >= 3);
    for (const i of [0, 1, 2]) await openHistoryDiff(svc, 'alpha.txt', history, i);
    const versionTabs = vscode.window.tabGroups.all
      .flatMap((g) => g.tabs)
      .filter(
        (t) => t.input instanceof vscode.TabInputTextDiff && t.input.modified.scheme === 'git-history-plus',
      );
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await editorConfig.update('enablePreview', undefined, vscode.ConfigurationTarget.Global);
    assert.strictEqual(versionTabs.length, 1);
  });
});
