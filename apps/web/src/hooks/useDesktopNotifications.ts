import { useEffect } from 'react';
import { sessionsApi, tasksApi } from '../api/endpoints';
import { getDesktopBridge } from '../desktop-bridge';
import { DEFAULT_LEAD_MINUTES, selectDueSessions } from '../lib/dueSessions';
import { dayBounds } from '../lib/format';

const POLL_INTERVAL_MS = 60_000;

/**
 * Feeds the desktop shell with sessions that are about to start.
 * Opt-in: nothing is sent (and nothing is shown) unless the user enabled
 * notifications in the shell settings. The main process deduplicates and
 * re-checks the time window, so a repeated report cannot spam toasts.
 * No-op in a plain browser.
 */
export function useDesktopNotifications(): void {
  const bridge = getDesktopBridge();

  useEffect(() => {
    if (!bridge) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const settings = await bridge.getSettings();
        if (cancelled || !settings?.notificationsEnabled) return;

        const { fromIso, toIso } = dayBounds(new Date());
        const [tasks, sessions] = await Promise.all([tasksApi.list(), sessionsApi.list(fromIso, toIso)]);
        if (cancelled) return;

        const titles = new Map(tasks.map((task) => [task.id, task.title]));
        const due = selectDueSessions(sessions, { now: new Date(), titles, leadMinutes: DEFAULT_LEAD_MINUTES });
        if (due.length > 0 && !cancelled) await bridge.reportDueSessions(due);
      } catch {
        /* API unreachable or offline: try again on the next tick */
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [bridge]);
}
