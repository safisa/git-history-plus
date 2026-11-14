/**
 * Commit bodies are usually hard-wrapped at ~72 columns. Shown as written in a narrower panel, every
 * such line wraps once more and leaves a short stub behind. This joins the hard-wrapped lines of a
 * paragraph back into one, and keeps every break that looks meant:
 * - blank lines (paragraphs), and anything inside a ``` fence;
 * - indented lines, list items, quotes and tables;
 * - trailers (`Signed-off-by: …`, `Co-authored-by: …`);
 * - a break after a short line, which was ended on purpose rather than at the wrap column.
 */
export function reflow(body: string): string {
  const out: string[] = [];
  let fenced = false;
  let open = false; // the last line ran to the wrap column, so the next one may continue it
  for (const line of body.split('\n')) {
    const fence = /^\s*```/.test(line);
    const joins: boolean = open && !fence && line.trim() !== '' && !KEEP.test(line) && !TRAILER.test(line);
    if (joins) out[out.length - 1] = `${out.at(-1)!.trimEnd()} ${line.trim()}`;
    else out.push(line);
    if (fence) fenced = !fenced;
    open =
      !fenced &&
      !fence &&
      line.trimEnd().length >= WRAPPED_MIN &&
      !TRAILER.test(line) &&
      (joins || !/^\s/.test(line));
  }
  return out.join('\n');
}

/** A line at least this long probably ended at the wrap column rather than on purpose. */
const WRAPPED_MIN = 50;
/** Lines that start their own row: indented, lists, quotes, tables, fences, headings. */
const KEEP = /^(\s|[-*+•>|#]\s?|\d+[.)]\s|```)/;
/** `Signed-off-by: Name <mail>` and the like. */
const TRAILER = /^[A-Za-z][\w-]*-by:\s|^(Change-Id|Fixes|Closes|Refs?|See-also):\s/i;
