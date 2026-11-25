# Blade X

بوت إدارة Discord احترافي وبسيط، مناسب لسيرفر صغير أو متوسط. يوفر الترحيب بالصور المخصصة، واللوجز، والعقوبات، والحماية من السبام، والرولات القابلة للاختيار، ولوحة تحكم ويب.

## المتطلبات

- Node.js 22 أو أحدث (LTS)
- npm
- تطبيق Discord Bot مع Token
- سيرفر Discord

## التثبيت

```bash
git clone <repo-url>
cd Blade-X
npm install
```

## Among Us Manager – Speaking Manager

يمكن تشغيل طبقة **Speaking Manager** الاختيارية وإيقافها في أي وقت من لوحة Among Us، دون إعادة إعداد البوت أو إيقاف نظام اللعبة الأساسي.

- عند تعطيلها: يعمل الاجتماع بالطريقة العادية (الأحياء يتكلمون بحرية، الأموات مكتومون).
- عند تفعيلها: طلب كلام + قائمة انتظار FIFO + مؤقت محفوظ في Turso + مرحلتا Round Robin و Open Discussion + مداخلات سريعة وأدوات مضيف.
- زر **Start Meeting** يفتح أولًا نافذة **Select Dead Players** قبل بدء الاجتماع.
- تُحفظ الإعدادات وحالة الدور في جدولين جديدين (`amongus_speaking_settings`, `amongus_speaking_state`)؛ لا يتم تعديل جداول Among Us الموجودة.

اختبار المنطق البحت:

```bash
npm run test:speaking
```