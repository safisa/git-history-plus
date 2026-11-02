// Minimal stub of the `vscode` module for unit tests; extended by later tasks.
export const version = '0.0.0-test';

export class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query: string,
    readonly fragment: string,
  ) {}
  static file(path: string): Uri {
    return new Uri('file', '', path.replace(/\\/g, '/'), '', '');
  }
  static from(c: {
    scheme: string;
    authority?: string;
    path?: string;
    query?: string;
    fragment?: string;
  }): Uri {
    return new Uri(c.scheme, c.authority ?? '', c.path ?? '', c.query ?? '', c.fragment ?? '');
  }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    return base.with({ path: [base.path.replace(/\/+$/, ''), ...parts].join('/') });
  }
  static parse(value: string): Uri {
    const m = /^([^:]+):(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value);
    if (!m) throw new Error(`bad uri: ${value}`);
    return new Uri(
      m[1]!,
      m[2] ?? '',
      decodeURIComponent(m[3] ?? ''),
      m[4] ? decodeURIComponent(m[4]) : '',
      m[5] ?? '',
    );
  }
  get fsPath(): string {
    return this.path;
  }
  with(c: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(
      c.scheme ?? this.scheme,
      c.authority ?? this.authority,
      c.path ?? this.path,
      c.query ?? this.query,
      c.fragment ?? this.fragment,
    );
  }
  toString(): string {
    const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
    return (
      `${this.scheme}:` +
      (this.authority || this.scheme === 'file' ? `//${this.authority}` : '') +
      enc(this.path) +
      (this.query ? `?${encodeURIComponent(this.query)}` : '') +
      (this.fragment ? `#${this.fragment}` : '')
    );
  }
}

type Listener<T> = (e: T) => unknown;
export class EventEmitter<T> {
  private listeners = new Set<Listener<T>>();
  readonly event = (listener: Listener<T>) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };
  fire(data: T): void {
    for (const l of [...this.listeners]) l(data);
  }
  dispose(): void {
    this.listeners.clear();
  }
}

/** Test hook: values returned by workspace.getConfiguration(...).get(key). */
export const configValues: Record<string, unknown> = {};

/** Test hook: fire a configuration change, e.g. `{ affectsConfiguration: (s) => s === 'gitHistoryPlus' }`. */
export const configurationChanged = new EventEmitter<{ affectsConfiguration(section: string): boolean }>();

export const workspace: {
  workspaceFolders: { uri: Uri; name: string; index: number }[] | undefined;
  registerTextDocumentContentProvider: (scheme: string, provider: unknown) => { dispose(): void };
  registerFileSystemProvider: (scheme: string, provider: unknown, options?: unknown) => { dispose(): void };
  getConfiguration: (section?: string) => { get<T>(key: string, fallback?: T): T | undefined };
  onDidChangeConfiguration: typeof configurationChanged.event;
} = {
  workspaceFolders: undefined,
  onDidChangeConfiguration: configurationChanged.event,
  registerTextDocumentContentProvider: () => ({ dispose: () => undefined }),
  registerFileSystemProvider: () => ({ dispose: () => undefined }),
  getConfiguration: () => ({
    get: <T>(key: string, fallback?: T) => (key in configValues ? (configValues[key] as T) : fallback),
  }),
};

export enum FileType {
  Unknown = 0,
  File = 1,
  Directory = 2,
  SymbolicLink = 64,
}

export enum FilePermission {
  Readonly = 1,
}

export class FileSystemError extends Error {
  constructor(
    message?: string,
    readonly code = 'Unknown',
  ) {
    super(message);
  }
  static FileNotFound(m?: unknown) {
    return new FileSystemError(String(m ?? ''), 'FileNotFound');
  }
  static NoPermissions(m?: unknown) {
    return new FileSystemError(String(m ?? ''), 'NoPermissions');
  }
}

export class MarkdownString {
  constructor(public value = '') {}
}

export const ViewColumn = { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 } as const;

export const env: {
  language: string;
  clipboard: { writeText: (text: string) => Promise<void> };
  openExternal: (uri: Uri) => Promise<boolean>;
} = {
  language: 'en',
  clipboard: { writeText: async () => undefined },
  openExternal: async () => true,
};

export interface MockWebview {
  options: unknown;
  html: string;
  cspSource: string;
  asWebviewUri(uri: Uri): Uri;
  postMessage(message: unknown): Promise<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => unknown): { dispose(): void };
  /** test hook */
  receive(message: unknown): void;
}
export function createMockWebview(): MockWebview {
  const emitter = new EventEmitter<unknown>();
  return {
    options: undefined,
    html: '',
    cspSource: 'https://mock.vscode-cdn.net',
    asWebviewUri: (uri) =>
      Uri.from({ scheme: 'https', authority: 'file+.vscode-resource.mock.net', path: uri.path }),
    postMessage: async () => true,
    onDidReceiveMessage: (l) => emitter.event(l),
    receive: (m) => emitter.fire(m),
  };
}

export const commands: {
  executeCommand: (command: string, ...args: unknown[]) => Promise<unknown>;
  registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => { dispose(): void };
} = {
  executeCommand: async () => undefined,
  registerCommand: () => ({ dispose: () => undefined }),
};

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}
export class TreeItem {
  description?: string | boolean;
  tooltip?: string;
  resourceUri?: Uri;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  constructor(
    public label: string,
    public collapsibleState: TreeItemCollapsibleState = TreeItemCollapsibleState.None,
  ) {}
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export enum StatusBarAlignment {
  Left = 1,
  Right = 2,
}

export interface MockStatusBarItem {
  id: string;
  alignment: StatusBarAlignment;
  priority?: number;
  name?: string;
  text: string;
  tooltip?: string;
  command?: string;
  visible: boolean;
  disposed: boolean;
  show(): void;
  hide(): void;
  dispose(): void;
}
/** Every status bar item created, newest last. */
export const statusBarItems: MockStatusBarItem[] = [];

export const extensionsDidChange = new EventEmitter<void>();
export const extensions: {
  getExtension: (
    id: string,
  ) => { exports?: unknown; isActive?: boolean; activate?: () => Promise<unknown> } | undefined;
  onDidChange: (listener: () => unknown) => { dispose(): void };
} = {
  getExtension: () => undefined,
  onDidChange: extensionsDidChange.event,
};

export const window: {
  activeTextEditor: { document: { uri: Uri } } | undefined;
  showQuickPick: (items: unknown[], options?: unknown) => Promise<unknown>;
  showWarningMessage: (message: string, ...rest: unknown[]) => Promise<unknown>;
  showInformationMessage: (message: string, ...rest: unknown[]) => Promise<unknown>;
  showErrorMessage: (message: string, ...rest: unknown[]) => Promise<unknown>;
  showInputBox: (options?: {
    prompt?: string;
    validateInput?: (value: string) => string | undefined | Promise<string | undefined>;
  }) => Promise<string | undefined>;
  createWebviewPanel: (viewType: string, title: string, column: unknown, options?: unknown) => unknown;
  createOutputChannel: (name: string) => { appendLine(line: string): void; dispose(): void };
  createTreeView: (
    viewId: string,
    options: unknown,
  ) => { description?: string; title?: string; dispose(): void };
  withProgress: <T>(
    options: unknown,
    task: (
      progress: unknown,
      token: { onCancellationRequested: (l: () => void) => { dispose(): void } },
    ) => Thenable<T>,
  ) => Thenable<T>;
  createStatusBarItem: (id: string, alignment: StatusBarAlignment, priority?: number) => MockStatusBarItem;
} = {
  createStatusBarItem: (id, alignment, priority) => {
    const item: MockStatusBarItem = {
      id,
      alignment,
      priority,
      text: '',
      visible: false,
      disposed: false,
      show: () => void (item.visible = true),
      hide: () => void (item.visible = false),
      dispose: () => void (item.disposed = true),
    };
    statusBarItems.push(item);
    return item;
  },
  withProgress: (_options, task) =>
    task({ report: () => undefined }, { onCancellationRequested: () => ({ dispose: () => undefined }) }),
  createTreeView: () => ({ dispose: () => undefined }),
  activeTextEditor: undefined,
  showQuickPick: async () => undefined,
  showWarningMessage: async () => undefined,
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showInputBox: async () => undefined,
  createWebviewPanel: (_viewType, title, _column, options) => {
    const webview = createMockWebview();
    const disposeEmitter = new EventEmitter<void>();
    const panel = {
      title,
      webview,
      options,
      visible: true,
      reveal: () => undefined,
      onDidDispose: disposeEmitter.event,
      dispose: () => disposeEmitter.fire(),
    };
    return panel;
  },
  createOutputChannel: () => ({ appendLine: () => undefined, dispose: () => undefined }),
};
