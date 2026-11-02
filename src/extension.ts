import * as vscode from 'vscode';
import { compareState, registerCompareCommands } from './commands/compare';
import { registerFileVersionCommands } from './commands/fileVersions';
import { registerHistoryCommands, watchRepositoryState } from './commands/history';
import { AvatarService } from './avatars';
import { getConfig } from './config';
import { NS } from './constants';
import { registerGitFileSystem } from './content/gitContentProvider';
import { RepoLocator } from './git/repoLocator';
import { HistoryPanel, type FirstLogRecord } from './history/historyPanel';
import { handleRequest } from './history/requestHandler';
import { logger, setLogLevel } from './logger';
import { createStatusBarButton } from './statusBar';

/** Only returned when GHP_TEST is set; lets integration tests observe extension state. */
export interface TestApi {
  refs(root: string): Promise<unknown>;
  panelCount(): number;
  getHtml(): string[];
  firstLogs(): FirstLogRecord[];
}

interface GitExports {
  getAPI(version: 1): {
    repositories: { rootUri: vscode.Uri; state: { onDidChange: vscode.Event<unknown> } }[];
  };
}

export function activate(ctx: vscode.ExtensionContext): TestApi | undefined {
  setLogLevel(getConfig().logLevel);

  const locator = new RepoLocator(() => vscode.workspace.getConfiguration('git').get<string>('path') ?? null);
  const gitExt = vscode.extensions.getExtension<GitExports>('vscode.git');
  const gitRepositories = () => {
    try {
      return gitExt?.exports?.getAPI(1).repositories;
    } catch {
      return undefined;
    }
  };
  const watcher = watchRepositoryState(locator, () => gitRepositories() ?? []);
  // Without vscode.git (or before it activates) any workspace folder may be a repository.
  const statusBar = createStatusBarButton(() => {
    const repos = gitRepositories();
    return repos ? repos.length > 0 : (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  });
  // vscode.git may activate after us; pick up its repositories once it has.
  void Promise.resolve(gitExt?.activate())
    .then(() => locator.ensureApi()) // so repositories it opens later are announced
    .then(() => {
      watcher.sync();
      statusBar.update();
    })
    .catch((e: unknown) => logger.warn('vscode.git unavailable', e));

  const applyAvatars = (): void => {
    const mode = getConfig().avatars;
    HistoryPanel.avatars = mode === 'off' ? undefined : new AvatarService(mode, ctx.globalState);
  };
  applyAvatars();

  ctx.subscriptions.push(
    locator,
    watcher,
    statusBar,
    locator.onDidChangeRepositories(() => statusBar.update()),
    registerGitFileSystem(locator),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(NS)) return;
      setLogLevel(getConfig().logLevel);
      applyAvatars();
      statusBar.update();
      HistoryPanel.pushSettings();
    }),
    ...registerHistoryCommands(ctx, locator),
    ...registerCompareCommands(locator),
    ...registerFileVersionCommands(),
  );

  if (!process.env.GHP_TEST) return undefined;
  return {
    refs: (root) =>
      handleRequest(
        { id: 1, type: 'refs' },
        { svc: locator.service(root), settings: getConfig(), compare: compareState, avatars: undefined },
      ),
    panelCount: () => HistoryPanel.openCount(),
    getHtml: () => HistoryPanel.__getHtml(),
    firstLogs: () => HistoryPanel.__firstLogs(),
  };
}

export function deactivate(): void {}
