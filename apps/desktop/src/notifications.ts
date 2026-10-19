export interface DueSession {
  id: string;
  title: string;
  /** ISO timestamp of the planned start. */
  startAt: string;
}

export const DEFAULT_LEAD_MINUTES = 10;
export const DEFAULT_NOTIFICATION_LIMIT = 3;
export const DEFAULT_GRACE_MINUTES = 5;

export interface SelectOptions {
  enabled: boolean;
  already: ReadonlySet<string>;
  limit?: number;
  /** Minimum lead time in minutes (sessions closer than this are considered due now). */
  leadMinutes?: number;
  /** Sessions that started longer ago than this are stale and never notified. */
  graceMinutes?: number;
  now?: Date;
}

/**
 * Picks the sessions that deserve a native notification:
 * opt-in only, never twice for the same id, closest start first.
 * Input is treated as untrusted (it crosses the renderer IPC boundary).
 */
export function selectNotifiableSessions(due: readonly DueSession[], opts: SelectOptions): DueSession[] {
  if (!opts.enabled) return [];
  const limit = opts.limit ?? DEFAULT_NOTIFICATION_LIMIT;
  const lead = opts.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  const grace = opts.graceMinutes ?? DEFAULT_GRACE_MINUTES;
  const now = (opts.now ?? new Date()).getTime();
  const horizon = now + lead * 60_000;
  const staleBefore = now - grace * 60_000;

  const seen = new Set<string>();
  const candidates: { session: DueSession; at: number }[] = [];
  for (const session of due) {
    if (!session || typeof session.id !== 'string' || !session.id) continue;
    if (opts.already.has(session.id) || seen.has(session.id)) continue;
    const at = Date.parse(session.startAt);
    if (Number.isNaN(at)) continue;
    if (at > horizon || at < staleBefore) continue;
    seen.add(session.id);
    candidates.push({ session, at });
  }

  candidates.sort((a, b) => a.at - b.at);
  return candidates.slice(0, limit).map((entry) => entry.session);
}

export function sanitizeDueSessions(raw: unknown, max = 20): DueSession[] {
  if (!Array.isArray(raw)) return [];
  const out: DueSession[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const source = item as Record<string, unknown>;
    const id = source.id;
    const startAt = source.startAt;
    const title = source.title;
    if (typeof id !== 'string' || !id || id.length > 128) continue;
    if (typeof startAt !== 'string' || startAt.length > 40 || Number.isNaN(Date.parse(startAt))) continue;
    const text = typeof title === 'string' && title.trim() ? title.trim().slice(0, 120) : 'مهمة';
    out.push({ id, title: text, startAt });
    if (out.length >= max) break;
  }
  return out;
}

export interface NotificationText {
  title: string;
  body: string;
}

/** Latin numerals in 24h form, matching the web UI's ledger alignment. */
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatTime(date: Date, locale: 'ar' | 'en', timeZone?: string): string {
  const key = `${locale}|${timeZone ?? 'local'}`;
  let formatter = timeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    });
    timeFormatters.set(key, formatter);
  }
  try {
    return formatter.format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

export function notificationText(session: DueSession, locale: 'ar' | 'en' = 'ar', timeZone?: string): NotificationText {
  const time = formatTime(new Date(session.startAt), locale, timeZone);
  if (locale === 'en') {
    return { title: 'Session starting soon', body: `${session.title} — starts at ${time}` };
  }
  return { title: 'جلسة على وشك البدء', body: `${session.title} — تبدأ ${time}` };
}
