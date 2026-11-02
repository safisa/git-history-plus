import type { FileChange } from '../src/shared/types';

/** One row of the changed-files list: a file, or (tree view) a folder. */
export type FileEntry =
  | { kind: 'file'; file: FileChange; depth: number }
  | { kind: 'dir'; path: string; name: string; depth: number; open: boolean };

interface Dir {
  dirs: Map<string, Dir>;
  files: FileChange[];
}

const newDir = (): Dir => ({ dirs: new Map(), files: [] });
const byName = (a: string, b: string) => a.localeCompare(b);
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function build(files: FileChange[]): Dir {
  const root = newDir();
  for (const f of files) {
    const parts = f.path.split('/');
    parts.pop();
    let dir = root;
    for (const part of parts) {
      let next = dir.dirs.get(part);
      if (!next) dir.dirs.set(part, (next = newDir()));
      dir = next;
    }
    dir.files.push(f);
  }
  return root;
}

function flatten(dir: Dir, prefix: string, depth: number, collapsed: ReadonlySet<string>): FileEntry[] {
  const out: FileEntry[] = [];
  for (const name of [...dir.dirs.keys()].sort(byName)) {
    // A folder whose only content is one folder is shown merged with it: `src/git`.
    let node = dir.dirs.get(name)!;
    let label = name;
    let path = prefix + name;
    while (node.files.length === 0 && node.dirs.size === 1) {
      const [only, child] = [...node.dirs][0]!;
      label += `/${only}`;
      path += `/${only}`;
      node = child;
    }
    const open = !collapsed.has(path);
    out.push({ kind: 'dir', path, name: label, depth, open });
    if (open) out.push(...flatten(node, `${path}/`, depth + 1, collapsed));
  }
  const files = [...dir.files].sort((a, b) => byName(baseName(a.path), baseName(b.path)));
  for (const file of files) out.push({ kind: 'file', file, depth });
  return out;
}

/** The rows for `files`: as given (list), or as a folder tree with `collapsed` folders closed. */
export function fileEntries(files: FileChange[], tree: boolean, collapsed: ReadonlySet<string>): FileEntry[] {
  if (!tree) return files.map((file) => ({ kind: 'file', file, depth: 0 }));
  return flatten(build(files), '', 0, collapsed);
}
