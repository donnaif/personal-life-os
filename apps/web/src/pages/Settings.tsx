import { useEffect, useState, type FormEvent } from 'react';
import { settingsApi } from '../api/endpoints';
import type { UserSettings } from '../api/types';
import { Button, Card, Checkbox, ErrorState, Field, Select, Skeleton } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { useToast } from '../components/Toast';
import { errorMessage } from '../lib/errors';

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

interface DayState {
  enabled: boolean;
  start: string;
  end: string;
}

interface FormState {
  timezone: string;
  locale: 'ar' | 'en';
  theme: 'light' | 'dark' | 'system';
  defaultSessionDurationMin: string;
  defaultBreakMin: string;
  minLeadTimeMin: string;
  allowOverlap: boolean;
  quietStart: string;
  quietEnd: string;
  days: DayState[];
}

function minToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function hhmmToMin(v: string): number {
  const [h, m] = v.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function fromSettings(s: UserSettings): FormState {
  const days: DayState[] = WEEKDAYS.map((_, weekday) => {
    const day = s.availability.find((a) => a.weekday === weekday);
    const w = day?.windows[0];
    return w ? { enabled: true, start: minToHHMM(w.startMin), end: minToHHMM(w.endMin) } : { enabled: false, start: '09:00', end: '17:00' };
  });
  const q = s.quietHours[0];
  return {
    timezone: s.timezone,
    locale: s.locale,
    theme: s.theme,
    defaultSessionDurationMin: String(s.defaultSessionDurationMin),
    defaultBreakMin: String(s.defaultBreakMin),
    minLeadTimeMin: String(s.minLeadTimeMin),
    allowOverlap: s.allowOverlap,
    quietStart: q ? minToHHMM(q.startMin) : '23:00',
    quietEnd: q ? minToHHMM(q.endMin) : '06:00',
    days,
  };
}

export function Settings() {
  const { notify } = useToast();
  const { data, loading, error, reload } = useResource(() => settingsApi.get(), []);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setForm(fromSettings(data));
  }, [data]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const availability = form.days
        .map((d, weekday) =>
          d.enabled ? { weekday, windows: [{ startMin: hhmmToMin(d.start), endMin: hhmmToMin(d.end) }] } : null,
        )
        .filter((x): x is { weekday: number; windows: Array<{ startMin: number; endMin: number }> } => x !== null);

      await settingsApi.update({
        timezone: form.timezone.trim() || 'UTC',
        locale: form.locale,
        theme: form.theme,
        availability,
        quietHours: [{ startMin: hhmmToMin(form.quietStart), endMin: hhmmToMin(form.quietEnd) }],
        defaultSessionDurationMin: Math.max(1, Math.round(Number(form.defaultSessionDurationMin) || 30)),
        defaultBreakMin: Math.max(0, Math.round(Number(form.defaultBreakMin) || 0)),
        allowOverlap: form.allowOverlap,
        minLeadTimeMin: Math.max(0, Math.round(Number(form.minLeadTimeMin) || 0)),
      });
      notify('حُفظت الإعدادات.', 'ok');
      reload();
    } catch (err) {
      notify(errorMessage(err), 'danger');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <header className="toolbar">
        <div>
          <h1 className="app__title">الإعدادات</h1>
          <p className="app__subtitle">تحكم في التوفر وساعات الهدوء الافتراضية المستخدمة في الجدولة.</p>
        </div>
      </header>

      {error ? (
        error.isNetwork ? (
          <p className="banner banner--danger">تعذّر الاتصال بالخادم ({error.message}). المنفذ المتوقع: 3100.</p>
        ) : (
          <ErrorState message={error.message} onRetry={reload} />
        )
      ) : null}

      {loading && !form ? <Skeleton height="10rem" /> : null}

      {form ? (
        <Card title="التفضيلات">
          <form className="formgrid" onSubmit={save}>
            <Field
              label="المنطقة الزمنية"
              value={form.timezone}
              onChange={(e) => setForm({ ...form, timezone: e.target.value })}
              hint="مثال: Asia/Riyadh — تُستخدم لحساب التوفر."
              dir="ltr"
            />
            <Select
              label="اللغة"
              value={form.locale}
              onChange={(e) => setForm({ ...form, locale: e.target.value as FormState['locale'] })}
              options={[
                { value: 'ar', label: 'العربية' },
                { value: 'en', label: 'English' },
              ]}
            />
            <Select
              label="المظهر"
              value={form.theme}
              onChange={(e) => setForm({ ...form, theme: e.target.value as FormState['theme'] })}
              options={[
                { value: 'system', label: 'حسب النظام' },
                { value: 'light', label: 'فاتح' },
                { value: 'dark', label: 'داكن' },
              ]}
            />
            <Field
              label="طول الجلسة الافتراضي (دقيقة)"
              type="number"
              min={1}
              value={form.defaultSessionDurationMin}
              onChange={(e) => setForm({ ...form, defaultSessionDurationMin: e.target.value })}
            />
            <Field
              label="الراحة بين الجلسات (دقيقة)"
              type="number"
              min={0}
              value={form.defaultBreakMin}
              onChange={(e) => setForm({ ...form, defaultBreakMin: e.target.value })}
            />
            <Field
              label="أدنى مهلة قبل البدء (دقيقة)"
              type="number"
              min={0}
              value={form.minLeadTimeMin}
              onChange={(e) => setForm({ ...form, minLeadTimeMin: e.target.value })}
            />
            <Field
              label="بداية ساعات الهدوء"
              type="time"
              value={form.quietStart}
              onChange={(e) => setForm({ ...form, quietStart: e.target.value })}
            />
            <Field
              label="نهاية ساعات الهدوء"
              type="time"
              value={form.quietEnd}
              onChange={(e) => setForm({ ...form, quietEnd: e.target.value })}
            />
            <Checkbox
              className="formgrid--full"
              label="السماح بتداخل الجلسات"
              checked={form.allowOverlap}
              onChange={(e) => setForm({ ...form, allowOverlap: e.target.checked })}
            />

            <div className="formgrid--full">
              <p className="field__label">أوقات التوفر الأسبوعية</p>
              <div className="list">
                {form.days.map((d, i) => (
                  <div key={WEEKDAYS[i]} className="sessionchip">
                    <Checkbox
                      label={WEEKDAYS[i]!}
                      checked={d.enabled}
                      onChange={(e) => {
                        const days = [...form.days];
                        days[i] = { ...d, enabled: e.target.checked };
                        setForm({ ...form, days });
                      }}
                    />
                    <input
                      type="time"
                      className="field__input"
                      aria-label={`بداية ${WEEKDAYS[i]}`}
                      value={d.start}
                      disabled={!d.enabled}
                      onChange={(e) => {
                        const days = [...form.days];
                        days[i] = { ...d, start: e.target.value };
                        setForm({ ...form, days });
                      }}
                    />
                    <input
                      type="time"
                      className="field__input"
                      aria-label={`نهاية ${WEEKDAYS[i]}`}
                      value={d.end}
                      disabled={!d.enabled}
                      onChange={(e) => {
                        const days = [...form.days];
                        days[i] = { ...d, end: e.target.value };
                        setForm({ ...form, days });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="formgrid--full">
              <Button type="submit" variant="primary" loading={saving}>
                حفظ الإعدادات
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
