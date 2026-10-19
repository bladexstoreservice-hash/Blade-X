import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[Blade X] ❌ المتغير البيئي المطلوب ${name} غير موجود في .env`);
    process.exit(1);
  }
  return value;
}

export const config = {
  botName: 'Blade X',
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  clientSecret: requireEnv('CLIENT_SECRET'),
  guildId: requireEnv('GUILD_ID'),

  dashboard: {
    baseUrl: process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000',
    redirectUri: process.env.DASHBOARD_REDIRECT_URI ?? 'http://localhost:3000/auth/callback',
    port: parseInt(process.env.PORT ?? '3000', 10),
    sessionSecret: process.env.SESSION_SECRET ?? 'change-me-in-production',
    csrfSecret: process.env.CSRF_SECRET ?? 'change-me-too',
  },

  assets: {
    welcomeTemplate: 'assets/welcome.png',
    roleAssignImage: 'assets/roleasign.png',
    logoImage: 'assets/logo.png',
    fontPath: 'assets/ArbFONTS-RH-Zak-Bold.otf',
    // ✅ .gif — welcome.ts falls back to .png automatically if GIF missing
    hiImages: Array.from({ length: 10 }, (_, i) => `assets/hi${i + 1}.gif`),
    reviewAskImage: 'assets/Review-ask.png',
    thanksForReviewImage: 'assets/thanks-for-review.png',
    starImages: [
      'assets/1star.png',
      'assets/2star.png',
      'assets/3star.png',
      'assets/4star.png',
      'assets/5star.png',
    ],
  },

  customEmojis: {
    starFilled: '1559235085243256882',
    starEmpty: '1559235082244325527',
  },

  welcome: {
    avatarCenterX: 416,
    avatarCenterY: 512.5,
    avatarSize: 550,
    nameStartX: 839,
    nameY: 510,
    nameFontSize: 109,
    textAlign: 'left' as const,
    shadow: {
      directionDeg: -45,
      offsetPx: 40,
      blurPx: 40,
      opacity: 0.75,
      color: '#000000',
    },
    gradient: { from: '#e8e8e8', to: '#ffffff', angleDeg: 180 },
    outline: { color: '#484848', width: 40, strength: 40 },
  },

  defaultWelcomePhrases: [
    'أهلًا وسهلًا بك! 🤍 · Welcome aboard!',
    'نورت السيرفر! ✨ · Glad you\'re here!',
    'سعداء بانضمامك إلينا! 🎉 · Happy to have you here!',
    'أهلًا بك بيننا! 🌿 · Welcome to the community!',
    'البيت بيتك! 🏡 · Make yourself at home!',
    'نورت عائلتنا! 💫 · Welcome to the family!',
    'نتمنى لك وقتًا ممتعًا! 🌙 · Enjoy your stay!',
    'يسعدنا وجودك معنا! 🤍 · Great to have you with us!',
    'بداية جميلة معك! 🌸 · Here\'s to a great start!',
    'أهلًا بعضونا الجديد! 👋 · Say hello to our new member!',
    'مكانك بيننا! ✨ · Your place is here!',
    'مرحبًا بك في مجتمعنا! 🎊 · Welcome to our server!',
    'انضمامك أسعدنا! 💖 · We\'re happy you joined!',
    'نورت المكان! 🌟 · You\'ve made our day!',
    'نتمنى لك أيامًا جميلة معنا! 🌿 · Have a wonderful time here!',
    'أهلًا بك في الأجواء! 🎶 · Welcome to the good vibes!',
    'حيّاك الله بيننا! 🤍 · A warm welcome to you!',
    'مرحبًا بك، استمتع بوقتك! 🌈 · Come in and enjoy!',
    'سعداء بأنك أصبحت جزءًا منا! 🫶 · You\'re now part of the community!',
    'ننتظر أن نتعرف عليك! 💬 · We can\'t wait to know you!',
  ],

  defaultButtonLinks: {
    rules: 'https://discord.com/channels/1239983478406123542/1240038009785811105',
    roles: 'https://discord.com/channels/1239983478406123542/1495482454557851848',
    community: 'https://discord.com/channels/1239983478406123542/1495810310077157466',
  },

  defaultTexts: {
    // Welcome
    'text.welcome.title': 'Blade X · Welcome',
    'text.welcome.footer': 'Blade X · Server Management',
    'color.welcome': '#2a2a2a',

    // Join Logs
    'text.logs.join.title': 'Blade X · Member Joined',
    'text.logs.join.description': '{user} joined the server.\n{user} انضم إلى السيرفر.',
    'color.logs.join': '#57f287',

    // Leave Logs
    'text.logs.leave.title': 'Blade X · Member Left',
    'text.logs.leave.description': '{username} left the server.\nغادر السيرفر.',
    'color.logs.leave': '#ed4245',

    // Voice Logs
    'text.logs.voice.joined': '🎙️ Voice Channel Joined',
    'text.logs.voice.left': '🎙️ Voice Channel Left',
    'text.logs.voice.moved': '🎙️ Voice Channel Moved',
    'color.logs.voice': '#5865f2',

    // Role Logs
    'text.logs.role.added.title': 'Blade X · Role Added',
    'color.logs.role.added': '#57f287',
    'text.logs.role.removed.title': 'Blade X · Role Removed',
    'color.logs.role.removed': '#ed4245',

    // Self Roles
    'text.selfroles.title': 'Blade X · Self-Assignable Roles',
    'text.selfroles.description':
      '**اختر الرولات التي تناسبك من القائمة أدناه.**\n**Select the roles you want from the menu below.**',
    'text.selfroles.footer': 'Blade X · Self Roles',
    'color.selfroles': '#5865f2',
    'text.selfroles.menu.placeholder': '🎭 اختر أو أزل رولًا...',
    'text.selfroles.success.added': '✅ تم إضافة رول **{role}**.',
    'text.selfroles.success.removed': '✅ تم إزالة رول **{role}**.',
    'text.selfroles.error.not_allowed': '❌ هذا الرول غير مسموح به. / This role is not allowed.',
    'text.selfroles.error.hierarchy':
      '❌ لا يمكن للبوت إدارة هذا الرول. / Bot cannot manage this role.',

    // Moderation
    'text.moderation.dm.title': '⚔️ Blade X · إشعار إداري',

    // Movie Night Review
    'text.movie.name': 'Movie Night Review',
    'color.movie': '#e91e63',
    'text.movie.dm.title': '🎬 Movie Night Review',
    'text.movie.dm.description':
      'فيلم الليلة:\n**{movie}**\n\nشكرًا لمشاركتك في ليلة السينما!\nقيّم الفيلم من نجمة واحدة إلى خمس نجوم،\nويمكنك إضافة تعليق على تجربتك.\n\nTonight\'s movie: **{movie}**\nThanks for joining!\nRate from 1 to 5 stars.',
    'text.movie.dm.footer': 'Blade X · Movie Night',
    'text.movie.thread.title': "Tonight's Movie Review — {movie}",
    'text.movie.summary.title': "Tonight's Movie Review",
    'text.movie.summary.movie_field': '🎥 Movie',
    'text.movie.summary.average_field': '⭐ Average Rating',
    'text.movie.summary.count_field': '👥 Reviews',
    'text.movie.summary.distribution_field': '📊 Distribution',
    'text.movie.summary.no_ratings': 'لا توجد تقييمات بعد.',
    'text.movie.rating.success': '✅ تم تسجيل تقييمك: {stars}',
    'text.movie.comment.success': '✅ تم حفظ تعليقك وسيظهر في قناة التقييمات.',
    'text.movie.rating.not_recipient': '❌ لست ضمن المشاركين المؤهلين لهذه الجلسة.',
    'text.movie.rating.closed': '❌ جلسة التقييم مغلقة.',
    'text.movie.comment.button': '✍️ اكتب مراجعتك / Write a Review',
    'text.movie.modal.title': 'اكتب تعليقك على الفيلم',
    'text.movie.modal.input_label': 'تعليقك',
    'text.movie.modal.input_placeholder': 'اكتب رأيك عن الفيلم...',
  } as Record<string, string>,
} as const;

export type AppConfig = typeof config;