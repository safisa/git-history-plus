const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function pattern(d: Date, fmt: string): string {
  const tokens: Record<string, string> = {
    YYYY: pad(d.getFullYear(), 4),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  // single pass, alternation lists longest token first
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => tokens[t]!);
}

function localeFormat(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

export function formatDate(ms: number, mode: string, locale: string, now: number): string {
  if (mode === 'relative') {
    const diff = now - ms;
    if (diff >= 0 && diff < 7 * DAY) {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      if (diff < MIN) return rtf.format(0, 'second');
      if (diff < HOUR) return rtf.format(-Math.floor(diff / MIN), 'minute');
      if (diff < DAY) return rtf.format(-Math.floor(diff / HOUR), 'hour');
      return rtf.format(-Math.floor(diff / DAY), 'day');
    }
    return localeFormat(ms, locale);
  }
  if (mode === 'locale') return localeFormat(ms, locale);
  const d = new Date(ms);
  if (mode === 'iso') return pattern(d, 'YYYY-MM-DD HH:mm');
  return pattern(d, mode);
}
