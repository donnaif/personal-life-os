import { useMemo, useState, type FormEvent } from 'react';
import { tasksApi, type TaskInput } from '../api/endpoints';
import type { Session, Task, TaskStatus } from '../api/types';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Select,
  Skeleton,
  TextArea,
} from '../components/ui';
import { Modal } from '../components/Modal';
import { PriorityBadge, SessionStatusBadge, TaskStatusBadge } from '../components/StatusBadge';
import { SessionActions } from '../components/SessionActions';
import { useResource } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/errors';
import { formatMinutes, formatShortDate, formatTimeRange, isoToLocalInput, localInputToIso } from '../lib/format';

type Filter = 'open' | 'completed' | 'all';

const TERMINAL = new Set<TaskStatus>(['completed', 'cancelled']);

interface FormState {
  title: string;
  description: string;
  priority: string;
  status: string;
  dueAt: string;
  estimatedDurationMin: string;
  sessionDurationMin: string;
  sessionCount: string;
  sessionIntervalMin: string;
  intervalAnchor: string;
  windowStart: string;
  windowEnd: string;
  notes: string;
  autoComplete: boolean;
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  priority: '3',
  status: 'not_started',
  dueAt: '',
  estimatedDurationMin: '',
  sessionDurationMin: '',
  sessionCount: '',
  sessionIntervalMin: '',
  intervalAnchor: 'end',
  windowStart: '',
  windowEnd: '',
  notes: '',
  autoComplete: false,
};

function toForm(task: Task): FormState {
  return {
    title: task.title,
    description: task.description ?? '',
    priority: String(task.priority),
    status: task.status,
    dueAt: isoToLocalInput(task.dueAt),
    estimatedDurationMin: task.estimatedDurationMin ? String(task.estimatedDurationMin) : '',
    sessionDurationMin: task.sessionDurationMin ? String(task.sessionDurationMin) : '',
    sessionCount: task.sessionCount ? String(task.sessionCount) : '',
    sessionIntervalMin: task.sessionIntervalMin ? String(task.sessionIntervalMin) : '',
    intervalAnchor: task.intervalAnchor ?? 'end',
    windowStart: task.windowStart ?? '',
    windowEnd: task.windowEnd ?? '',
    notes: task.notes ?? '',
    autoComplete: Boolean(task.autoComplete),
  };
}

function toInput(f: FormState): TaskInput {
  const num = (v: string): number | undefined => {
    if (!v.trim()) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
  };
  return {
    title: f.title.trim(),
    description: f.description.trim() || undefined,
    priority: Number(f.priority),
    status: f.status,
    dueAt: localInputToIso(f.dueAt),
    estimatedDurationMin: num(f.estimatedDurationMin),
    sessionDurationMin: num(f.sessionDurationMin),
    sessionCount: num(f.sessionCount),
    sessionIntervalMin: f.sessionIntervalMin.trim() ? Math.max(0, Math.round(Number(f.sessionIntervalMin))) : undefined,
    intervalAnchor: f.intervalAnchor === 'start' ? 'start' : 'end',
    windowStart: f.windowStart || undefined,
    windowEnd: f.windowEnd || undefined,
    notes: f.notes.trim() || undefined,
    autoComplete: f.autoComplete,
  };
}

export function Tasks() {
  const { notify } = useToast();
  const [filter, setFilter] = useState<Filter>('open');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, Session[] | 'loading'>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const { data, loading, error, reload, setData } = useResource(() => tasksApi.list(), []);

  const tasks = data ?? [];
  const visible = useMemo(() => {
    if (filter === 'all') return tasks;
    if (filter === 'completed') return tasks.filter((t) => t.status === 'completed');
    return tasks.filter((t) => !TERMINAL.has(t.status));
  }, [tasks, filter]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (task: Task) => {
    setEditing(task);
    setForm(toForm(task));
    setFormError(null);
    setModalOpen(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError('العنوان مطلوب.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input = toInput(form);
      if (editing) {
        const updated = await tasksApi.update(editing.id, input);
        setData((prev) => (prev ? prev.map((t) => (t.id === updated.id ? updated : t)) : prev));
        notify('حُدِّثت المهمة.', 'ok');
      } else {
        const created = await tasksApi.create(input);
        setData((prev) => (prev ? [...prev, created] : [created]));
        notify('أُضيفت المهمة.', 'ok');
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const patchStatus = async (task: Task, status: TaskStatus) => {
    setRowBusy(task.id);
    try {
      const updated = await tasksApi.update(task.id, { status });
      setData((prev) => (prev ? prev.map((t) => (t.id === updated.id ? updated : t)) : prev));
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setRowBusy(null);
    }
  };

  const removeTask = async (task: Task) => {
    if (!window.confirm(`حذف المهمة «${task.title}»؟ يمكن التراجع عنها لاحقًا من قاعدة البيانات.`)) return;
    setRowBusy(task.id);
    try {
      await tasksApi.remove(task.id);
      setData((prev) => (prev ? prev.filter((t) => t.id !== task.id) : prev));
      notify('حُذفت المهمة.', 'ok');
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setRowBusy(null);
    }
  };

  const planTask = async (task: Task) => {
    setRowBusy(task.id);
    try {
      const result = await tasksApi.plan(task.id);
      setExpanded((prev) => ({ ...prev, [task.id]: result.sessions }));
      if (result.conflicts.length > 0) {
        notify(`جُدِّدت الجلسات، لكن ${result.conflicts.length} تعارضًا لم يُحلّ.`, 'danger');
      } else {
        notify(`جُدِّدت ${result.sessions.length} جلسة.`, 'ok');
      }
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setRowBusy(null);
    }
  };

  const toggleSessions = async (task: Task) => {
    setExpanded((prev) => {
      const copy = { ...prev };
      delete copy[task.id];
      return copy;
    });
    if (expanded[task.id]) return;
    setExpanded((prev) => ({ ...prev, [task.id]: 'loading' }));
    try {
      const sessions = await tasksApi.sessions(task.id);
      setExpanded((prev) => ({ ...prev, [task.id]: sessions }));
    } catch (err) {
      notify(errorMessage(err), 'danger');
      setExpanded((prev) => {
        const copy = { ...prev };
        delete copy[task.id];
        return copy;
      });
    }
  };

  const replaceSession = (taskId: string, next: Session) => {
    setExpanded((prev) => {
      const list = prev[taskId];
      if (!Array.isArray(list)) return prev;
      return { ...prev, [taskId]: list.map((s) => (s.id === next.id ? next : s)) };
    });
  };

  return (
    <>
      <header className="toolbar">
        <div>
          <h1 className="app__title">المهام</h1>
          <p className="app__subtitle">أنشئ المهام ووزّع جلساتها على وقتك المتاح.</p>
        </div>
        <Button variant="primary" icon={<span aria-hidden>＋</span>} onClick={openCreate}>
          مهمة جديدة
        </Button>
      </header>

      <div className="tabs" role="tablist" aria-label="تصفية المهام">
        {(
          [
            ['open', 'المفتوحة'],
            ['completed', 'المكتملة'],
            ['all', 'الكل'],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={filter === key}
            className={`tab${filter === key ? ' tab--active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error.message} onRetry={reload} /> : null}

      <Card>
        {loading && !data ? (
          <div className="list">
            <Skeleton height="3.2rem" />
            <Skeleton height="3.2rem" />
            <Skeleton height="3.2rem" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            title="لا مهام في هذا التصنيف"
            body="ابدأ بمهمة جديدة، ثم اضغط «جدولة» لتقسيمها إلى جلسات فعلية."
            action={
              <Button variant="primary" onClick={openCreate}>
                مهمة جديدة
              </Button>
            }
          />
        ) : (
          <div className="list">
            {visible.map((task) => {
              const sessions = expanded[task.id];
              return (
                <div key={task.id} className="listrow">
                  <div className="listrow__main">
                    <span className="listrow__title">{task.title}</span>
                    <span className="listrow__meta">
                      <TaskStatusBadge status={task.status} />
                      <PriorityBadge priority={task.priority} />
                      {task.dueAt ? <span>الاستحقاق: {formatShortDate(task.dueAt)}</span> : null}
                      {task.estimatedDurationMin ? (
                        <span className="num">المقدّر: {formatMinutes(task.estimatedDurationMin)}</span>
                      ) : null}
                      {task.sessionDurationMin ? (
                        <span className="num">الجلسة: {formatMinutes(task.sessionDurationMin)}</span>
                      ) : null}
                      {task.sessionCount ? <span className="num">العدد: {task.sessionCount}</span> : null}
                    </span>
                    {task.description ? <span className="muted">{task.description}</span> : null}

                    {sessions === 'loading' ? <Skeleton height="1.6rem" width="70%" /> : null}
                    {Array.isArray(sessions) ? (
                      sessions.length === 0 ? (
                        <span className="muted">لا جلسات بعد. اضغط «جدولة».</span>
                      ) : (
                        <div className="sessions">
                          {sessions.map((s) => (
                            <div key={s.id} className="sessionchip">
                              <span className="num">
                                {s.index + 1}. {formatTimeRange(s.plannedStartAt, s.plannedEndAt)}
                              </span>
                              <span className="num">{formatMinutes(s.plannedDurationMin)}</span>
                              <SessionStatusBadge status={s.status} />
                              <SessionActions session={s} onChanged={(next) => replaceSession(task.id, next)} />
                            </div>
                          ))}
                        </div>
                      )
                    ) : null}
                  </div>

                  <div className="listrow__actions">
                    <Button size="sm" loading={rowBusy === task.id} onClick={() => planTask(task)}>
                      جدولة
                    </Button>
                    <Button size="sm" onClick={() => toggleSessions(task)}>
                      {expanded[task.id] ? 'إخفاء الجلسات' : 'الجلسات'}
                    </Button>
                    <Button size="sm" onClick={() => openEdit(task)}>
                      تعديل
                    </Button>
                    {task.status === 'completed' ? (
                      <Button size="sm" onClick={() => patchStatus(task, 'not_started')}>
                        إعادة فتح
                      </Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => patchStatus(task, 'completed')}>
                        إكمال
                      </Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => removeTask(task)}>
                      حذف
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title={editing ? 'تعديل المهمة' : 'مهمة جديدة'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button variant="primary" loading={saving} onClick={() => document.getElementById('task-form-submit')?.click()}>
              {editing ? 'حفظ' : 'إضافة'}
            </Button>
          </>
        }
      >
        <form className="formgrid" onSubmit={submit} noValidate>
          {formError ? (
            <p className="banner banner--danger formgrid--full" role="alert">
              {formError}
            </p>
          ) : null}

          <Field
            className="formgrid--full"
            label="العنوان"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />

          <TextArea
            className="formgrid--full"
            label="الوصف"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />

          <Select
            label="الأولوية"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={[
              { value: '1', label: '1 — عاجلة جدًا' },
              { value: '2', label: '2 — عالية' },
              { value: '3', label: '3 — عادية' },
              { value: '4', label: '4 — منخفضة' },
              { value: '5', label: '5 — منخفضة جدًا' },
            ]}
          />

          <Select
            label="الحالة"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={[
              { value: 'not_started', label: 'لم تبدأ' },
              { value: 'scheduled', label: 'مجدولة' },
              { value: 'ready', label: 'جاهزة' },
              { value: 'in_progress', label: 'قيد التنفيذ' },
              { value: 'paused', label: 'متوقفة' },
              { value: 'deferred', label: 'مؤجلة' },
              { value: 'completed', label: 'مكتملة' },
              { value: 'cancelled', label: 'ملغاة' },
            ]}
          />

          <Field
            label="تاريخ الاستحقاق"
            type="datetime-local"
            value={form.dueAt}
            onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
          />

          <Field
            label="الزمن المقدّر (دقيقة)"
            type="number"
            min={1}
            value={form.estimatedDurationMin}
            onChange={(e) => setForm({ ...form, estimatedDurationMin: e.target.value })}
            hint="يُستخدم لاحتساب عدد الجلسات إن لم تحدّده."
          />

          <Field
            label="طول الجلسة (دقيقة)"
            type="number"
            min={1}
            value={form.sessionDurationMin}
            onChange={(e) => setForm({ ...form, sessionDurationMin: e.target.value })}
            hint="اتركه فارغًا لاستخدام الافتراضي من الإعدادات."
          />

          <Field
            label="عدد الجلسات"
            type="number"
            min={1}
            value={form.sessionCount}
            onChange={(e) => setForm({ ...form, sessionCount: e.target.value })}
          />

          <Field
            label="الفاصل بين الجلسات (دقيقة)"
            type="number"
            min={0}
            value={form.sessionIntervalMin}
            onChange={(e) => setForm({ ...form, sessionIntervalMin: e.target.value })}
          />

          <Select
            label="مرجع الفاصل"
            value={form.intervalAnchor}
            onChange={(e) => setForm({ ...form, intervalAnchor: e.target.value })}
            options={[
              { value: 'end', label: 'من نهاية الجلسة' },
              { value: 'start', label: 'من بداية الجلسة' },
            ]}
          />

          <Field
            label="بداية النافذة (HH:mm)"
            type="time"
            value={form.windowStart}
            onChange={(e) => setForm({ ...form, windowStart: e.target.value })}
            hint="قيّد الجلسات بساعات محددة (اختياري)."
          />

          <Field
            label="نهاية النافذة (HH:mm)"
            type="time"
            value={form.windowEnd}
            onChange={(e) => setForm({ ...form, windowEnd: e.target.value })}
          />

          <TextArea
            className="formgrid--full"
            label="ملاحظات"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />

          <Checkbox
            className="formgrid--full"
            label="أكمل المهمة تلقائيًا عند إنهاء آخر جلسة"
            checked={form.autoComplete}
            onChange={(e) => setForm({ ...form, autoComplete: e.target.checked })}
          />

          <button id="task-form-submit" type="submit" className="sr-only">
            حفظ
          </button>
        </form>
      </Modal>
    </>
  );
}
