import type { Commit } from '../shared/types';

export type RawCommit = Omit<Commit, 'refs'>;

export function parseLog(raw: string): RawCommit[] {
  const commits: RawCommit[] = [];
  for (const record of raw.split('\0')) {
    // Records after the first start with the "\n" git may leave; only drop truly empty ones.
    if (record.trim() === '') continue;
    const fields: string[] = [];
    let pos = 0;
    for (let i = 0; i < 8; i++) {
      const idx = record.indexOf('\x1f', pos);
      if (idx < 0) break;
      fields.push(record.slice(pos, idx));
      pos = idx + 1;
    }
    if (fields.length < 8) continue;
    fields.push(record.slice(pos));
    const [hash = '', parents = '', an = '', ae = '', at = '0', cn = '', ce = '', ct = '0', message = ''] =
      fields;
    const lines = message.replace(/\r\n/g, '\n').split('\n');
    const subject = (lines[0] ?? '').trim();
    const body = lines.slice(1).join('\n').replace(/^\n+/, '').replace(/\n+$/, '');
    commits.push({
      hash: hash.trim(),
      parents: parents.split(' ').filter(Boolean),
      author: { name: an, email: ae },
      authorDate: Number(at) * 1000,
      committer: { name: cn, email: ce },
      commitDate: Number(ct) * 1000,
      subject,
      body,
    });
  }
  return commits;
}
