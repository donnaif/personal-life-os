/**
 * Arabic-first formatting helpers.
 * Latin numerals (nu-latn) are used on purpose: the ledger gutter and timers
 * must align, which Arabic-Indic digits prevent.
 */

const NUMERIC_LOCALE = 'ar-SA-u-nu-latn';

const timeFmt = new Intl.DateTimeFormat(NUMERIC_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const dateFmt = new Intl.DateTimeFormat(NUMERIC_LOCALE, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const shortDateFmt = new Intl.DateTimeFormat(NUMERIC_LOCALE, {
  day: 'numeric',
  month: 'short',
});

export function formatTime(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : timeFmt.format(d);
}

export function formatTimeRange(startIso: string, endIso: string): string {
  return `${formatTime(startIso)}–${formatTime(endIso)}`;
}

export function formatLongDate(date: Date): string {
  return dateFmt.format(date);
}

export function formatShortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : shortDateFmt.format(d);
}

/** Local calendar date (YYYY-MM-DD) for a Date, in the browser's zone. */
export function toLocalDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Start/end ISO instants of the local day containing `d`. */
export function dayBounds(d: Date): { fromIso: string; toIso: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { fromIso: start.toISOString(), toIso: end.toISOString() };
}

export function formatMinutes(min: number | undefined | null): string {
  if (min === undefined || min === null || !Number.isFinite(min)) return '—';
  const total = Math.round(min);
  if (total < 60) return `${total} د`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} س` : `${h} س ${m} د`;
}

/** mm:ss or h:mm:ss for a live timer. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** ISO date (yyyy-mm-dd) → `datetime-local` input value in local time. */
export function isoToLocalInput(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `datetime-local` value (local) → ISO instant. */
export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
