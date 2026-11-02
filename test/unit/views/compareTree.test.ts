import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { makeRepo, type TestRepo } from '../../helpers/repo';
import { GitService } from '../../../src/git/gitService';
import { CompareCommitsTreeProvider, type Node } from '../../../src/views/compareTree';
import { CommitTreeProvider } from '../../../src/views/commitTree';

let repo: TestRepo;
let svc: GitService;
let c1: string;
let c2: string;

beforeEach(async () => {
  repo = await makeRepo();
  svc = new GitService(repo.dir, 'git');
  await repo.commit('src/a.ts', 'a1', 'one');
  c1 = await repo.commit('gone.txt', 'bye', 'two');
  await repo.git('rm', 'gone.txt');
  await repo.commit('src/a.ts', 'a2', 'three');
  await repo.commit('src/sub/new.ts', 'n', 'four');
  c2 = await repo.commit('top.md', 'x', 'five');
});
afterEach(() => repo.cleanup());

const labels = (nodes: Node[], p: { getTreeItem(n: Node): vscode.TreeItem }) =>
  nodes.map((n) => String(p.getTreeItem(n).label));

describe('CompareCommitsTreeProvider', () => {
  it('files mode is flat with the directory as description and status letters', async () => {
    const p = new CompareCommitsTreeProvider();
    await p.show(svc, c1, c2);
    const roots = (await p.getChildren()) as Node[];
    expect(labels(roots, p).sort()).toEqual(['a.ts', 'gone.txt', 'new.ts', 'top.md']);
    const a = p.getTreeItem(roots.find((n) => p.getTreeItem(n).label === 'a.ts')!);
    expect(a.description).toContain('src');
    expect(a.description).toContain('M');
    expect(a.tooltip).toContain('src/a.ts');
    expect(a.resourceUri?.fsPath).toBe(`${repo.dir}/src/a.ts`);
    expect(a.command?.command).toBe('gitHistoryPlus.compareView.openFile');
    expect(a.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it('folders mode nests src/a.ts under src', async () => {
    const p = new CompareCommitsTreeProvider();
    await p.show(svc, c1, c2);
    p.setMode('folders');
    const roots = (await p.getChildren()) as Node[];
    expect(labels(roots, p)).toEqual(['src', 'gone.txt', 'top.md']);
    const src = roots[0]!;
    expect(p.getTreeItem(src).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    const kids = (await p.getChildren(src)) as Node[];
    expect(labels(kids, p)).toEqual(['sub', 'a.ts']);
    expect(labels((await p.getChildren(kids[0]!)) as Node[], p)).toEqual(['new.ts']);
  });

  it('lists added and deleted files', async () => {
    const p = new CompareCommitsTreeProvider();
    await p.show(svc, c1, c2);
    const roots = (await p.getChildren()) as Node[];
    const desc = (name: string) =>
      p.getTreeItem(roots.find((n) => p.getTreeItem(n).label === name)!).description;
    expect(desc('gone.txt')).toContain('D');
    expect(desc('top.md')).toContain('A');
    expect(desc('new.ts')).toContain('A');
  });

  it('fires onDidChangeTreeData on show and setMode', async () => {
    const p = new CompareCommitsTreeProvider();
    let n = 0;
    p.onDidChangeTreeData(() => n++);
    await p.show(svc, c1, c2);
    p.setMode('folders');
    expect(n).toBe(2);
  });
});

describe('CommitTreeProvider', () => {
  it('shows one commit files against its parent', async () => {
    const p = new CommitTreeProvider();
    await p.show(svc, c2);
    expect(labels((await p.getChildren()) as Node[], p)).toEqual(['top.md']);
    const item = p.getTreeItem(((await p.getChildren()) as Node[])[0]!);
    expect(item.command?.command).toBe('gitHistoryPlus.commitView.openFile');
  });
  it('shows the root commit files', async () => {
    const first = (await repo.git('rev-list', '--max-parents=0', 'HEAD')).trim();
    const p = new CommitTreeProvider();
    await p.show(svc, first);
    expect(labels((await p.getChildren()) as Node[], p)).toEqual(['a.ts']);
  });
});
