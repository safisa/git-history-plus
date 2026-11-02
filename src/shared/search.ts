import type { LogQuery } from './types';

type SearchFields = Pick<LogQuery, 'text' | 'author' | 'path' | 'since' | 'until'>;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuote = false;
  let has = false;
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote;
      has = true;
    } else if (!inQuote && /\s/.test(ch)) {
      if (has) tokens.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) tokens.push(cur);
  return tokens;
}

export function parseSearch(input: string): SearchFields {
  const out: SearchFields = {};
  const text: string[] = [];
  for (const tok of tokenize(input)) {
    const m = /^(author|path|since|until):(.*)$/.exec(tok);
    if (m && m[2]) out[m[1] as 'author' | 'path' | 'since' | 'until'] = m[2];
    else if (tok) text.push(tok);
  }
  if (text.length) out.text = text.join(' ');
  return out;
}
