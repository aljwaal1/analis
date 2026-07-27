# تطبيق المحلل المالي الذكي لنظام Windows

يحتوي المستودع على نسخة سطح مكتب مستقلة مبنية باستخدام Electron، وتستخدم نفس محرك التحليل والواجهة الموجودة في تطبيق Android.

## الملفات التي ينتجها البناء

- `Financial-Analysis-Setup-2.0.0-beta.1-x64.exe`: مثبت Windows مع اختصار على سطح المكتب وقائمة ابدأ.
- `Financial-Analysis-Portable-2.0.0-beta.1-x64.exe`: نسخة محمولة تعمل مباشرة دون تثبيت.
- `Financial-Analysis-Android-v2.0.0-beta.1.apk`: تطبيق Android.

## الخصوصية

تعمل النسختان محليًا، وتبقى البيانات المالية داخل جهاز المستخدم. لا يتم رفع ملفات Excel أو CSV إلى خادم خارجي.

## الإصدارات

عند دمج تغييرات التطبيق في الفرع `main`، يبني GitHub Actions نسختي Android وWindows وينشرهما تلقائيًا في قسم Releases تحت رقم الإصدار الموجود في `mobile/package.json` و`desktop/package.json`.
