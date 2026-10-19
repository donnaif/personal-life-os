import { useMemo, useState, type FormEvent } from 'react';
import { reportsApi, sessionsApi, tasksApi } from '../api/endpoints';
import type { Session, Task } from '../api/types';
import { Button, Card, EmptyState, ErrorState, ProgressRule, Skeleton } from '../components/ui';
import { SessionStatusBadge, TaskStatusBadge } from '../components/StatusBadge';
import { SessionActions } from '../components/SessionActions';
import { useResource, useNow } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import { dayBounds, formatDuration, formatLongDate, formatMinutes, formatTime, formatTimeRange } from '../lib/format';
import { errorMessage } from '../lib/errors';
import { elapsedMs, progressOf } from '../lib/session';

const TERMINAL = new Set(['completed', 'cancelled']);

export function Dashboard() {
  const { notify } = useToast();
  const now = useNow(1000);
  const [quickTitle, setQuickTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const { data, loading, error, reload, setData } = useResource(async () => {
    const { fromIso, toIso } = dayBounds(new Date());
    const [tasks, sessions, report] = await Promise.all([
      tasksApi.list(),
      sessionsApi.list(fromIso, toIso),
      reportsApi.summary(),
    ]);
    return { tasks, sessions, report };
  }, []);

  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of data?.tasks ?? []) map.set(t.id, t);
    return map;
  }, [data]);

  const openTasks = (data?.tasks ?? []).filter((t) => !TERMINAL.has(t.status));
  const sessions = useMemo(
    () => [...(data?.sessions ?? [])].sort((a, b) => a.plannedStartAt.localeCompare(b.plannedStartAt)),
    [data],
  );
  const plannedMinutes = sessions.reduce((acc, s) => acc + s.plannedDurationMin, 0);

  const replaceSession = (next: Session) => {
    setData((prev) =>
      prev ? { ...prev, sessions: prev.sessions.map((s) => (s.id === next.id ? next : s)) } : prev,
    );
  };

  const addQuickTask = async (e: FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    setAdding(true);
    try {
      await tasksApi.create({ title });
      setQuickTitle('');
      notify('أُضيفت المهمة.', 'ok');
      reload();
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <header className="toolbar">
        <div>
          <h1 className="app__title">لوحة اليوم</h1>
          <p className="app__subtitle">{formatLongDate(new Date())}</p>
        </div>
        <Button icon={<span aria-hidden>↻</span>} onClick={reload} disabled={loading}>
          تحديث
        </Button>
      </header>

      {error ? (
        error.isNetwork ? (
          <p className="banner banner--danger">
            تعذّر الاتصال بالخادم ({error.message}). تأكد من تشغيل واجهة الـAPI على المنفذ 3100 ثم أعد المحاولة.
          </p>
        ) : (
          <ErrorState message={error.message} onRetry={reload} />
        )
      ) : null}

      {loading && !data ? (
        <div className="stats">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height="5.5rem" />
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat__value num">{openTasks.length}</span>
              <span className="stat__label">مهام مفتوحة</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{sessions.length}</span>
              <span className="stat__label">جلسات اليوم</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{formatMinutes(plannedMinutes)}</span>
              <span className="stat__label">زمن مخطط اليوم</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{Math.round(data.report.tasks.completionRate * 100)}%</span>
              <span className="stat__label">نسبة الإنجاز الكلية</span>
            </div>
          </div>

          <Card
            title="خط اليوم"
            action={
              <form className="toolbar" onSubmit={addQuickTask}>
                <label className="sr-only" htmlFor="quick-title">
                  مهمة سريعة
                </label>
                <input
                  id="quick-title"
                  className="field__input"
                  placeholder="مهمة سريعة…"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                />
                <Button type="submit" variant="primary" size="sm" loading={adding} disabled={!quickTitle.trim()}>
                  إضافة
                </Button>
              </form>
            }
          >
            {sessions.length === 0 ? (
              <EmptyState
                title="لا جلسات مجدولة اليوم"
                body="أضف مهمة ثم استخدم «جدولة» في صفحة المهام لتوزيع جلساتها على وقتك المتاح."
              />
            ) : (
              <div className="ledger">
                {sessions.map((s) => {
                  const task = taskById.get(s.taskId);
                  const live = s.status === 'running' || s.status === 'paused';
                  return (
                    <article key={s.id} className={`ledger__row${live ? ' ledger__row--now' : ''}`}>
                      <div className="ledger__time num">
                        <div>{formatTime(s.plannedStartAt)}</div>
                        <div className="muted">{formatTime(s.plannedEndAt)}</div>
                      </div>
                      <div className="ledger__entry">
                        <div className="ledger__top">
                          <span className="ledger__title">{task?.title ?? 'مهمة محذوفة'}</span>
                          <SessionStatusBadge status={s.status} />
                          {live ? <span className="ledger__timer">{formatDuration(elapsedMs(s, now))}</span> : null}
                        </div>
                        <div className="ledger__meta">
                          <span className="num">{formatTimeRange(s.plannedStartAt, s.plannedEndAt)}</span>
                          <span className="num">{formatMinutes(s.plannedDurationMin)}</span>
                          {task ? <TaskStatusBadge status={task.status} /> : null}
                        </div>
                        {live ? <ProgressRule value={progressOf(s, now)} /> : null}
                        <SessionActions session={s} onChanged={replaceSession} />
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </Card>

          <Card title="مهام مفتوحة">
            {openTasks.length === 0 ? (
              <EmptyState title="لا مهام مفتوحة" body="كل شيء منجز. أضف مهمة جديدة عندما تجهز." />
            ) : (
              <ul className="list">
                {openTasks.slice(0, 6).map((t) => (
                  <li key={t.id} className="listrow">
                    <div className="listrow__main">
                      <span className="listrow__title">{t.title}</span>
                      <span className="listrow__meta">
                        <TaskStatusBadge status={t.status} />
                        {t.dueAt ? <span>الاستحقاق: {formatTime(t.dueAt)}</span> : null}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}

      {loading && data ? <p className="muted">جارٍ التحديث…</p> : null}
    </>
  );
}
