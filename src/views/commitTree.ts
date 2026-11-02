import type * as vscode from 'vscode';
import type { GitService } from '../git/gitService';
import type { FileChange, Hash } from '../shared/types';
import { short } from '../diff';
import { ChangesTreeProvider } from './compareTree';

export class CommitTreeProvider extends ChangesTreeProvider {
  private hash: Hash = '';
  private parent: Hash | undefined;

  async show(svc: GitService, hash: Hash): Promise<void> {
    const { commit, files } = await svc.details(hash);
    this.hash = commit.hash;
    this.parent = commit.parents[0];
    this.set(svc.root, files, short(commit.hash));
  }

  protected leafCommand(file: FileChange): vscode.Command {
    return {
      command: 'gitHistoryPlus.commitView.openFile',
      title: 'Open diff',
      arguments: [this.root, this.hash, this.parent, file],
    };
  }
}
