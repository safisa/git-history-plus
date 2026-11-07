import * as vscode from 'vscode';

/** None = off, Info = info/warn/error, Debug = everything. */
export type LogLevel = 'None' | 'Info' | 'Debug';
type Severity = 'error' | 'warn' | 'info' | 'debug';
const THRESHOLD: Record<LogLevel, number> = { None: 0, Info: 3, Debug: 4 };
const SEVERITY: Record<Severity, number> = { error: 1, warn: 2, info: 3, debug: 4 };

let level: LogLevel = 'Info';
let channel: { appendLine(line: string): void } | undefined;

export function setLogLevel(l: LogLevel): void {
  level = l;
}

function write(at: Severity, message: string, err?: unknown): void {
  if (SEVERITY[at] > THRESHOLD[level]) return;
  channel ??= vscode.window.createOutputChannel('GitHistory Plus');
  const detail =
    err === undefined ? '' : ` ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`;
  channel.appendLine(`[${new Date().toISOString()}] [${at}] ${message}${detail}`);
}

export const logger = {
  error: (message: string, err?: unknown) => write('error', message, err),
  warn: (message: string, err?: unknown) => write('warn', message, err),
  info: (message: string, err?: unknown) => write('info', message, err),
  debug: (message: string, err?: unknown) => write('debug', message, err),
};
