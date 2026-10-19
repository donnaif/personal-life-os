# CHANGELOG

## [Unreleased] — 2026-10-18 — Phase 3: تطبيق سطح المكتب (`apps/desktop`)

### Added
- `apps/desktop`: غلاف Electron 44 (CommonJS) يعرض واجهة الويب المبنية داخل نافذة Windows أصلية
  (اسم التطبيق «Personal Life OS»)، بلا نسخ لأي كود واجهة.
  - خادم محلي على `127.0.0.1:3105` يخدم `apps/web/dist` مع SPA fallback ووكيل `/api`
    إلى `127.0.0.1:3100` وإزالة البادئة، ومنافذ بديلة (3106/3107/3102/3103) ثم منفذ النظام.
  - عزل كامل: `contextIsolation`/`sandbox` مفعّلان، `nodeIntegration` مطفأ، منع النوافذ المنبثقة
    و`webview` والأذونات والتنقّل خارج الأصل، وCSP للتطوير والإنتاج.
  - جسر preload ضيق مع تحقق من كل رسالة IPC، وتشفير OS (`safeStorage`) للرمز.
  - مخزن الملف الشخصي `desktop-state.json` لرمز التحديث المشفَّر (خارج `localStorage`).
  - إشعارات Windows اختيارية (opt-in) مع نافذة 10 دقائق وحاجز 5 دقائق ومنع تكرار دائم.
  - قائمة عربية/إنجليزية، tray، حفظ أبعاد النافذة، وأيقونة PNG/ICO مولَّدة برمجيًا.
  - وضع تحقّق `--smoke` يشغّل 17 خطوة حقيقية داخل التطبيق ويكتب النتيجة JSON + لقطة شاشة،
    مع `--profile-dir` لتشغيله على ملف تعريف معزول بلا لمس بيانات المستخدم.
- سكربتات الجذر: `build:desktop`, `dev:desktop`, `smoke:desktop`, `package:win`
  (حزم متكررة عبر `@electron/packager` بلا تثبيت/توقيع/نشر).

### Changed
- `apps/web` (أقل تعديل ممكن، موثّق): `api/tokenStore.ts` + `desktop-bridge.ts` لاختيار
  المخزن (desktop ⇒ ملف مشفَّر، متصفح ⇒ `localStorage`)، و`lib/dueSessions.ts` +
  `hooks/useDesktopNotifications.ts` لإشعارات اختيارية فقط، وربط التنقّل من القائمة الأصلية.
- `vitest.config.ts` و`tsconfig`s تشمل اختبارات desktop وweb الجديدة.

### Fixed
- **فقدان الجلسة عند كل إقلاع** (عيب حقيقي ظهر عند تشغيل الحزمة): كان المنفذ عشوائيًا فيتغيّر
  أصل الواجهة ويفقد `localStorage` الرمز ⇒ منفذ ثابت + مخزن ملف شخصي مشفَّر.
- حزم غير صالح: كان `extraResource` يُنتج `resources/.stage/web` فيخرج التطبيق المحزَّم
  بالرمز 2 («أصول الويب مفقودة») ⇒ staging إلى `.stage/web` + تحقق بعد الحزم من `resources/web/index.html`.
- إعدادات المستخدم كانت تُصفَّر صامتًا إذا احتوى الملف على BOM (UTF-8) ⇒ تحمّل BOM في قراءة
  `settings-store`/`local-state` مع اختبارين.
- `resolveStaticFile`: عدم تطابق المسار المختصر على Windows (realpath) كان يرفض طلبات صحيحة.

### Tests
- 135 اختبار vitest ناجح (14 ملفًا): منها 49 لـdesktop (خادم، إعدادات، إشعارات، أيقونة،
  تهيئة، مخزن محلي) واختبارات ويب جديدة (اختيار الجلسات المستحقة، مخزن الرمز).
- تحقّق فعلي: `Personal Life OS.exe --smoke` → 17/17 خطوة، تسجيل دخول حقيقي، رمز مشفَّر
  (`enc:…`) خارج `localStorage`، ثبات الجلسة بعد إعادة التحميل وبعد إعادة التشغيل،
  صفر أخطاء طرفية، لقطة لوحة اليوم معاينة بصريًا.

## [Unreleased] — 2026-10-18 — Phase 2: Web client (`apps/web`)

### Added
- `apps/web`: واجهة React 19 + Vite 8 (منفذ 3101، RTL عربي) تستهلك الـAPI فعليًا.
  - نظام تصميم «Quiet Ledger» (`styles/tokens.css`) مع فاتح/داكن (`data-theme`) وتفضيل مخزَّن.
  - طبقة API حقيقية (`api/client.ts`, `api/endpoints.ts`): رمز الوصول في الذاكرة فقط،
    رمز التحديث في `localStorage`، إعادة محاولة واحدة عند 401، وأخطاء شبكة واضحة (status 0).
  - الصفحات: تسجيل الدخول/إنشاء المالك، لوحة اليوم، المهام، الخطة، العادات، التقارير، الإعدادات.
  - تنقّل جانبي على الحاسوب وتنقّل سفلي على الجوال، وحالات فراغ/خطأ/تحميل لكل قائمة.
- `npm run typecheck` يشغّل المشاريع الثلاثة صراحةً، و`npm run build:web` للإنتاج.
- `apps/web/public/favicon.svg` (كان 404 الوحيد في الطرفية).

### Fixed
- الجلسة كانت تُفقد عند إعادة تحميل الصفحة: نداءان متزامنان لتحديث الرمز (StrictMode)
  كانا يستهلكان نفس رمز التحديث مرة واحدة → تشارك نداء واحد الآن، ومعالج «فُقدت الجلسة»
  لم يعد يُلغى من mount قديم.
- إعادة الجدولة كانت تتجاهل الجلسات المحفوظة → تداخل مواعيد. الآن الجلسات المخزَّنة تُحسب
  وقتًا مشغولًا (`busy`) فلا يُحجز فوقها.
- `persist` في `/schedule/plan` كان يحذف سجل الجلسات المنتهية → الآن تُستبدل الجلسات
  غير المبدوءة فقط (`planned`)، والتاريخ (running/completed/cancelled) محفوظ.
- بطاقات الأرقام كانت عمودًا واحدًا طويلًا على الجوال → صارت شبكة 2×2.
- `typecheck` في `package.json` كان يشير إلى `tsconfig.json` غير موجود → أُصلح.

### Tests
- 71 اختبار vitest ناجح (49 core + 22 API)، منها اختباران انحداريان لمنع التداخل
  وحفظ سجل الجلسات عند إعادة الجدولة.
- تحقّق يدوي كامل عبر Playwright: تسجيل، مهام، جدولة، دورة جلسة كاملة
  (start→pause→resume→complete)، عادات، تقارير، إعدادات، تبديل المظهر، خروج،
  حالة انقطاع الـAPI، وعرض جوال 390×844 — **صفر أخطاء في الطرفية**.

## [Unreleased] — 2026-10-18 — Phase 2: API layer

### Added
- `apps/api`: خادم Fastify 5 (CORS, JWT, rate-limit) فوق `node:sqlite` المدمج.
  - المصادقة: تسجيل bootstrap (أول مستخدم فقط)، دخول، تحديث الرموز (refresh rotation)، خروج.
  - الإعدادات: قراءة/تحديث (المنطقة الزمنية، التوفر، ساعات الهدوء).
  - المهام: إنشاء/قراءة/تحديث/حذف ناعم + جدولة الجلسات وحفظها.
  - الجلسات: start/pause/resume/complete/cancel مع منع الانتقالات غير الصحيحة.
  - الجدولة: `/schedule/plan` (اختياريًا persist) للخطة الكاملة بلا تداخل.
  - العادات: إنشاء/تحديث/أرشفة + تسجيل يومي (idempotent) + حساب السلسلة.
  - التقارير: ملخصات مهام/جلسات + سلسلة زمنية يومية + توزيع بالتصنيف.
  - المزامنة: `change_log` للقراءة + `/sync/push` بمنع التكرار عبر `op_id`.
- ترحيلات SQLite معلَّمة بـ `PRAGMA user_version`.
- اختبارات تكامل API (20) عبر `app.inject()`.

### Security
- ترقية `@fastify/jwt` 9 → 10 و`vitest` 2 → 5 لإزالة ثغرات حرجة/عالية.
- `npm audit` = 0 ثغرات.

### Fixed
- alias لـ `node:sqlite` في بيئة الاختبار (Vite لا يتعرّف على البِلتِن ذي البادئة فقط).

## [0.1.0] — 2026-10-18 — Phase 0-2 (foundation)

### Added
- تهيئة monorepo (npm workspaces) وTypeScript في `strict`.
- تقارير التدقيق: `ENVIRONMENT_AUDIT`, `ARCHITECTURE_DECISIONS`, `TOOLING_REGISTRY`,
  `server/EXISTING_SERVICES_AUDIT`, `server/PORT_ALLOCATION`, `server/DEPLOYMENT_SAFETY`.
- `packages/core`: نموذج المجال والأنواع (مهام، جلسات، عادات، تكرار، تنبيهات).
- `docs/TESTING_STRATEGY.md`, `docs/SECURITY_REVIEW.md`, `docs/AI_MODEL_EVALUATION.md`.

### Decisions
- SQLite معزول بدل PostgreSQL المشترك (ADR-0003).
- Electron بدل Tauri (ADR-0006).
- لا Docker؛ تشغيل أصلي + PM2 مخصص (ADR-0011).
