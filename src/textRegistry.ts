// ============================================================
// Blade X — Central Text Registry (v5 — Turso)
// ============================================================
import { dbClient } from './database.js';
import { config } from './config.js';

export interface TextDef {
  key: string;
  category: string;
  description: string;
  defaultValue: string;
  variables?: string[];
  maxLength?: number;
  componentType?: 'text' | 'embed_title' | 'embed_desc' | 'button_label' | 'ephemeral' | 'container';
}

export const CATEGORY_LABELS: Record<string, string> = {
  movie: '🎬 Movie Night',
  movie_night: '🎬 Movie Night',
  welcome: '👋 Welcome',
  logs: '📋 Logs',
  selfroles: '🎭 Self Roles',
  self_roles: '🎭 Self Roles',
  moderation: '🔨 Moderation',
  media: '📸 Media Show',
  media_show: '📸 Media Show',
  support: '🎫 Support',
  general: '⚙️ General',
  builder: '🛠️ Message Builder',
};

export const TEXT_REGISTRY: TextDef[] = [
  // ===== Movie Night — DM Start Card =====
  { key: 'movie_night.dm.title', category: 'movie_night', description: 'عنوان رسالة بدء التقييم (DM)', defaultValue: '🎬 {movie}', variables: ['movie'], componentType: 'text' },
  { key: 'movie_night.dm.instructions_ar', category: 'movie_night', description: 'تعليمات عربية في DM', defaultValue: '**فيلم الليلة: {movie}**\n\nشكرًا لمشاركتك في ليلة السينما! قيّم الفيلم من نجمة واحدة إلى خمس نجوم، ويمكنك إضافة تعليق على تجربتك.', variables: ['movie'], componentType: 'text' },
  { key: 'movie_night.dm.instructions_en', category: 'movie_night', description: 'تعليمات إنجليزية في DM', defaultValue: "**Tonight's movie: {movie}**\n\nThanks for joining! Rate from 1 to 5 stars.", variables: ['movie'], componentType: 'text' },
  { key: 'movie_night.dm.partial_rating', category: 'movie_night', description: 'رسالة عند اختيار التقييم فقط (بدون تعليق)', defaultValue: '✅ **تم تسجيل تقييمك:** {stars} **{rating}/5**\n📝 اكتب مراجعتك بالزر أدناه.', variables: ['stars', 'rating'], componentType: 'text' },
  { key: 'movie_night.dm.partial_comment', category: 'movie_night', description: 'رسالة عند كتابة تعليق فقط (بدون تقييم)', defaultValue: '✅ **تم تسجيل مراجعتك.**\n⭐ قيّم الفيلم من القائمة أدناه.', componentType: 'text' },
  { key: 'movie_night.dm.select_placeholder', category: 'movie_night', description: 'نص قائمة اختيار التقييم (DM)', defaultValue: '⭐ اختر تقييمك (1-5)', componentType: 'text' },
  { key: 'movie_night.dm.comment_button', category: 'movie_night', description: 'زر كتابة المراجعة', defaultValue: '✍️ اكتب مراجعتك', componentType: 'button_label', maxLength: 80 },
  { key: 'movie_night.dm.submit_button', category: 'movie_night', description: 'زر إرسال التقييم', defaultValue: '✅ إرسال التقييم', componentType: 'button_label', maxLength: 80 },
  { key: 'movie_night.dm.footer', category: 'movie_night', description: 'فوتر رسالة DM', defaultValue: '-# {botName} · Movie Night', variables: ['botName'], componentType: 'text' },

  // ===== Movie Night — Thanks Card =====
  { key: 'movie_night.thanks.title', category: 'movie_night', description: 'عنوان رسالة الشكر', defaultValue: 'تم إرسال تقييمك', componentType: 'text' },
  { key: 'movie_night.thanks.line1', category: 'movie_night', description: 'سطر النجوم والدرجة', defaultValue: '{stars} — **{rating}/5**', variables: ['stars', 'rating'], componentType: 'text' },
  { key: 'movie_night.thanks.movie', category: 'movie_night', description: 'سطر اسم الفيلم', defaultValue: '🎬 **الفيلم:** {movie}', variables: ['movie'], componentType: 'text' },
  { key: 'movie_night.thanks.closing', category: 'movie_night', description: 'رسالة الشكر الختامية', defaultValue: 'شكرًا لمشاركتك! 🤍', componentType: 'text' },
  { key: 'movie_night.thanks.button', category: 'movie_night', description: 'نص زر "عرض تقييمي"', defaultValue: 'عرض تقييمي', componentType: 'button_label', maxLength: 80 },
  { key: 'movie_night.thanks.button_emoji', category: 'movie_night', description: 'إيموجي زر عرض التقييم', defaultValue: '🔗', componentType: 'text', maxLength: 60 },
  { key: 'movie_night.thanks.footer', category: 'movie_night', description: 'فوتر رسالة الشكر', defaultValue: '-# {botName} · Movie Night', variables: ['botName'], componentType: 'text' },

  // ===== Movie Night — Thread & Summary =====
  { key: 'movie_night.thread.title', category: 'movie_night', description: 'عنوان Thread المراجعات', defaultValue: "Tonight's Movie Review — {movie}", variables: ['movie'], componentType: 'text', maxLength: 100 },
  { key: 'movie_night.thread.starter', category: 'movie_night', description: 'عنوان لوحة بداية المراجعة', defaultValue: '🎬 {movie}', variables: ['movie'], componentType: 'text' },
  { key: 'movie_night.thread.waiting', category: 'movie_night', description: 'نص الانتظار في الملخص', defaultValue: '⏳ في انتظار أول تقييم...', componentType: 'text' },
  { key: 'movie_night.thread.summary_title', category: 'movie_night', description: 'عنوان رسالة ملخص التقييمات', defaultValue: '🎬 {movie}', variables: ['movie'], componentType: 'text' },
  { key: 'movie_night.thread.footer', category: 'movie_night', description: 'فوتر رسائل Thread والملخص', defaultValue: '{botName} · Movie Night', variables: ['botName'], componentType: 'text' },
  { key: 'movie_night.summary.average', category: 'movie_night', description: 'سطر المتوسط', defaultValue: '**⭐ المتوسط:** {average}', variables: ['average'], componentType: 'text' },

  // ===== Movie Night — Review Card =====
  { key: 'movie_night.review.rating', category: 'movie_night', description: 'سطر التقييم في بطاقة المراجعة', defaultValue: '{stars} — **{rating}/5**', variables: ['stars', 'rating'], componentType: 'text' },
  { key: 'movie_night.review.footer', category: 'movie_night', description: 'فوتر بطاقة المراجعة', defaultValue: '-# {movie} · {botName}', variables: ['movie', 'botName'], componentType: 'text' },

  // ===== Movie Night — Draft / Unified Panel =====
  { key: 'movie_night.draft.title', category: 'movie_night', description: 'عنوان لوحة المسودة', defaultValue: '🎬 {movie}', variables: ['movie'], componentType: 'text' },
  { key: 'movie_night.draft.helper', category: 'movie_night', description: 'نص مساعدة لوحة المسودة', defaultValue: 'اختر عدد النجوم، أضف تعليقًا (اختياري)، ثم اضغط **إرسال**.', componentType: 'text' },
  { key: 'movie_night.draft.rating_line', category: 'movie_night', description: 'سطر يعرض التقييم الحالي', defaultValue: '**⭐ تقييمك:** {stars}\n{comment_line}', variables: ['stars', 'comment_line'], componentType: 'text' },
  { key: 'movie_night.draft.no_rating_yet', category: 'movie_night', description: 'نص عندما لا يتم اختيار تقييم بعد', defaultValue: '— لم تختر بعد —', componentType: 'text' },
  { key: 'movie_night.draft.comment_line', category: 'movie_night', description: 'سطر التعليق الحالي', defaultValue: '**💬 تعليقك:** {comment}', variables: ['comment'], componentType: 'text' },
  { key: 'movie_night.draft.no_comment', category: 'movie_night', description: 'نص عندما لا يوجد تعليق', defaultValue: '*لا يوجد تعليق.*', componentType: 'text' },
  { key: 'movie_night.draft.select_current', category: 'movie_night', description: 'placeholder القائمة عندما يوجد تقييم', defaultValue: '⭐ التقييم الحالي: {rating}/5', variables: ['rating'], componentType: 'text' },
  { key: 'movie_night.draft.select_prompt', category: 'movie_night', description: 'placeholder القائمة عند عدم وجود تقييم', defaultValue: '⭐ اختر تقييمك (1-5)', componentType: 'text' },
  { key: 'movie_night.draft.comment_edit_btn', category: 'movie_night', description: 'زر تعديل التعليق (بعد كتابته)', defaultValue: '💬 تعديل التعليق', componentType: 'button_label', maxLength: 80 },
  { key: 'movie_night.draft.comment_add_btn', category: 'movie_night', description: 'زر إضافة تعليق (قبل كتابته)', defaultValue: '💬 إضافة تعليق (اختياري)', componentType: 'button_label', maxLength: 80 },
  { key: 'movie_night.draft.footer', category: 'movie_night', description: 'فوتر لوحة المسودة', defaultValue: '-# {botName} · Movie Night', variables: ['botName'], componentType: 'text' },

  // ===== Movie Night — Modal =====
  { key: 'movie_night.modal.title', category: 'movie_night', description: 'عنوان النافذة المنبثقة لكتابة التعليق', defaultValue: '💬 اكتب تعليقك (اختياري)', componentType: 'text', maxLength: 45 },
  { key: 'movie_night.modal.label', category: 'movie_night', description: 'اسم حقل التعليق', defaultValue: 'تعليقك على الفيلم', componentType: 'text', maxLength: 45 },
  { key: 'movie_night.modal.placeholder', category: 'movie_night', description: 'النص الإرشادي داخل حقل التعليق', defaultValue: 'اكتب رأيك... (اتركه فارغًا لتخطي التعليق)', componentType: 'text', maxLength: 100 },

  // ===== Movie Night — Success =====
  { key: 'movie_night.success.start', category: 'movie_night', description: 'رسالة نجاح بدء الجلسة', defaultValue: '✅ بدأت جلسة **{movie}**.\n📨 أُرسل: **{sent}** / فشل: **{failed}** / الإجمالي: **{total}**\nسيُنشأ Thread عند وصول أول تقييم.', variables: ['movie', 'sent', 'failed', 'total'], componentType: 'ephemeral' },
  { key: 'movie_night.success.close', category: 'movie_night', description: 'رسالة نجاح إغلاق الجلسة', defaultValue: '✅ تم إغلاق جلسة **{movie}**.', variables: ['movie'], componentType: 'ephemeral' },
  { key: 'movie_night.success.comment_saved', category: 'movie_night', description: 'رسالة نجاح حفظ التعليق', defaultValue: '✅ تم حفظ التعليق.', componentType: 'ephemeral' },
  { key: 'movie_night.success.no_comment', category: 'movie_night', description: 'رسالة عند حفظ تعليق فارغ', defaultValue: 'ℹ️ لم تكتب تعليقًا.', componentType: 'ephemeral' },
  { key: 'movie_night.success.image_fallback', category: 'movie_night', description: 'رسالة عند نجاح التقييم لكن فشل عرض الصورة', defaultValue: '✅ تم استلام تقييمك، لكن تعذّر عرض الصورة.', componentType: 'ephemeral' },

  // ===== Movie Night — Errors =====
  { key: 'movie_night.error.session_not_found', category: 'movie_night', description: 'الجلسة غير موجودة', defaultValue: '❌ الجلسة غير موجودة.', componentType: 'ephemeral' },
  { key: 'movie_night.error.session_closed', category: 'movie_night', description: 'الجلسة مغلقة (عند التقييم)', defaultValue: '🔒 الجلسة أُغلقت.', componentType: 'ephemeral' },
  { key: 'movie_night.error.session_closed_simple', category: 'movie_night', description: 'الجلسة مغلقة (عند التفاعل)', defaultValue: '🔒 الجلسة مغلقة.', componentType: 'ephemeral' },
  { key: 'movie_night.error.not_recipient', category: 'movie_night', description: 'العضو غير مشارك في الجلسة', defaultValue: '❌ لست مشاركًا مؤهلًا.', componentType: 'ephemeral' },
  { key: 'movie_night.error.already_rated', category: 'movie_night', description: 'العضو قيّم الفيلم بالفعل', defaultValue: '⚠️ قيّمت هذا الفيلم بالفعل.', componentType: 'ephemeral' },
  { key: 'movie_night.error.rating_already_submitted', category: 'movie_night', description: 'العضو أرسل التقييم (عند الإرسال)', defaultValue: '⚠️ قيّمت الفيلم بالفعل.', componentType: 'ephemeral' },
  { key: 'movie_night.error.invalid_rating', category: 'movie_night', description: 'قيمة التقييم غير صالحة', defaultValue: '❌ قيمة غير صالحة.', componentType: 'ephemeral' },
  { key: 'movie_night.error.no_rating_selected', category: 'movie_night', description: 'لم يتم اختيار تقييم', defaultValue: '❌ اختر تقييمًا أولًا.', componentType: 'ephemeral' },
  { key: 'movie_night.error.no_voice_channel', category: 'movie_night', description: 'قناة السينما الصوتية غير مضبوطة', defaultValue: '❌ قناة السينما الصوتية غير مضبوطة.', componentType: 'ephemeral' },
  { key: 'movie_night.error.no_reviews_channel', category: 'movie_night', description: 'قناة المراجعات النصية غير مضبوطة', defaultValue: '❌ قناة المراجعات النصية غير مضبوطة.', componentType: 'ephemeral' },
  { key: 'movie_night.error.no_guild', category: 'movie_night', description: 'السيرفر غير موجود', defaultValue: '❌ السيرفر غير موجود.', componentType: 'ephemeral' },
  { key: 'movie_night.error.voice_channel_missing', category: 'movie_night', description: 'قناة السينما غير موجودة', defaultValue: '❌ قناة السينما غير موجودة.', componentType: 'ephemeral' },
  { key: 'movie_night.error.not_voice_channel', category: 'movie_night', description: 'القناة المحددة ليست صوتية', defaultValue: '❌ القناة المحددة ليست قناة صوتية.', componentType: 'ephemeral' },
  { key: 'movie_night.error.no_members', category: 'movie_night', description: 'لا يوجد أعضاء في القناة الصوتية', defaultValue: '⚠️ لا يوجد أعضاء في قناة السينما.', componentType: 'ephemeral' },
  { key: 'movie_night.error.active_session_exists', category: 'movie_night', description: 'توجد جلسة مفتوحة بالفعل', defaultValue: '⚠️ توجد جلسة مفتوحة بالفعل: **{movie}**.', variables: ['movie'], componentType: 'ephemeral' },
  { key: 'movie_night.error.generic', category: 'movie_night', description: 'خطأ عام في Movie Night', defaultValue: '❌ حدث خطأ.', componentType: 'ephemeral' },

  // ===== Media Show =====
  { key: 'media_show.post.error', category: 'media_show', description: 'خطأ عند عدم وجود المنشور', defaultValue: '❌ المنشور غير موجود.', componentType: 'ephemeral' },
  { key: 'media_show.viewall.error', category: 'media_show', description: 'خطأ عند فشل View All', defaultValue: '❌ فشل عرض القائمة: {error}', variables: ['error'], componentType: 'ephemeral' },
  { key: 'media_show.no_media', category: 'media_show', description: 'نص عند فقد الميديا', defaultValue: '*⚠️ الميديا غير متاحة حاليًا*', componentType: 'text' },
  { key: 'media_show.footer_template', category: 'media_show', description: 'الفوتر في Media Show', defaultValue: '-# {botName} · Media Show · {user}', variables: ['botName', 'user'], componentType: 'text' },

  // ===== Support =====
  { key: 'support.ticket.created', category: 'support', description: 'نجاح إنشاء التذكرة', defaultValue: '✅ تم إنشاء تذكرتك: {channel}', variables: ['channel'], componentType: 'ephemeral' },
  { key: 'support.ticket.archived', category: 'support', description: 'نجاح أرشفة التذكرة', defaultValue: '✅ تم أرشفة التذكرة وحذف القناة خلال ثوانٍ...', componentType: 'ephemeral' },
  { key: 'support.suggestion.posted', category: 'support', description: 'نجاح إرسال الاقتراح', defaultValue: '✅ تم إرسال اقتراحك! {url}', variables: ['url'], componentType: 'ephemeral' },

  // ===== Moderation =====
  { key: 'moderation.kick.success', category: 'moderation', description: 'نجاح الطرد', defaultValue: '✅ تم طرد {user}.', variables: ['user'], componentType: 'ephemeral' },
  { key: 'moderation.ban.success', category: 'moderation', description: 'نجاح الحظر', defaultValue: '✅ تم حظر {user} لمدة {duration}.', variables: ['user', 'duration'], componentType: 'ephemeral' },
  { key: 'moderation.timeout.success', category: 'moderation', description: 'نجاح الإسكات', defaultValue: '✅ تم إسكات {user} لمدة {duration}.', variables: ['user', 'duration'], componentType: 'ephemeral' },
  { key: 'moderation.error.permission', category: 'moderation', description: 'خطأ الصلاحيات', defaultValue: '❌ ليس لديك صلاحية.', componentType: 'ephemeral' },
  { key: 'moderation.error.hierarchy', category: 'moderation', description: 'خطأ التسلسل', defaultValue: '❌ رتبة العضو أعلى من رتبة البوت.', componentType: 'ephemeral' },

  // ===== Self Roles =====
  { key: 'selfroles.panel.title', category: 'selfroles', description: 'عنوان لوحة الرولات', defaultValue: '🎭 Self-Assignable Roles', componentType: 'text', maxLength: 256 },
  { key: 'selfroles.panel.description', category: 'selfroles', description: 'وصف لوحة الرولات', defaultValue: '**اختر الرولات التي تناسبك بالضغط على الأزرار أدناه.**\n*Click the buttons below to toggle your roles.*', componentType: 'text', maxLength: 2000 },
  { key: 'selfroles.panel.instructions', category: 'selfroles', description: 'تعليمات تظهر تحت الوصف', defaultValue: '**دليل الألوان:**\n🟢 **أخضر** = تملك الرول\n⚪ **رمادي** = لا تملك الرول', componentType: 'text', maxLength: 2000 },
  { key: 'selfroles.panel.footer', category: 'selfroles', description: 'فوتر لوحة الرولات', defaultValue: 'Blade X · Self Roles', componentType: 'text', maxLength: 200 },
  { key: 'selfroles.personal.title', category: 'selfroles', description: 'عنوان اللوحة الشخصية /roles', defaultValue: '🎭 اختر رولاتك', componentType: 'text', maxLength: 256 },
  { key: 'selfroles.personal.description', category: 'selfroles', description: 'وصف اللوحة الشخصية (يدعم {owned}/{total})', defaultValue: '**تملك حاليًا:** {owned} / {total} رول', variables: ['owned', 'total'], componentType: 'text', maxLength: 500 },
  { key: 'selfroles.personal.instructions', category: 'selfroles', description: 'تعليمات اللوحة الشخصية', defaultValue: '**الأزرار الخضراء** = رولات تملكها\n**الأزرار الرمادية** = رولات لا تملكها\n\nاضغط أي زر للتبديل.', componentType: 'text', maxLength: 2000 },
  { key: 'selfroles.personal.footer', category: 'selfroles', description: 'فوتر اللوحة الشخصية', defaultValue: 'Blade X · Personal Roles', componentType: 'text', maxLength: 200 },
  { key: 'selfroles.success.add', category: 'selfroles', description: 'رسالة نجاح إضافة الرول', defaultValue: '✅ تم إضافة **{role}**', variables: ['role'], componentType: 'ephemeral', maxLength: 500 },
  { key: 'selfroles.success.remove', category: 'selfroles', description: 'رسالة نجاح إزالة الرول', defaultValue: '➖ تم إزالة **{role}**', variables: ['role'], componentType: 'ephemeral', maxLength: 500 },
  { key: 'selfroles.error.not_allowed', category: 'selfroles', description: 'الرول غير مسموح', defaultValue: '❌ هذا الرول غير مسموح به. / This role is not allowed.', componentType: 'ephemeral' },
  { key: 'selfroles.error.hierarchy', category: 'selfroles', description: 'البوت لا يستطيع إدارة الرول', defaultValue: '❌ لا يمكن للبوت إدارة هذا الرول. / Bot cannot manage this role.', componentType: 'ephemeral' },
  { key: 'selfroles.error.role_missing', category: 'selfroles', description: 'الرول غير موجود', defaultValue: '❌ الرول غير موجود.', componentType: 'ephemeral' },
  { key: 'selfroles.error.generic', category: 'selfroles', description: 'خطأ عام في Self Roles', defaultValue: '❌ حدث خطأ.', componentType: 'ephemeral' },
  { key: 'selfroles.empty.no_roles', category: 'selfroles', description: 'رسالة عند عدم وجود رولات', defaultValue: '⚠️ لا توجد رولات متاحة.', componentType: 'ephemeral' },

  // ===== Welcome System =====
  { key: 'welcome.panel.title', category: 'welcome', description: 'عنوان رسالة الترحيب (يدعم {emoji})', defaultValue: '{emoji} Welcome', variables: ['emoji', 'username', 'displayName', 'server', 'memberCount'], componentType: 'text', maxLength: 256 },
  { key: 'welcome.panel.body', category: 'welcome', description: 'نص الترحيب العام — يُستخدم إذا لم يُعيَّن body_ar أو body_en', defaultValue: '{user} — {phrase}', variables: ['user', 'username', 'displayName', 'server', 'memberCount', 'phrase', 'emoji'], componentType: 'text', maxLength: 2000 },
  { key: 'welcome.panel.body_ar', category: 'welcome', description: 'النص العربي في رسالة الترحيب (اختياري)', defaultValue: '', variables: ['user', 'username', 'displayName', 'server', 'memberCount', 'phrase', 'emoji'], componentType: 'text', maxLength: 2000 },
  { key: 'welcome.panel.body_en', category: 'welcome', description: 'النص الإنجليزي في رسالة الترحيب (اختياري)', defaultValue: '', variables: ['user', 'username', 'displayName', 'server', 'memberCount', 'phrase', 'emoji'], componentType: 'text', maxLength: 2000 },
  { key: 'welcome.panel.footer', category: 'welcome', description: 'فوتر رسالة الترحيب', defaultValue: 'Blade X · Welcome', componentType: 'text', maxLength: 200 },
  { key: 'welcome.sayhi.text', category: 'welcome', description: 'نص رسالة Say Hi', defaultValue: '**{user}** says hi to **{target}** {emoji}', variables: ['user', 'target', 'emoji'], componentType: 'text', maxLength: 1000 },
  { key: 'welcome.sayhi.footer', category: 'welcome', description: 'فوتر Say Hi', defaultValue: 'Blade X · Welcome', componentType: 'text', maxLength: 200 },
  { key: 'welcome.sayhi.success', category: 'welcome', description: 'رسالة نجاح Say Hi', defaultValue: '✅ تم إرسال ترحيبك!', componentType: 'ephemeral' },
  { key: 'welcome.sayhi.already', category: 'welcome', description: 'رسالة عند الترحيب مسبقًا', defaultValue: '⚠️ رحّبت بهذا العضو بالفعل.', componentType: 'ephemeral' },
  { key: 'welcome.sayhi.target_missing', category: 'welcome', description: 'العضو غير موجود', defaultValue: '⚠️ العضو غير موجود.', componentType: 'ephemeral' },
  { key: 'welcome.sayhi.channel_missing', category: 'welcome', description: 'قناة الترحيب غير مضبوطة', defaultValue: '⚠️ قناة الترحيب غير مضبوطة.', componentType: 'ephemeral' },

  // ===== General =====
  { key: 'general.error', category: 'general', description: 'خطأ عام', defaultValue: '❌ حدث خطأ.', componentType: 'ephemeral' },
  { key: 'general.success', category: 'general', description: 'نجاح عام', defaultValue: '✅ تم بنجاح.', componentType: 'ephemeral' },
];

// ============================================================
// Colors
// ============================================================
export interface ColorDef {
  key: string;
  category: string;
  description: string;
  defaultValue: number;
}

export const COLOR_REGISTRY: ColorDef[] = [
  { key: 'color.movie', category: 'movie_night', description: 'لون Movie Night', defaultValue: 0xe91e63 },
  { key: 'color.welcome', category: 'welcome', description: 'لون رسائل الترحيب', defaultValue: 0x2b2d31 },
  { key: 'color.welcome_panel', category: 'welcome', description: 'لون Container في رسالة الترحيب', defaultValue: 0x2b2d31 },
  { key: 'color.selfroles', category: 'selfroles', description: 'لون Container في لوحة الرولات', defaultValue: 0x5865f2 },
  { key: 'color.selfroles_personal', category: 'selfroles', description: 'لون اللوحة الشخصية /roles', defaultValue: 0x5865f2 },
  { key: 'color.media', category: 'media_show', description: 'لون Media Show', defaultValue: 0xf59e0b },
  { key: 'color.support', category: 'support', description: 'لون Support', defaultValue: 0x5865f2 },
  { key: 'color.success', category: 'general', description: 'لون النجاح', defaultValue: 0x57f287 },
  { key: 'color.error', category: 'general', description: 'لون الخطأ', defaultValue: 0xed4245 },
  { key: 'color.warning', category: 'general', description: 'لون التحذير', defaultValue: 0xfee75c },
];

console.log(`[Blade X] 🔍 textRegistry.ts LOADED — TEXT_REGISTRY=${TEXT_REGISTRY.length} COLOR_REGISTRY=${COLOR_REGISTRY.length}`);

if (TEXT_REGISTRY.length === 0) {
  console.error('[Blade X] ❌❌❌ CRITICAL: TEXT_REGISTRY is EMPTY at module load! ❌❌❌');
}

// ============================================================
// Caches
// ============================================================
interface CacheEntry { value: string; updatedAt: number | null; }

let textsCache: Map<string, CacheEntry> | null = null;
let colorsCache: Map<string, CacheEntry> | null = null;
let FULL_REGISTRY: TextDef[] | null = null;
let warnedNotInitialized = false;

function warnNotInit(): void {
  if (!warnedNotInitialized) {
    console.warn('[Blade X] ⚠️ TextRegistry not initialized — call initTextRegistry()');
    warnedNotInitialized = true;
  }
}

export async function initTextRegistry(): Promise<void> {
  await dbClient.executeMultiple(`
    CREATE TABLE IF NOT EXISTS custom_texts (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS custom_colors (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_by TEXT,
      updated_at INTEGER NOT NULL
    );
  `);

  const textRows = await dbClient.execute('SELECT key, value, updated_at FROM custom_texts');
  textsCache = new Map();
  for (const row of textRows.rows) {
    textsCache.set(String(row.key), {
      value: String(row.value ?? ''),
      updatedAt: row.updated_at != null ? Number(row.updated_at) : null,
    });
  }

  const colorRows = await dbClient.execute('SELECT key, value, updated_at FROM custom_colors');
  colorsCache = new Map();
  for (const row of colorRows.rows) {
    colorsCache.set(String(row.key), {
      value: String(row.value ?? ''),
      updatedAt: row.updated_at != null ? Number(row.updated_at) : null,
    });
  }

  const settingsRows = await dbClient.execute(
    "SELECT key, value FROM settings WHERE key LIKE 'text.%' OR key LIKE 'color.%'"
  );
  const discoveredFromSettings = new Map<string, string>();
  for (const row of settingsRows.rows) {
    discoveredFromSettings.set(String(row.key), String(row.value ?? ''));
  }

  FULL_REGISTRY = buildFullRegistryInternal(discoveredFromSettings);

  const explicitCount = TEXT_REGISTRY.length;
  const configCount = FULL_REGISTRY.filter(t => !TEXT_REGISTRY.some(e => e.key === t.key)).length - discoveredFromSettings.size;
  const settingsCount = discoveredFromSettings.size;
  console.log(`[Blade X] ✅ Text Registry built: ${FULL_REGISTRY.length} total (${explicitCount} explicit + ${Math.max(0, configCount)} from config + ${settingsCount} from settings)`);
}

function inferCategory(key: string): string {
  const parts = key.split('.');
  if (parts.length >= 2) {
    if (parts[0] === 'text' || parts[0] === 'color') return parts[1];
    return parts[0];
  }
  return 'general';
}

function inferComponentType(key: string): TextDef['componentType'] {
  if (key.startsWith('color.')) return 'text';
  if (key.includes('button') || key.includes('label')) return 'button_label';
  if (key.includes('error') || key.includes('fail')) return 'ephemeral';
  return 'text';
}

function inferVariablesFromValue(value: string): string[] {
  const vars: string[] = [];
  const re = /\{(\w+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    if (!vars.includes(m[1])) vars.push(m[1]);
  }
  return vars;
}

function buildFullRegistryInternal(discoveredFromSettings: Map<string, string>): TextDef[] {
  const seen = new Set<string>();
  const result: TextDef[] = [];

  for (const def of TEXT_REGISTRY) {
    if (seen.has(def.key)) continue;
    seen.add(def.key);
    result.push(def);
  }

  try {
    const defaults = (config?.defaultTexts ?? {}) as Record<string, string>;
    for (const [key, value] of Object.entries(defaults)) {
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({
        key,
        category: inferCategory(key),
        description: key,
        defaultValue: value,
        variables: inferVariablesFromValue(value),
        componentType: inferComponentType(key),
      });
    }
  } catch (e) {
    console.warn('[Blade X] ⚠️ config.defaultTexts discovery failed:', e);
  }

  for (const [key, value] of discoveredFromSettings) {
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      key,
      category: inferCategory(key),
      description: key,
      defaultValue: value,
      variables: inferVariablesFromValue(value),
      componentType: inferComponentType(key),
    });
  }

  return result;
}

export function resolveTemplate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    if (v === undefined) return `{${k}}`;
    return String(v);
  });
}

export function getText(key: string, vars: Record<string, string | number> = {}, fallback = ''): string {
  const override = textsCache?.get(key);
  const def = FULL_REGISTRY?.find((t) => t.key === key);
  const template = override?.value ?? def?.defaultValue ?? fallback;
  if (!template) return fallback;
  return resolveTemplate(template, vars);
}

export function getRawText(key: string): string {
  if (!textsCache) {
    warnNotInit();
    return '';
  }
  const override = textsCache.get(key);
  if (override !== undefined) return override.value;
  const def = FULL_REGISTRY?.find((t) => t.key === key);
  return def?.defaultValue ?? '';
}

export async function setText(key: string, value: string, updatedBy?: string): Promise<{ ok: boolean; error?: string }> {
  const def = FULL_REGISTRY?.find((t) => t.key === key);
  if (!def) return { ok: false, error: `المفتاح ${key} غير مسجل` };
  if (def.maxLength && value.length > def.maxLength) {
    return { ok: false, error: `النص أطول من الحد (${def.maxLength})` };
  }
  try {
    const now = Date.now();
    await dbClient.execute({
      sql: `INSERT INTO custom_texts (key, value, updated_by, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      args: [key, value, updatedBy ?? null, now],
    });
    if (!textsCache) textsCache = new Map();
    textsCache.set(key, { value, updatedAt: now });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'DB error' };
  }
}

export async function resetText(key: string): Promise<void> {
  try {
    await dbClient.execute({ sql: 'DELETE FROM custom_texts WHERE key = ?', args: [key] });
    textsCache?.delete(key);
  } catch (e) {
    console.error('[Blade X] ❌ resetText:', e);
  }
}

export interface TextRow {
  key: string;
  category: string;
  categoryLabel: string;
  description: string;
  defaultValue: string;
  currentValue: string;
  isCustomized: boolean;
  variables: string[];
  maxLength?: number;
  componentType?: string;
  updatedAt: number | null;
}

export function listAllTexts(): TextRow[] {
  const registry = FULL_REGISTRY ?? [];
  return registry.map((def) => {
    const override = textsCache?.get(def.key);
    return {
      key: def.key,
      category: def.category,
      categoryLabel: CATEGORY_LABELS[def.category] ?? def.category,
      description: def.description,
      defaultValue: def.defaultValue,
      currentValue: override?.value ?? def.defaultValue,
      isCustomized: override !== undefined,
      variables: def.variables ?? [],
      maxLength: def.maxLength,
      componentType: def.componentType,
      updatedAt: override?.updatedAt ?? null,
    };
  });
}

export function listCategories(): string[] {
  const registry = FULL_REGISTRY ?? [];
  const set = new Set<string>();
  for (const t of registry) set.add(t.category);
  return [...set].sort();
}

export function getColor(key: string, fallback?: number): number {
  const def = COLOR_REGISTRY.find((c) => c.key === key);
  const override = colorsCache?.get(key);
  const raw = override?.value ?? (def ? `#${def.defaultValue.toString(16).padStart(6, '0')}` : null);
  if (!raw) return fallback ?? 0x5865f2;
  try { return parseInt(raw.replace('#', ''), 16); }
  catch { return fallback ?? def?.defaultValue ?? 0x5865f2; }
}

export async function setColor(key: string, hex: string, updatedBy?: string): Promise<{ ok: boolean; error?: string }> {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { ok: false, error: 'صيغة HEX غير صحيحة' };
  try {
    const now = Date.now();
    await dbClient.execute({
      sql: `INSERT INTO custom_colors (key, value, updated_by, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      args: [key, hex, updatedBy ?? null, now],
    });
    if (!colorsCache) colorsCache = new Map();
    colorsCache.set(key, { value: hex, updatedAt: now });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'DB error' };
  }
}

export async function resetColor(key: string): Promise<void> {
  try {
    await dbClient.execute({ sql: 'DELETE FROM custom_colors WHERE key = ?', args: [key] });
    colorsCache?.delete(key);
  } catch (e) {
    console.error('[Blade X] ❌ resetColor:', e);
  }
}

export interface ColorRow {
  key: string;
  category: string;
  categoryLabel: string;
  description: string;
  defaultValue: string;
  currentValue: string;
  isCustomized: boolean;
}

export function listAllColors(): ColorRow[] {
  return COLOR_REGISTRY.map((def) => {
    const defaultHex = `#${def.defaultValue.toString(16).padStart(6, '0')}`;
    const override = colorsCache?.get(def.key);
    return {
      key: def.key,
      category: def.category,
      categoryLabel: CATEGORY_LABELS[def.category] ?? def.category,
      description: def.description,
      defaultValue: defaultHex,
      currentValue: override?.value ?? defaultHex,
      isCustomized: override !== undefined,
    };
  });
}

export function getRegistryDiagnostics(): {
  explicitCount: number;
  totalCount: number;
  categoryCount: number;
  colorCount: number;
  dbTextOverrides: number;
  dbColorOverrides: number;
  textRegistryLength: number;
  colorRegistryLength: number;
} {
  const registry = FULL_REGISTRY ?? [];
  return {
    explicitCount: TEXT_REGISTRY.length,
    totalCount: registry.length,
    categoryCount: new Set(registry.map((t) => t.category)).size,
    colorCount: COLOR_REGISTRY.length,
    dbTextOverrides: textsCache?.size ?? 0,
    dbColorOverrides: colorsCache?.size ?? 0,
    textRegistryLength: TEXT_REGISTRY.length,
    colorRegistryLength: COLOR_REGISTRY.length,
  };
}