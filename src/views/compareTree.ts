import * as vscode from 'vscode';
import type { GitService } from '../git/gitService';
import type { ChangeStatus, FileChange, Hash } from '../shared/types';
import { short } from '../diff';

export type Mode = 'files' | 'folders';

type FolderNode = { kind: 'folder'; name: string; path: string; children: Node[] };
export type Node = { kind: 'file'; file: FileChange; name: string; dir: string } | FolderNode;

const STATUS_NAMES: Record<ChangeStatus, string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
  U: 'Unmerged',
};

function split(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return { dir: i < 0 ? '' : path.slice(0, i), name: path.slice(i + 1) };
}

function sortDeep(nodes: Node[]): Node[] {
  nodes.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : a.name.localeCompare(b.name)));
  for (const n of nodes) if (n.kind === 'folder') sortDeep(n.children);
  return nodes;
}

/** Builds the root nodes: a flat sorted list ('files') or a directory hierarchy ('folders'). */
export function buildNodes(files: FileChange[], mode: Mode): Node[] {
  const leaves = files.map((file): Node => ({ kind: 'file', file, ...split(file.path) }));
  if (mode === 'files') return leaves.sort((a, b) => a.name.localeCompare(b.name));
  const roots: Node[] = [];
  const folders = new Map<string, FolderNode>();
  for (const leaf of leaves) {
    if (leaf.kind !== 'file') continue;
    let siblings = roots;
    let acc = '';
    for (const part of leaf.dir ? leaf.dir.split('/') : []) {
      acc = acc ? `${acc}/${part}` : part;
      let folder = folders.get(acc);
      if (!folder) {
        folder = { kind: 'folder', name: part, path: acc, children: [] };
        folders.set(acc, folder);
        siblings.push(folder);
      }
      siblings = folder.children;
    }
    siblings.push(leaf);
  }
  return sortDeep(roots);
}

/** Shared behaviour of the two Explorer views: a list of changed files, flat or nested by folder. */
export abstract class ChangesTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Node | undefined> = this.emitter.event;
  protected root = '';
  protected files: FileChange[] = [];
  private mode: Mode = 'files';
  /** Shown beside the view title. */
  description = '';

  protected set(root: string, files: FileChange[], description: string): void {
    this.root = root;
    this.files = files;
    this.description = description;
    this.emitter.fire(undefined);
  }

  setMode(m: Mode): void {
    this.mode = m;
    this.emitter.fire(undefined);
  }

  clear(): void {
    this.files = [];
    this.description = '';
    this.emitter.fire(undefined);
  }

  /** The command run when a file leaf is clicked. */
  protected abstract leafCommand(file: FileChange): vscode.Command;

  getChildren(node?: Node): Node[] {
    if (!node) return buildNodes(this.files, this.mode);
    return node.kind === 'folder' ? node.children : [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'folder') {
      const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'folder';
      item.tooltip = node.path;
      return item;
    }
    const { file } = node;
    const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
    item.description = this.mode === 'files' && node.dir ? `${node.dir} • ${file.status}` : file.status;
    item.tooltip = `${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}\n${STATUS_NAMES[file.status]}`;
    item.resourceUri = vscode.Uri.file(`${this.root.replace(/\/+$/, '')}/${file.path}`);
    item.contextValue = 'file';
    item.command = this.leafCommand(file);
    return item;
  }
}

export class CompareCommitsTreeProvider extends ChangesTreeProvider {
  private left: Hash = '';
  private right: Hash = '';

  async show(svc: GitService, left: Hash, right: Hash): Promise<void> {
    const files = await svc.diffFiles(left, right);
    this.left = left;
    this.right = right;
    this.set(svc.root, files, `${short(left)} ↔ ${short(right)}`);
  }

  protected leafCommand(file: FileChange): vscode.Command {
    return {
      command: 'gitHistoryPlus.compareView.openFile',
      title: 'Compare',
      arguments: [this.root, this.left, this.right, file],
    };
  }
}
