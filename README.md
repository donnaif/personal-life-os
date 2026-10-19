# Personal Life OS — نظام الحياة الشخصي

نظام متكامل لإدارة المهام والوقت والعادات والإنتاجية، يعمل على **الويب + Windows + Android**.
> الحالة: الويب وWindows جاهزان ومُختبَران فعليًا. العمل دون اتصال والمزامنة متعدّدة الأجهزة
> وAndroid **لم تُنفَّذ بعد** ولم تُختبر.

## البنية (monorepo)

```
packages/core   منطق المجال النقي (جدولة، تكرار، جلسات، مؤقت، تقارير، مزامنة) — قابل للاختبار
apps/api        خادم Fastify + node:sqlite + مصادقة + جدولة
apps/web        React 19 + Vite 8 + RTL/العربية (منفذ 3101)
apps/desktop    Electron 44 — نافذة Windows (انظر docs/DESKTOP.md)
apps/android    Kotlin/Compose (لاحقًا، بعد موافقة)
docs/           التدقيق، القرارات، الأمان، الاختبار
```

## المتطلبات

- Node.js ≥ 20 (لدينا 24)
- npm ≥ 10 (لدينا 11)
- لا حاجة لـ Docker أو Postgres

## التشغيل

```powershell
npm install
npm test                 # اختبارات الوحدة
npm run typecheck        # فحص الأنواع (core + api + web + desktop)

npm run dev:api          # API على 127.0.0.1:3100
npm run dev:web          # الويب على 127.0.0.1:3101

npm run build:web        # مطلوب قبل حزم تطبيق سطح المكتب
npm run smoke:desktop    # تحقّق فعلي من التطبيق (17 خطوة) ثم خروج
npm run package:win      # حزم Windows → apps/desktop/release/
```

## الإعداد

انسخ `.env.example` إلى `.env` واملأ القيم محليًا. **لا تُرفع `.env` إلى Git.**

## السلامة

- المشروع معزول داخل مجلد المشروع؛ لا يلمس المشاريع القائمة.
- لا نشر عام أو تعديل nginx/DNS/Firewall دون موافقة.
- راجع `docs/server/DEPLOYMENT_SAFETY.md`.

## الوثائق

- `PROJECT_STATUS.md` — الحالة الحالية.
- `docs/DESKTOP.md` — تطبيق سطح المكتب (أوامر، أمان، تحقّق، حزم).
- `docs/ENVIRONMENT_AUDIT.md` — البيئة.
- `docs/ARCHITECTURE_DECISIONS.md` — القرارات.
- `docs/TESTING_STRATEGY.md` — الاختبارات.
- `docs/SECURITY_REVIEW.md` — الأمان.
