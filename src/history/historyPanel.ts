import { randomBytes } from 'node:crypto';
import * as nodePath from 'node:path';
import * as vscode from 'vscode';
import { getConfig } from '../config';
import type { GitService } from '../git/gitService';
import { logger } from '../logger';
import type { HistoryMode, Push, Response, ViewSettings } from '../shared/protocol';
import { validateRequest } from '../shared/validate';
import type { LogQuery } from '../shared/types';
import { renderHtml } from './html';
import { compareState } from '../commands/compare';
import { handleRequest, storedLayout, type AvatarProvider } from './requestHandler';

type Mode = HistoryMode;

/** Test-only (GHP_TEST): what a panel's first `log` request answered, to prove data reaches the view. */
export interface FirstLogRecord {
  mode: Mode;
  path?: string;
  ok: boolean;
  error?: string;
  subjects: string[];
}
const firstLogs: FirstLogRecord[] = [];

const VIEW_TYPE = 'gitHistoryPlus.history';
const panels = new Map<string, HistoryPanel>();

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The last segment of a path by the platform's rules (`\\` and `/` on Windows); trailing separators ignored. */
export function baseName(p: string, pathImpl: Pick<typeof nodePath, 'basename'> = nodePath): string {
  return pathImpl.basename(p) || p;
}

function viewSettings(): ViewSettings {
  const { dateFormat, avatars, issueLinks, dimMergeCommits } = getConfig();
  return { dateFormat, avatars, locale: vscode.env.language, issueLinks, dimMergeCommits };
}

/** The numeric id of a message that failed validation, when it has one to answer. */
function messageId(raw: unknown): number | undefined {
  const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined;
  return typeof id === 'number' && Number.isInteger(id) ? id : undefined;
}

export class HistoryPanel {
  /** The avatar service, shared by every panel (undefined while avatars are off). */
  static avatars: AvatarProvider | undefined;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    readonly svc: GitService,
    private readonly mode: Mode,
    private readonly query: LogQuery,
    private readonly key: string,
    private readonly state: vscode.Memento | undefined,
  ) {}

  private disposed = false;
  private firstLogRecorded = false;

  /**
   * Shows (or reveals) the panel for (repo root, mode, path). `init` is posted only after the
   * webview sends `{type:'ready'}`, so it can never be lost before the React app has mounted.
   */
  static show(ctx: vscode.ExtensionContext, svc: GitService, mode: Mode, query: LogQuery): HistoryPanel {
    const path = query.lines?.path ?? query.path ?? '';
    const range = query.lines ? `${query.lines.start}-${query.lines.end}` : '';
    const key = `${svc.root}\0${mode}\0${path}\0${range}`;
    const existing = panels.get(key);
    if (existing) {
      existing.panel.reveal();
      return existing;
    }
    const dist = vscode.Uri.joinPath(ctx.extensionUri, 'dist');
    const title = `Git History (${baseName(mode === 'repo' ? svc.root : path)})`;
    const wp = vscode.window.createWebviewPanel(VIEW_TYPE, title, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [dist],
    });
    // Theia shows only the icon for a tab docked in a side bar, so without one the panel vanishes.
    wp.iconPath = {
      light: vscode.Uri.joinPath(ctx.extensionUri, 'images', 'history-light.svg'),
      dark: vscode.Uri.joinPath(ctx.extensionUri, 'images', 'history-dark.svg'),
    };
    const hp = new HistoryPanel(wp, svc, mode, query, key, ctx.globalState);
    panels.set(key, hp);
    wp.onDidDispose(() => {
      hp.disposed = true;
      if (panels.get(key) === hp) panels.delete(key);
    });
    const nonce = randomBytes(32).toString('base64url');
    wp.webview.html = renderHtml(wp.webview, ctx.extensionUri, nonce);
    wp.webview.onDidReceiveMessage((m) => void hp.onMessage(m));
    return hp;
  }

  /** Sends the current view settings (date format, avatars, locale) to every open panel. */
  static pushSettings(): void {
    const settings = viewSettings();
    for (const p of panels.values()) void p.post({ type: 'settings', settings });
  }

  static refreshAll(): void {
    for (const p of panels.values()) p.refresh();
  }

  static hasPanelFor(root: string): boolean {
    return [...panels.values()].some((p) => p.svc.root === root);
  }

  /** Invalidates the repo's cache once and tells each of its panels to reload. */
  static refreshForRoot(root: string): void {
    for (const p of panels.values()) if (p.svc.root === root) p.refresh();
  }

  static openCount(): number {
    return panels.size;
  }

  /** Test-only (GHP_TEST): the first `log` response of every panel opened so far. */
  static __firstLogs(): FirstLogRecord[] {
    return process.env.GHP_TEST ? [...firstLogs] : [];
  }

  private recordFirstLog(type: string, ok: boolean, result: unknown, error?: string): void {
    if (!process.env.GHP_TEST || type !== 'log' || this.firstLogRecorded) return;
    this.firstLogRecorded = true;
    const commits = ok ? ((result as { commits?: { subject: string }[] }).commits ?? []) : [];
    firstLogs.push({
      mode: this.mode,
      path: this.query.lines?.path ?? this.query.path,
      ok,
      ...(error === undefined ? {} : { error }),
      subjects: commits.map((c) => c.subject),
    });
  }

  /** Test-only (GHP_TEST): the shell html of every open panel, to assert the CSP. */
  static __getHtml(): string[] {
    return process.env.GHP_TEST ? [...panels.values()].map((p) => p.panel.webview.html) : [];
  }

  refresh(): void {
    this.svc.invalidate();
    void this.post({ type: 'refresh' });
  }

  /** Never throws and never posts to a disposed panel (Theia's webview throws on postMessage after dispose). */
  private async post(msg: Push | Response): Promise<boolean> {
    if (this.disposed) return false;
    try {
      return await this.panel.webview.postMessage(msg);
    } catch (e) {
      logger.debug('postMessage failed', e);
      return false;
    }
  }

  private async onMessage(raw: unknown): Promise<void> {
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'ready') {
      await this.post({
        type: 'init',
        mode: this.mode,
        query: this.query,
        settings: viewSettings(),
        repoName: baseName(this.svc.root),
        layout: storedLayout(this.state),
      });
      return;
    }
    const req = validateRequest(raw);
    if (!req) {
      logger.warn('Dropped invalid webview message');
      // Answer what can be answered, so the view fails fast instead of waiting for its timeout.
      const id = messageId(raw);
      if (id !== undefined) await this.post({ id, ok: false, error: 'Invalid request' });
      return;
    }
    try {
      const result = await handleRequest(req, {
        svc: this.svc,
        settings: getConfig(),
        compare: compareState,
        avatars: HistoryPanel.avatars,
        state: this.state,
        mode: this.mode,
        // Only a file or line history tracks one file's versions; a folder history is a filtered log.
        path:
          this.mode === 'file' || this.mode === 'line'
            ? (this.query.lines?.path ?? this.query.path)
            : undefined,
      });
      this.recordFirstLog(req.type, true, result);
      await this.post({ id: req.id, ok: true, result });
      if (req.type === 'action' && (result as { changed?: boolean } | undefined)?.changed === true)
        this.refresh();
      // Remote branches moved for every view of this repository, not just this one.
      if (req.type === 'fetch') HistoryPanel.refreshForRoot(this.svc.root);
    } catch (e) {
      logger.error(`Request ${req.type} failed`, e);
      this.recordFirstLog(req.type, false, undefined, errorMessage(e));
      await this.post({ id: req.id, ok: false, error: errorMessage(e) });
    }
  }
}
