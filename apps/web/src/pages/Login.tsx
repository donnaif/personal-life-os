import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { Button, Field } from '../components/ui';

export function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'register') await register(email.trim(), password, name.trim() || undefined);
      else await login(email.trim(), password);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'registration_closed') {
          setMode('login');
          setNotice('يوجد مستخدم بالفعل على هذا النظام. سجّل الدخول بدلًا من إنشاء حساب.');
        } else if (err.code === 'invalid_credentials') {
          setError('البريد أو كلمة المرور غير صحيحة.');
        } else if (err.status === 400) {
          setError('تحقق من صحة البريد الإلكتروني وأن كلمة المرور 8 أحرف على الأقل.');
        } else {
          setError(err.message);
        }
      } else {
        setError('تعذّر إتمام العملية.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <form className="auth__card" onSubmit={submit} noValidate>
        <div className="brand">
          <span className="brand__mark" aria-hidden>
            ن
          </span>
          <span className="brand__name">نظامي الشخصي</span>
        </div>

        <h1 className="auth__title">{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء الحساب الأول'}</h1>
        <p className="auth__sub">
          {mode === 'login'
            ? 'أدخل بياناتك للوصول إلى مهامك وجلساتك.'
            : 'هذا أول تشغيل على هذا النظام، وسيُنشأ لك الحساب المالك الوحيد.'}
        </p>

        {notice ? <p className="banner banner--warn">{notice}</p> : null}
        {error ? (
          <p className="banner banner--danger" role="alert">
            {error}
          </p>
        ) : null}

        {mode === 'register' ? (
          <Field
            label="الاسم (اختياري)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        ) : null}

        <Field
          label="البريد الإلكتروني"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          dir="ltr"
        />

        <Field
          label="كلمة المرور"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          hint={mode === 'register' ? '٨ أحرف على الأقل.' : undefined}
          dir="ltr"
        />

        <Button type="submit" variant="primary" loading={busy}>
          {mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
        </Button>

        <button
          type="button"
          className="auth__switch"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
            setNotice(null);
          }}
        >
          {mode === 'login' ? 'أول تشغيل؟ إنشاء الحساب المالك' : 'لدي حساب بالفعل — تسجيل الدخول'}
        </button>
      </form>
    </main>
  );
}
