import { useMemo, useState } from 'react';
import { scheduleApi, tasksApi } from '../api/endpoints';
import type { SchedulePlanResult, Task } from '../api/types';
import { Button, Card, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/errors';
import { formatMinutes, formatTimeRange } from '../lib/format';

const REASON_LABEL: Record<string, string> = {
  no_capacity: 'لا توجد سعة متاحة',
  window_too_small: 'النافذة الزمنية أصغر من الجلسة',
  horizon_exceeded: 'تجاوز أفق التخطيط (14 يومًا)',
  dependency_blocked: 'محجوبة باعتمادية دائرية',
};

export function Plan() {
  const { notify } = useToast();
  const [result, setResult] = useState<SchedulePlanResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [persisting, setPersisting] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const tasksRes = useResource(() => tasksApi.list(), []);

  const titleById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of tasksRes.data ?? []) map.set(t.id, t);
    return map;
  }, [tasksRes.data]);

  const run = async (persist: boolean) => {
    persist ? setPersisting(true) : setPreviewing(true);
    setPlanError(null);
    try {
      const res = await scheduleApi.plan(persist);
      setResult(res);
      notify(persist ? 'ثُبِّتت الخطة وحُفظت الجلسات.' : 'هذه معاينة فقط — لم يُحفظ شيء بعد.', persist ? 'ok' : 'info');
    } catch (err) {
      const message = errorMessage(err);
      setPlanError(message);
      notify(message, 'danger');
    } finally {
      persist ? setPersisting(false) : setPreviewing(false);
    }
  };

  const totalSessions = result?.results.reduce((acc, r) => acc + r.sessions.length, 0) ?? 0;

  return (
    <>
      <header className="toolbar">
        <div>
          <h1 className="app__title">الخطة</h1>
          <p className="app__subtitle">
            وزّع مهامك المفتوحة على وقتك المتاح. المعاينة لا تُحفظ، والتثبيت يحفظ الجلسات فعليًا.
          </p>
        </div>
        <div className="toolbar">
          <Button onClick={() => run(false)} loading={previewing} disabled={persisting}>
            معاينة
          </Button>
          <Button variant="primary" onClick={() => run(true)} loading={persisting} disabled={previewing}>
            ثبّت الخطة
          </Button>
        </div>
      </header>

      {tasksRes.error ? <ErrorState message={tasksRes.error.message} onRetry={tasksRes.reload} /> : null}
      {planError ? (
        <p className="banner banner--danger" role="alert">
          {planError}
        </p>
      ) : null}

      {tasksRes.loading && !tasksRes.data ? <Skeleton height="6rem" /> : null}

      {result && result.conflicts.length > 0 ? (
        <Card title="تعارضات">
          <div className="conflicts">
            {result.conflicts.map((c, i) => (
              <p key={`${c.taskId}-${i}`} className="banner banner--warn">
                «{titleById.get(c.taskId)?.title ?? c.taskId}» — {REASON_LABEL[c.reason] ?? c.reason}
                {c.unplacedSessions > 0 ? ` (${c.unplacedSessions} جلسة غير موضوعة)` : ''}
              </p>
            ))}
          </div>
        </Card>
      ) : null}

      {result ? (
        totalSessions === 0 ? (
          <EmptyState
            title="لم تُوضع أي جلسة"
            body="تحقق من الإعدادات (التوفر وساعات الهدوء) ومن أن المهام تحتوي زمنًا مقدّرًا أو عدد جلسات."
          />
        ) : (
          <Card title={`جلسات مقترحة (${totalSessions})`}>
            <div className="list">
              {result.results
                .filter((r) => r.sessions.length > 0)
                .map((r) => (
                  <div key={r.taskId} className="listrow__main" style={{ paddingBlock: 'var(--space-2xs)' }}>
                    <span className="listrow__title">
                      {titleById.get(r.taskId)?.title ?? 'مهمة'}{' '}
                      <span className="muted num">({r.sessions.length})</span>
                    </span>
                    <div className="sessions">
                      {r.sessions.map((s) => (
                        <span key={`${s.taskId}-${s.index}`} className="sessionchip">
                          <span className="num">
                            {s.index + 1}. {formatTimeRange(s.startAt, s.endAt)}
                          </span>
                          <span className="num">{formatMinutes(s.durationMin)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          </Card>
        )
      ) : null}
    </>
  );
}
