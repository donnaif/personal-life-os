import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { getDesktopBridge } from './desktop-bridge';
import { useDesktopNotifications } from './hooks/useDesktopNotifications';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Tasks } from './pages/Tasks';
import { Plan } from './pages/Plan';
import { Habits } from './pages/Habits';
import { Reports } from './pages/Reports';
import { Settings } from './pages/Settings';
import { Button } from './components/ui';
import {
  IconDashboard,
  IconHabits,
  IconLogout,
  IconMoon,
  IconPlan,
  IconReports,
  IconSun,
  IconTasks,
} from './components/icons';

/* ------------------------------- theme --------------------------------- */

type Theme = 'light' | 'dark';
const THEME_KEY = 'lifeos.theme';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

/* ------------------------------- layout -------------------------------- */

const NAV = [
  { to: '/', label: 'لوحة اليوم', icon: <IconDashboard />, end: true },
  { to: '/tasks', label: 'المهام', icon: <IconTasks />, end: false },
  { to: '/plan', label: 'الخطة', icon: <IconPlan />, end: false },
  { to: '/habits', label: 'العادات', icon: <IconHabits />, end: false },
  { to: '/reports', label: 'التقارير', icon: <IconReports />, end: false },
  { to: '/settings', label: 'الإعدادات', icon: <IconPlan />, end: false },
];

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

function Layout() {
  const { user, logout } = useAuth();
  const [theme, toggleTheme] = useTheme();
  const online = useOnline();
  const navigate = useNavigate();

  useDesktopNotifications();

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;
    return bridge.onNavigate((path) => {
      if (typeof path === 'string' && path.startsWith('/')) navigate(path);
    });
  }, [navigate]);

  return (
    <div className="app">
      <aside className="app__sidebar">
        <div className="brand">
          <span className="brand__mark" aria-hidden>
            ن
          </span>
          <span className="brand__name">نظامي الشخصي</span>
        </div>

        <nav className="nav" aria-label="التنقل الرئيسي">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
            >
              {item.icon}
              <span className="nav__label">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="userbox">
          <span className="userbox__email" dir="ltr">
            {user?.email}
          </span>
          <Button size="sm" icon={<IconLogout />} onClick={logout}>
            خروج
          </Button>
        </div>
      </aside>

      <div className="app__main">
        <div className="app__topbar">
          <span className="brand__name">نظامي الشخصي</span>
          <div className="toolbar">
            {!online ? <span className="badge badge--danger">غير متصل</span> : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleTheme}
              aria-label={theme === 'dark' ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن'}
              icon={theme === 'dark' ? <IconSun /> : <IconMoon />}
            />
            <Button variant="ghost" size="sm" icon={<IconLogout />} onClick={logout} aria-label="خروج" />
          </div>
        </div>

        <main className="app__content">
          <Outlet />
        </main>

        <nav className="mobilenav" aria-label="التنقل السفلي">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `mobilenav__item${isActive ? ' mobilenav__item--active' : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}

function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'booting') {
    return (
      <main className="auth">
        <p className="muted">جارٍ التحقق من الجلسة…</p>
      </main>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginGate />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Dashboard />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="plan" element={<Plan />} />
        <Route path="habits" element={<Habits />} />
        <Route path="reports" element={<Reports />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function LoginGate() {
  const { status } = useAuth();
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return <Login />;
}
