import { useState } from 'react';
import { habitsApi, type HabitInput } from '../api/endpoints';
import type { Habit, HabitStreak } from '../api/types';
import { Button, Card, EmptyState, ErrorState, Field, Select, Skeleton } from '../components/ui';
import { Modal } from '../components/Modal';
import { useResource } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/errors';
import { toLocalDateKey } from '../lib/format';

interface HabitRow {
  habit: Habit;
  streak: HabitStreak;
  doneToday: boolean;
}

export function Habits() {
  const { notify } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState<{ title: string; description: string; targetCount: string; targetPeriod: string }>({
    title: '',
    description: '',
    targetCount: '1',
    targetPeriod: 'day',
  });

  const today = toLocalDateKey(new Date());

  const { data, loading, error, reload, setData } = useResource(async () => {
    const habits = await habitsApi.list();
    const rows = await Promise.all(
      habits.map(async (habit): Promise<HabitRow> => {
        const streak = await habitsApi.streak(habit.id);
        // NOTE: the API currently exposes no endpoint to read habit logs, so
        // "logged today" is tracked optimistically for this session only.
        return { habit, streak, doneToday: false };
      }),
    );
    return rows;
  }, [today]);

  const submit = async () => {
    if (!form.title.trim()) {
      setFormError('العنوان مطلوب.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const input: HabitInput = {
        title: form.title.trim(),
        description: form.description.trim() || undefined,
        targetCount: Math.max(1, Math.round(Number(form.targetCount) || 1)),
        targetPeriod: form.targetPeriod as HabitInput['targetPeriod'],
      };
      const created = await habitsApi.create(input);
      setData((prev) => (prev ? [...prev, { habit: created, streak: { current: 0, longest: 0 }, doneToday: false }] : prev));
      notify('أُضيفت العادة.', 'ok');
      setModalOpen(false);
      setForm({ title: '', description: '', targetCount: '1', targetPeriod: 'day' });
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const setToday = async (row: HabitRow, completed: boolean) => {
    setBusyId(row.habit.id);
    try {
      await habitsApi.log(row.habit.id, today, completed, completed ? row.habit.targetCount : 0);
      const streak = await habitsApi.streak(row.habit.id);
      setData((prev) =>
        prev ? prev.map((r) => (r.habit.id === row.habit.id ? { ...r, doneToday: completed, streak } : r)) : prev,
      );
      notify(completed ? 'سُجِّل اليوم.' : 'أُلغي تسجيل اليوم.', 'ok');
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  const archive = async (row: HabitRow) => {
    if (!window.confirm(`أرشفة العادة «${row.habit.title}»؟`)) return;
    setBusyId(row.habit.id);
    try {
      await habitsApi.archive(row.habit.id);
      setData((prev) => (prev ? prev.filter((r) => r.habit.id !== row.habit.id) : prev));
      notify('أُرشفت العادة.', 'ok');
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <header className="toolbar">
        <div>
          <h1 className="app__title">العادات</h1>
          <p className="app__subtitle">تابع استمراريتك يومًا بيوم.</p>
        </div>
        <Button variant="primary" icon={<span aria-hidden>＋</span>} onClick={() => setModalOpen(true)}>
          عادة جديدة
        </Button>
      </header>

      {error ? (
        error.isNetwork ? (
          <p className="banner banner--danger">تعذّر الاتصال بالخادم: {error.message}</p>
        ) : (
          <ErrorState message={error.message} onRetry={reload} />
        )
      ) : null}

      <Card>
        {loading && !data ? (
          <div className="list">
            <Skeleton height="3.2rem" />
            <Skeleton height="3.2rem" />
          </div>
        ) : (data ?? []).length === 0 ? (
          <EmptyState title="لا عادات بعد" body="أضف عادة واحدة وابدأ بتسجيلها اليوم." />
        ) : (
          <div className="list">
            {(data ?? []).map((row) => (
              <div key={row.habit.id} className="listrow">
                <div className="listrow__main">
                  <span className="listrow__title">{row.habit.title}</span>
                  <span className="listrow__meta">
                    <span className="num">الاستمرارية الحالية: {row.streak.current}</span>
                    <span className="num">الأطول: {row.streak.longest}</span>
                    <span className="num">الهدف: {row.habit.targetCount} / {row.habit.targetPeriod === 'day' ? 'يوم' : row.habit.targetPeriod === 'week' ? 'أسبوع' : 'شهر'}</span>
                  </span>
                  {row.habit.description ? <span className="muted">{row.habit.description}</span> : null}
                </div>
                <div className="listrow__actions">
                  {row.doneToday ? (
                    <Button size="sm" loading={busyId === row.habit.id} onClick={() => setToday(row, false)}>
                      إلغاء تسجيل اليوم
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={busyId === row.habit.id}
                      onClick={() => setToday(row, true)}
                    >
                      سجّل اليوم
                    </Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => archive(row)}>
                    أرشفة
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={modalOpen}
        title="عادة جديدة"
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <Button onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button variant="primary" loading={saving} onClick={submit}>
              إضافة
            </Button>
          </>
        }
      >
        {formError ? (
          <p className="banner banner--danger" role="alert">
            {formError}
          </p>
        ) : null}
        <Field label="العنوان" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <Field
          label="الوصف"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <Field
          label="الهدف (عدد)"
          type="number"
          min={1}
          value={form.targetCount}
          onChange={(e) => setForm({ ...form, targetCount: e.target.value })}
        />
        <Select
          label="دورية الهدف"
          value={form.targetPeriod}
          onChange={(e) => setForm({ ...form, targetPeriod: e.target.value })}
          options={[
            { value: 'day', label: 'يومي' },
            { value: 'week', label: 'أسبوعي' },
            { value: 'month', label: 'شهري' },
          ]}
        />
      </Modal>
    </>
  );
}
