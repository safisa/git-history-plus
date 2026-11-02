import type { IssueLink } from '../src/shared/protocol';

/** A run of commit text: plain, or a match of an issue-link rule with the URL it links to. */
export type TextPart = string | { text: string; url: string };

interface Rule {
  re: RegExp;
  url: string;
}

const isWebUrl = (s: string): boolean => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};

/** Compiles the rules; a pattern that doesn't compile is skipped rather than breaking the view. */
export function compileIssueLinks(links: IssueLink[] | undefined): Rule[] {
  const rules: Rule[] = [];
  for (const l of links ?? []) {
    try {
      rules.push({ re: new RegExp(l.pattern, 'g'), url: l.url });
    } catch {
      /* invalid pattern */
    }
  }
  return rules;
}

/** `$0` is the match and `$1`…`$9` its groups, each URI-encoded; anything else stays as written. */
function expand(url: string, m: RegExpExecArray): string {
  return url.replace(/\$(\d)/g, (_, d: string) => encodeURIComponent(m[Number(d)] ?? ''));
}

function splitOne(text: string, rule: Rule): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  rule.re.lastIndex = 0;
  for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
    if (m[0] === '') {
      rule.re.lastIndex++; // never spin on an empty match
      continue;
    }
    const url = expand(rule.url, m);
    if (!isWebUrl(url)) continue;
    if (m.index > at) parts.push(text.slice(at, m.index));
    parts.push({ text: m[0], url });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/** Splits commit text into plain runs and issue links; earlier rules win where matches overlap. */
export function linkify(text: string, rules: Rule[]): TextPart[] {
  let parts: TextPart[] = [text];
  for (const rule of rules) parts = parts.flatMap((p) => (typeof p === 'string' ? splitOne(p, rule) : [p]));
  return parts;
}
