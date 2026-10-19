import { reportsApi } from '../api/endpoints';
import { Card, EmptyState, ErrorState, Skeleton } from '../components/ui';
import { useResource } from '../hooks/useResource';
import { formatMinutes } from '../lib/format';

export function Reports() {
  const { data, loading, error, reload } = useResource(() => reportsApi.summary(), []);

  return (
    <>
      <header className="toolbar">
        <div>
          <h1 className="app__title">التقارير</h1>
          <p className="app__subtitle">أرقام مشتقة من مهامك وجلساتك الفعلية فقط.</p>
        </div>
      </header>

      {error ? <ErrorState message={error.message} onRetry={reload} /> : null}
      {loading && !data ? <Skeleton height="8rem" /> : null}

      {data ? (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat__value num">{data.tasks.total}</span>
              <span className="stat__label">إجمالي المهام</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{data.tasks.completed}</span>
              <span className="stat__label">مكتملة</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{data.tasks.overdue}</span>
              <span className="stat__label">متأخرة</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{Math.round(data.tasks.completionRate * 100)}%</span>
              <span className="stat__label">نسبة الإنجاز</span>
            </div>
          </div>

          <div className="stats">
            <div className="stat">
              <span className="stat__value num">{formatMinutes(data.sessions.totalPlannedMin)}</span>
              <span className="stat__label">زمن مخطط</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{formatMinutes(data.sessions.totalActualMin)}</span>
              <span className="stat__label">زمن فعلي (جلسات مكتملة)</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{data.sessions.total}</span>
              <span className="stat__label">إجمالي الجلسات</span>
            </div>
            <div className="stat">
              <span className="stat__value num">{data.sessions.byStatus.completed}</span>
              <span className="stat__label">جلسات مكتملة</span>
            </div>
          </div>

          <Card title="السلسلة اليومية">
            {data.daily.length === 0 ? (
              <EmptyState title="لا بيانات زمنية بعد" body="ستظهر هنا الأيام بعد وجود جلسات مجدولة." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>اليوم</th>
                    <th>مخطط</th>
                    <th>فعلي</th>
                    <th>جلسات</th>
                    <th>مكتملة</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((d) => (
                    <tr key={d.date}>
                      <td className="num">{d.date}</td>
                      <td className="num">{formatMinutes(d.plannedMin)}</td>
                      <td className="num">{formatMinutes(d.actualMin)}</td>
                      <td className="num">{d.sessions}</td>
                      <td className="num">{d.completedSessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="الزمن حسب التصنيف">
            {data.byCategory.length === 0 ? (
              <EmptyState title="لا تصنيفات" body="الأرقام الحالية بلا تصنيف لأن واجهة الـAPI لا توفر إدارة تصنيفات بعد." />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>التصنيف</th>
                    <th>مخطط</th>
                    <th>فعلي</th>
                    <th>جلسات</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byCategory.map((c) => (
                    <tr key={c.categoryId ?? 'none'}>
                      <td>{c.categoryId ?? 'بدون تصنيف'}</td>
                      <td className="num">{formatMinutes(c.plannedMin)}</td>
                      <td className="num">{formatMinutes(c.actualMin)}</td>
                      <td className="num">{c.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : null}
    </>
  );
}
