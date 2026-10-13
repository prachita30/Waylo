/** Date helpers. Instants travel as UTC ISO strings; display uses the airport's IANA zone. */

export const HOME_TZ = 'Asia/Kolkata';

/** yyyy-mm-dd for "today + n days" in the given zone (for date inputs). */
export function isoDate(daysFromToday = 0, timeZone = HOME_TZ): string {
  const d = new Date(Date.now() + daysFromToday * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function formatTime(iso: string, timeZone = HOME_TZ) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}

export function formatDate(iso: string, timeZone = HOME_TZ, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat('en-IN', { timeZone, ...opts }).format(new Date(iso));
}

export function formatDateTime(iso: string, timeZone = HOME_TZ) {
  return `${formatDate(iso, timeZone)}, ${formatTime(iso, timeZone)}`;
}

export function formatDuration(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

/** "in 12 min", "3 h ago" style relative label. */
export function relativeTime(iso: string, now = Date.now()) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
