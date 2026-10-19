import type { Session } from '../api/types';
import type { DueSessionReport } from '../desktop-bridge';

/** Mirrors the desktop shell's own lead time; the main process re-checks it. */
export const DEFAULT_LEAD_MINUTES = 10;
export const DEFAULT_DUE_LIMIT = 3;

export interface SelectDueOptions {
  now: Date;
  titles?: ReadonlyMap<string, string>;
  leadMinutes?: number;
  limit?: number;
}

const FALLBACK_TITLE = 'مهمة';

/**
 * Sessions that start within the notification window and have not started yet.
 * Pure so it can be unit tested without a DOM or a running shell.
 */
export function selectDueSessions(sessions: readonly Session[], opts: SelectDueOptions): DueSessionReport[] {
  const lead = opts.leadMinutes ?? DEFAULT_LEAD_MINUTES;
  const limit = opts.limit ?? DEFAULT_DUE_LIMIT;
  const now = opts.now.getTime();
  const horizon = now + lead * 60_000;

  const due: { at: number; report: DueSessionReport }[] = [];
  for (const session of sessions) {
    if (session.status !== 'planned') continue;
    const at = Date.parse(session.plannedStartAt);
    if (Number.isNaN(at) || at < now || at > horizon) continue;
    const title = opts.titles?.get(session.taskId)?.trim() || FALLBACK_TITLE;
    due.push({ at, report: { id: session.id, title, startAt: session.plannedStartAt } });
  }

  due.sort((a, b) => a.at - b.at);
  return due.slice(0, limit).map((entry) => entry.report);
}
