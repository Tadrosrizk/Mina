# خطوات تشغيل v29 (بنك الأسئلة)

## 1) قاعدة البيانات (Supabase → SQL Editor) — SQL بس، مفيش JavaScript
شغّل الملفات بالترتيب ده، كل ملف لوحده (افتحه، انسخ كل محتواه، الصق، اضغط Run):
1. supabase-bible-comp-1.sql      (لو اتشغّل قبل كده، اتخطاه)
2. supabase-bible-comp-2-import.sql (لو اتشغّل قبل كده، اتخطاه)
3. supabase-bible-comp-3-pdf.sql    (لو اتشغّل قبل كده، اتخطاه)
4. supabase-bible-comp-4-bank.sql   ← الجديد. لازم يتشغّل.
كلهم آمنين لو اتشغّلوا مرتين.

## 2) التطبيق (GitHub)
ارفع محتويات المجلد ده فوق مشروعك على GitHub (استبدل الملفات). الملفات اللي اتغيّرت:
- www/bible-comp.js         (إصلاح خانات الاختيارات على الموبايل + رسايل جديدة + زر بنك الأسئلة)
- www/bible-comp-bank.js    (جديد: شاشة بنك الأسئلة)
- www/index.html            (سطر واحد: تحميل bible-comp-bank.js)
بعدها شغّل بناء الـAPK (Actions) ونزّل الـAPK وثبّته.

## 3) مفتاح Claude للـPDF (لو لسه ما عملتهوش) — من الموقع بدون terminal
Supabase → Edge Functions → Secrets → Add new secret
الاسم: ANTHROPIC_API_KEY   القيمة: مفتاحك (sk-ant-...)

## 4) جرّب
افتح التطبيق كأدمن → المسابقة الكتابية → 🗂 بنك الأسئلة → ضيف سؤال، اعتمده، عدّله.
