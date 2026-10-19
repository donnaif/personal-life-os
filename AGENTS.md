# AGENTS.md — Personal Life OS

دليل هذا المشروع لأي جلسة عمل جديدة (أي وكيل/محادثة). اقرأه كاملًا قبل أي تعديل.
**المصادر الأساسية للحالة:** `PROJECT_STATUS.md` ثم `docs/HANDOFF.md` ثم `docs/CHANGELOG.md`.
**المستودع العام:** https://github.com/donnaif/personal-life-os (فرع `main`) — كل ما يُدفع هنا مرئي للعالم.

## 1. ما هذا المشروع

نظام إنتاجية شخصي (مهام، وقت، جلسات، عادات، تقارير) بواجهة عربية RTL، يعمل على:
- **الويب**: `apps/web` (React 19 + Vite 8) على `127.0.0.1:3101`.
- **Windows**: `apps/desktop` (Electron 44) — يعيد استخدام مخرجات الويب كما هي.
- **Android**: لاحقًا (Kotlin + Compose) — غير مُنفَّذ.

منطق المجال النقي في `packages/core`، والـAPI في `apps/api` (Fastify 5 + `node:sqlite`).

## 2. البنية

```
packages/core     منطق المجال (جدولة، تكرار، جلسات، مؤقت، تقارير) — بلا تبعيات خارجية
apps/api          Fastify + node:sqlite + JWT + zod   → 127.0.0.1:3100
apps/web          React + Vite + CSS متغيّرات (فاتح/داكن) → 3101
apps/desktop      Electron: خادم محلي + وكيل /api + جسر آمن + إشعارات → 3105
docs/             الحالة، القرارات (ADR)، الاختبار، الأمان، سطح المكتب
docs/server/*     محلي فقط (مضيف خاص) — مستثنى من Git، لا تنشره
```

## 3. الأوامر

```powershell
npm install
npm test                 # vitest (135 اختبارًا)
npm run typecheck        # core + api + web + desktop
npm run dev:api          # API على 3100
npm run dev:web          # واجهة تطوير على 3101 (توكّل /api → 3100)
npm run build:web        # مطلوب قبل الحزم
npm run dev:desktop      # Electron في وضع التطوير
npm run smoke:desktop    # تحقّق فعلي من التطبيق (17 خطوة) ثم خروج بالرمز 0/1
npm run package:win      # حزمة Windows → apps/desktop/release/
```
`npm run lint` **معطّل** (eslint غير مثبَّت) — لا تدّعِ أنه يعمل.

## 4. قواعد إلزامية

1. **لا أسرار**: لا تُكتب كلمات مرور أو رموز (tokens) في أي ملف مُتتبَّع. بيانات التحقّق
   تُمرَّر عبر متغيّرات بيئة (`LIFEOS_E2E_EMAIL`/`LIFEOS_E2E_PASSWORD`).
2. **المستودع عام**: لا ترفع ملفات تعريف المضيف، ولا أسماء/منافذ مشاريع أخرى، ولا
   `apps/api/data/*.sqlite`، ولا `.env`. التحقق قبل كل push: بحث عن `ghp_`, `sk-`,
   `-----BEGIN`, كلمات مرور، وأسماء الخوادم في الملفات الجديدة.
3. **لا تلمس شيئًا خارج المشروع**: لا خدمات أخرى على المضيف، ولا مشاريع مجاورة.
4. **العقود**: `/api` بادئة تعاقدية؛ الوكلاء (Vite وdesktop) يحذفونها. لا تُغيّرها دون تحديث
   الطرفين + اختبار.
5. **الاختبار شرط للادّعاء**: `typecheck` + `vitest` + تشغيل فعلي. للويب/الديسكتوب شغّل
   `npm run smoke:desktop` أو Playwright. لا تقل "تم" بلا دليل.
6. **لا commit/push** إلا بطلب صريح من المالك، وبرسالة واضحة بلا أسرار.
7. **الترخيص**: أي مكتبة/مكوّن جديد → تحقق ترخيص أولًا (انظر `docs/TOOLING_REGISTRY.md`).
8. **التوثيق مزامنة**: أي تغيير سلوكي يُحدَّث معه `PROJECT_STATUS.md` + `docs/CHANGELOG.md`،
   وأي قرار معماري يُوثَّق كـADR في `docs/ARCHITECTURE_DECISIONS.md`.

## 5. بدء جلسة جديدة (خطوات الاستئناف)

1. اقرأ `PROJECT_STATUS.md` و`docs/HANDOFF.md` (الحالة والعمل التالي المحدد).
2. `git status` و`git log --oneline -5` لمعرفة ما لم يُلتَزم بعد.
3. تأكد أن الـAPI يعمل قبل أي اختبار واجهة: `npm run dev:api` ثم `curl 127.0.0.1:3100/health`.
4. شغّل `npx vitest run` و`npm run typecheck` قبل أي تعديل (خط أساس نظيف).
5. نفّذ المهمة، ثم وثّق، ثم أوقف الخوادم التي شغّلتها.

## 6. الحالة الحالية (2026-10-18)

- مكتمل ومُتحقَّق منه: `packages/core`، `apps/api`، `apps/web`، `apps/desktop` (مُحزَّم ومختبَر
  فعليًا بـ17/17 خطوة).
- التالي: تطبيق Android، أو معالجة النواقص المذكورة في `PROJECT_STATUS.md` §6.
