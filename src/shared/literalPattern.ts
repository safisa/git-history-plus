/**
 * Writes `s` as a regex that matches it literally in every flavour git may use for `--grep` and
 * `--author` (basic, extended or Perl, depending on `grep.patternType`): each metacharacter becomes a
 * one-character bracket expression. `\` becomes `[\\]` (a backslash in all three); `^` becomes `[\^]`,
 * which in POSIX also admits a backslash — an accepted, harmless superset.
 */
export function literalPattern(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, (c) => {
    if (c === ']') return '[]]';
    if (c === '\\') return '[\\\\]';
    if (c === '^') return '[\\^]';
    return `[${c}]`;
  });
}
