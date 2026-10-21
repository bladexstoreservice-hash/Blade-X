// ============================================================
// Blade X — Movie Night Review (v5 — Turso)
// ============================================================
import {
  Client, Events, Interaction, ButtonInteraction,
  StringSelectMenuInteraction, ActionRowBuilder, StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  AttachmentBuilder, MessageFlags, ChannelType, Message, ThreadChannel, TextChannel,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} from 'discord.js';
import { config } from './config.js';
import {
  createMovieSession, getMovieSession, getActiveMovieSession,
  updateMovieSession, addMovieRecipient, isMovieRecipient,
  getMovieRatingFull, upsertMovieRating, getMovieStatsFull,
  logActivity, getSetting, setCommentOnly,
  getMovieDraft, upsertMovieDraft, deleteMovieDraft, cleanupOldMovieDrafts,
  setReviewMessageId, getReviewMessageId,
} from './database.js';
import { getText, getColor } from './textRegistry.js';
import { getEmoji, starStringFromRegistry } from './emojiRegistry.js';
import { buildV2Panel, buildV2Payload, isV2Available } from './ui/v2.js';
import fs from 'node:fs';
import path from 'node:path';

let botClient: Client | null = null;
export function setMovieClient(c: Client): void { botClient = c; }

const PROJECT_ROOT = path.resolve(process.cwd());

function resolveAsset(...candidates: string[]): string | null {
  for (const rel of candidates) {
    const abs = path.isAbsolute(rel) ? rel : path.join(PROJECT_ROOT, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function getReviewAskPath(): string | null {
  return resolveAsset('assets/Review-ask.png', 'assets/review-ask.png', 'assets/Review-Ask.png');
}

function getThanksPath(): string | null {
  const candidates = [
    'assets/thanks-for-review.png',
    'assets/thanks-for-review.PNG',
    'assets/Thanks-for-review.png',
    'assets/thanks.png',
    'assets/Thank-you.png',
    'assets/thank-you.png',
  ];
  for (const c of candidates) {
    const abs = path.isAbsolute(c) ? c : path.join(PROJECT_ROOT, c);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        console.log(`[Blade X][movie] ✅ thanks image found: ${abs}`);
        return abs;
      }
    } catch { /* skip */ }
  }

  const folder = path.join(PROJECT_ROOT, 'assets', 'thanks-for-review');
  try {
    if (fs.existsSync(folder) && fs.statSync(folder).isDirectory()) {
      const files = fs.readdirSync(folder);
      const img = files.find((f) => /\.(png|jpe?g|webp|gif)$/i.test(f));
      if (img) {
        const full = path.join(folder, img);
        console.log(`[Blade X][movie] ✅ thanks image found in folder: ${full}`);
        return full;
      }
    }
  } catch { /* skip */ }

  console.warn('[Blade X][movie] ⚠️ thanks image NOT FOUND in any candidate path');
  return null;
}

function starString(n: number): string { return starStringFromRegistry(n); }

function starImageForRating(rating: number): string {
  const idx = Math.max(1, Math.min(5, Math.round(rating)));
  return config.assets.starImages[idx - 1];
}

function parseRatingValue(raw: string): number | null {
  const last = raw.split(':').pop();
  if (!last) return null;
  const n = Number(last);
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

function parseSessionId(customId: string): number {
  const parts = customId.split(':');
  const n = Number(parts[parts.length - 1]);
  return Number.isFinite(n) ? n : 0;
}

function formatCommentInlineCode(comment: string): string {
  const trimmed = comment.trim().slice(0, 800);
  if (!trimmed) return '';

  const backtickRuns = trimmed.match(/`+/g) ?? [];
  const maxRun = backtickRuns.reduce((m, s) => Math.max(m, s.length), 0);

  if (trimmed.includes('\n')) {
    const fenceLen3 = Math.max(3, maxRun + 1);
    const fence3 = '`'.repeat(fenceLen3);
    return `# ${fence3}\n${trimmed}\n${fence3}`;
  }

  const fenceLen = Math.max(1, maxRun + 1);
  const fence = '`'.repeat(fenceLen);
  const padded = trimmed.startsWith('`') || trimmed.endsWith('`') ? ` ${trimmed} ` : trimmed;
  return `# ${fence}${padded}${fence}`;
}

// ============================================================
// Thanks card
// ============================================================
function buildThanksCard(
  movieName: string,
  rating: number,
  reviewUrl: string | null,
): { container: ContainerBuilder; files: AttachmentBuilder[] } {
  const files: AttachmentBuilder[] = [];
  const container = new ContainerBuilder();
  container.setAccentColor(getColor('color.success', 0x57f287));

  const thanksPath = getThanksPath();
  if (thanksPath) {
    try {
      const attachName = `thanks_${Date.now()}.png`;
      files.push(new AttachmentBuilder(thanksPath, { name: attachName }));
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder()
            .setURL(`attachment://${attachName}`)
            .setDescription('Thanks'),
        ),
      );
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    } catch (e) {
      console.error('[Blade X][movie] ❌ failed to attach thanks image:', e);
    }
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${getText('movie_night.thanks.title', {}, 'تم إرسال تقييمك')}`),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      getText('movie_night.thanks.line1', { stars: starString(rating), rating }, `${starString(rating)} — **${rating}/5**`),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      getText('movie_night.thanks.movie', { movie: movieName }, `🎬 **الفيلم:** ${movieName}`),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(getText('movie_night.thanks.closing', {}, 'شكرًا لمشاركتك! 🤍')),
  );

  if (reviewUrl) {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false).setSpacing(1));
    const btn = new ButtonBuilder()
      .setLabel(getText('movie_night.thanks.button', {}, 'عرض تقييمي'))
      .setStyle(ButtonStyle.Link)
      .setURL(reviewUrl);
    const btnEmoji = getText('movie_night.thanks.button_emoji', {}, '🔗');
    if (btnEmoji.trim()) {
      try { btn.setEmoji(btnEmoji); } catch { /* ignore invalid */ }
    }
    container.addActionRowComponents(
      new ActionRowBuilder<ButtonBuilder>().addComponents(btn),
    );
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(getText('movie_night.thanks.footer', { botName: config.botName }, `-# ${config.botName} · Movie Night`)),
  );

  return { container, files };
}

// ============================================================
// DM start card
// ============================================================
function buildDmStartCard(
  movieName: string,
  state: 'initial' | 'partial',
  rating: number | null,
  comment: string | null,
): { container: ContainerBuilder; files: AttachmentBuilder[]; hasComment: boolean; hasRating: boolean } {
  const files: AttachmentBuilder[] = [];
  const container = new ContainerBuilder();
  container.setAccentColor(getColor('color.movie', 0xe91e63));

  const askPath = getReviewAskPath();
  if (askPath) {
    try {
      files.push(new AttachmentBuilder(askPath, { name: 'review-ask.png' }));
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder().setURL('attachment://review-ask.png').setDescription('Movie'),
        ),
      );
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    } catch { /* ignore */ }
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${getText('movie_night.dm.title', { movie: movieName }, `🎬 ${movieName}`)}`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      getText(
        'movie_night.dm.instructions_ar',
        { movie: movieName },
        `**فيلم الليلة: ${movieName}**\n\nشكرًا لمشاركتك في ليلة السينما! قيّم الفيلم من نجمة واحدة إلى خمس نجوم، ويمكنك إضافة تعليق على تجربتك.`,
      ),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      getText(
        'movie_night.dm.instructions_en',
        { movie: movieName },
        `**Tonight's movie: ${movieName}**\n\nThanks for joining! Rate from 1 to 5 stars.`,
      ),
    ),
  );

  const hasRating = (rating ?? 0) > 0;
  const hasComment = !!(comment && comment.trim());

  if (state === 'partial') {
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
    if (hasRating && !hasComment) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          getText('movie_night.dm.partial_rating', { stars: starString(rating!), rating: rating! }, `✅ **تم تسجيل تقييمك:** ${starString(rating!)} **${rating}/5**\n📝 اكتب مراجعتك بالزر أدناه.`),
        ),
      );
    } else if (hasComment && !hasRating) {
      container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(getText('movie_night.dm.partial_comment', {}, '✅ **تم تسجيل مراجعتك.**\n⭐ قيّم الفيلم من القائمة أدناه.')),
      );
    }
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(getText('movie_night.dm.footer', { botName: config.botName }, `-# ${config.botName} · Movie Night`)),
  );

  return { container, files, hasComment, hasRating };
}

// ============================================================
// DM components
// ============================================================
function buildDmComponents(sessionId: number, hasRating: boolean, hasComment: boolean): ActionRowBuilder<any>[] {
  const rows: ActionRowBuilder<any>[] = [];

  if (!hasRating) {
    const opts = [1, 2, 3, 4, 5].map((n) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${'★'.repeat(n)}${'☆'.repeat(5 - n)} — ${n} / 5`)
        .setValue(String(n))
        .setDescription(n === 5 ? 'ممتاز!' : n === 4 ? 'جيد جدًا' : n === 3 ? 'جيد' : n === 2 ? 'مقبول' : 'سيء'),
    );
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`movie:unified:stars:${sessionId}`)
      .setPlaceholder(getText('movie_night.dm.select_placeholder', {}, '⭐ اختر تقييمك (1-5)'))
      .setMinValues(1).setMaxValues(1)
      .addOptions(opts);
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }

  if (!hasComment) {
    const btn = new ButtonBuilder()
      .setCustomId(`movie:unified:comment:${sessionId}`)
      .setLabel(getText('movie_night.dm.comment_button', {}, '✍️ اكتب مراجعتك'))
      .setStyle(ButtonStyle.Secondary);
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(btn));
  }

  return rows;
}

// ============================================================
// refreshUserDM
// ============================================================
async function refreshUserDM(sessionId: number, userId: string): Promise<void> {
  const c = botClient;
  if (!c) return;
  const botUserId = c.user?.id;
  if (!botUserId) return;

  const session = await getMovieSession(sessionId);
  if (!session) return;
  if (!isV2Available()) return;

  try {
    const user = await c.users.fetch(userId).catch(() => null);
    if (!user) return;

    const rating = await getMovieRatingFull(sessionId, userId);
    const hasRating = (rating?.rating ?? 0) > 0;
    const hasComment = !!(rating?.comment && rating.comment_posted);

    const dmChannel = await user.createDM().catch(() => null);
    if (!dmChannel) return;
    const messages = await dmChannel.messages.fetch({ limit: 20 }).catch(() => null);
    if (!messages) return;
    const botMsg = messages.find((m: Message) => m.author.id === botUserId && m.components.length > 0);
    if (!botMsg) return;

    const allDone = hasRating;

    if (allDone) {
      const reviewMessageId = await getReviewMessageId(sessionId, userId);
      const threadId = session.thread_id;
      const reviewUrl = (threadId && reviewMessageId)
        ? `https://discord.com/channels/${config.guildId}/${threadId}/${reviewMessageId}`
        : null;

      const { container, files } = buildThanksCard(session.movie_name, rating?.rating ?? 0, reviewUrl);
      const payload: any = {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      };
      if (files.length > 0) payload.files = files;
      await botMsg.edit(payload);
    } else {
      const state: 'initial' | 'partial' = hasComment ? 'partial' : 'initial';
      const { container, files } = buildDmStartCard(
        session.movie_name, state, null, rating?.comment ?? null,
      );
      const actionRows = buildDmComponents(sessionId, hasRating, hasComment);
      for (const row of actionRows) container.addActionRowComponents(row as any);

      const payload: any = {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      };
      if (files.length > 0) payload.files = files;
      await botMsg.edit(payload);
    }
  } catch (e) { console.error('[Blade X] ❌ refreshUserDM:', e); }
}

// ============================================================
// Thread starter + summary
// ============================================================
async function ensureMainMessageAndThread(c: Client, sessionId: number): Promise<void> {
  const session = await getMovieSession(sessionId);
  if (!session) return;
  const guild = c.guilds.cache.get(config.guildId);
  if (!guild) return;

  if (session.thread_id && session.summary_message_id) {
    try {
      const t = await guild.channels.fetch(session.thread_id);
      if (t) { await updateSummary(c, sessionId); return; }
    } catch { /* recreate */ }
  }
  if (!session.reviews_channel_id) return;
  const channel = guild.channels.cache.get(session.reviews_channel_id) as TextChannel | undefined;
  if (!channel) return;
  if (!isV2Available()) return;

  try {
    const announceFiles: AttachmentBuilder[] = [];
    let announceImage: string | undefined;
    const askPath = getReviewAskPath();
    if (askPath) {
      announceFiles.push(new AttachmentBuilder(askPath, { name: 'review-ask.png' }));
      announceImage = 'attachment://review-ask.png';
    }

    const announceContainer = buildV2Panel({
      accentColor: getColor('color.movie', 0xe91e63),
      title: getText('movie_night.thread.starter', { movie: session.movie_name }, `🎬 ${session.movie_name}`),
      imageUrl: announceImage,
      footerText: getText('movie_night.thread.footer', { botName: config.botName }, `${config.botName} · Movie Night`),
    });

    const mainMsg = await channel.send({
      ...(buildV2Payload(announceContainer) as any),
      files: announceFiles,
      allowedMentions: { parse: [] },
    });

    const threadName = getText('movie_night.thread.title', { movie: session.movie_name }, "Tonight's Movie Review — {movie}").slice(0, 100);
    const thread = await mainMsg.startThread({
      name: threadName,
      autoArchiveDuration: 60,
      reason: `Movie Night Review for ${session.movie_name}`,
    });

    const summaryContainer = buildV2Panel({
      accentColor: getColor('color.movie', 0xe91e63),
      title: getText('movie_night.thread.summary_title', { movie: session.movie_name }, `🎬 ${session.movie_name}`),
      description: getText('movie_night.thread.waiting', {}, '⏳ في انتظار أول تقييم...'),
      footerText: getText('movie_night.thread.footer', { botName: config.botName }, `${config.botName} · Movie Night`),
    });

    const summary = await thread.send(buildV2Payload(summaryContainer) as any);

    await updateMovieSession(sessionId, { thread_id: thread.id, summary_message_id: summary.id });
    console.log(`[Blade X] ✅ Movie Night: main + thread + panel created`);
  } catch (e) { console.error('[Blade X] ❌ فشل إنشاء Thread:', e); }
}

// ============================================================
// Summary
// ============================================================
async function updateSummary(c: Client, sessionId: number): Promise<void> {
  const session = await getMovieSession(sessionId);
  if (!session?.thread_id || !session.summary_message_id) return;
  const guild = c.guilds.cache.get(config.guildId);
  if (!guild) return;
  if (!isV2Available()) return;

  try {
    const thread = await guild.channels.fetch(session.thread_id) as ThreadChannel;
    const msg = await thread.messages.fetch(session.summary_message_id);
    const stats = await getMovieStatsFull(sessionId);

    const avgText = stats.ratingsCount > 0 ? `**${stats.average.toFixed(2)} / 5**` : '*لا توجد تقييمات بعد.*';
    const avgStars = stats.ratingsCount > 0 ? `\n${starString(stats.average)}` : '';

    const files: AttachmentBuilder[] = [];
    let imageUrl: string | undefined;
    if (stats.ratingsCount > 0) {
      const starPath = starImageForRating(stats.average);
      if (fs.existsSync(starPath)) {
        files.push(new AttachmentBuilder(starPath, { name: 'stars.png' }));
        imageUrl = 'attachment://stars.png';
      }
    }

    const container = buildV2Panel({
      accentColor: getColor('color.movie', 0xe91e63),
      title: getText('movie_night.thread.summary_title', { movie: session.movie_name }, `🎬 ${session.movie_name}`),
      sections: [
        {
          text: getText(
            'movie_night.summary.average',
            { average: `${avgText}${avgStars}` },
            `**⭐ المتوسط:** ${avgText}${avgStars}`,
          ),
        },
      ],
      imageUrl,
      imageDescription: 'Star rating',
      footerText: getText('movie_night.thread.footer', { botName: config.botName }, `${config.botName} · Movie Night`),
    });

    await msg.edit({ ...(buildV2Payload(container) as any), files });
  } catch (e) { console.error('[Blade X] ❌ فشل تحديث الملخص:', e); }
}

// ============================================================
// Review card in thread
// ============================================================
async function postReviewToThread(
  c: Client, sessionId: number, userId: string,
  rating: number, comment: string | null,
): Promise<string | null> {
  const session = await getMovieSession(sessionId);
  if (!session?.thread_id) return null;
  const guild = c.guilds.cache.get(config.guildId);
  if (!guild) return null;

  try {
    const thread = await guild.channels.fetch(session.thread_id) as ThreadChannel;
    const member = await guild.members.fetch(userId).catch(() => null);
    const user = member?.user ?? await c.users.fetch(userId).catch(() => null);
    const avatarUrl = member?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true })
      ?? user?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true })
      ?? '';

    const container = new ContainerBuilder();
    container.setAccentColor(getColor('color.movie', 0xe91e63));

    const mentionSection = new SectionBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`# <@${userId}>`),
    );
    if (avatarUrl) {
      try {
        mentionSection.setThumbnailAccessory(
          new ThumbnailBuilder().setURL(avatarUrl).setDescription('Reviewer'),
        );
      } catch { /* ignore */ }
    }
    container.addSectionComponents(mentionSection);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        getText('movie_night.review.rating', { stars: starString(rating), rating }, `${starString(rating)} — **${rating}/5**`),
      ),
    );

    if (comment && comment.trim()) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));
      const formatted = formatCommentInlineCode(comment);
      if (formatted) {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(formatted));
      }
    }

    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        getText('movie_night.review.footer', { movie: session.movie_name, botName: config.botName }, `-# ${session.movie_name} · ${config.botName}`),
      ),
    );

    const sent = await thread.send({
      components: [container],
      flags: MessageFlags.IsComponentsV2,
      allowedMentions: { parse: [] },
    } as any);

    return sent.id;
  } catch (e) {
    console.error('[Blade X] ❌ فشل نشر المراجعة:', e);
    return null;
  }
}

// ============================================================
// startMovieSession
// ============================================================
export async function startMovieSession(
  client: Client, movieName: string, createdBy: string,
): Promise<{ sessionId: number; sent: number; failed: number; total: number } | { error: string }> {
  await cleanupOldMovieDrafts();

  const voiceChannelId = getSetting('movie_voice_channel_id');
  const reviewsChannelId = getSetting('movie_reviews_channel_id');
  if (!voiceChannelId) return { error: getText('movie_night.error.no_voice_channel', {}, '❌ قناة السينما الصوتية غير مضبوطة.') };
  if (!reviewsChannelId) return { error: getText('movie_night.error.no_reviews_channel', {}, '❌ قناة المراجعات النصية غير مضبوطة.') };

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return { error: getText('movie_night.error.no_guild', {}, '❌ السيرفر غير موجود.') };
  const voiceChannel = guild.channels.cache.get(voiceChannelId);
  if (!voiceChannel) return { error: getText('movie_night.error.voice_channel_missing', {}, '❌ قناة السينما غير موجودة.') };
  if (voiceChannel.type !== ChannelType.GuildVoice && voiceChannel.type !== ChannelType.GuildStageVoice) {
    return { error: getText('movie_night.error.not_voice_channel', {}, '❌ القناة المحددة ليست قناة صوتية.') };
  }
  const members = [...voiceChannel.members.values()].filter(m => !m.user.bot);
  if (members.length === 0) return { error: getText('movie_night.error.no_members', {}, '⚠️ لا يوجد أعضاء في قناة السينما.') };
  const active = await getActiveMovieSession();
  if (active) return { error: getText('movie_night.error.active_session_exists', { movie: active.movie_name }, `⚠️ توجد جلسة مفتوحة بالفعل: **${active.movie_name}**.`) };

  const sessionId = await createMovieSession(movieName, voiceChannelId, reviewsChannelId, createdBy);
  await ensureMainMessageAndThread(client, sessionId);

  let sent = 0, failed = 0;
  for (const m of members) {
    try {
      const { container, files } = buildDmStartCard(movieName, 'initial', null, null);
      const actionRows = buildDmComponents(sessionId, false, false);
      for (const row of actionRows) container.addActionRowComponents(row as any);

      const payload: any = {
        components: [container],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
      };
      if (files.length > 0) payload.files = files;

      await m.send(payload);

      await addMovieRecipient(sessionId, m.id, 'sent');
      sent++;
    } catch (e) {
      console.error('[Blade X] ❌ فشل DM:', e);
      await addMovieRecipient(sessionId, m.id, 'failed');
      failed++;
    }
  }
  await logActivity('movie_start', createdBy, `فيلم: ${movieName} — أُرسل لـ ${sent}/${members.length}`);
  return { sessionId, sent, failed, total: members.length };
}

// ============================================================
// Unified draft panel
// ============================================================
async function buildUnifiedPanel(sessionId: number, userId: string): Promise<ContainerBuilder> {
  const draft = await getMovieDraft(userId, sessionId);
  const session = await getMovieSession(sessionId);
  const rating = draft?.rating && draft.rating > 0 ? draft.rating : null;
  const comment = draft?.comment ?? null;
  const movieName = session?.movie_name ?? 'Unknown';

  const container = new ContainerBuilder();
  container.setAccentColor(getColor('color.movie', 0xe91e63));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `# ${getText('movie_night.draft.title', { movie: movieName }, `🎬 ${movieName}`)}`,
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const starsLine = rating
    ? starString(rating)
    : getText('movie_night.draft.no_rating_yet', {}, '— لم تختر بعد —');
  const commentLine = comment
    ? getText('movie_night.draft.comment_line', { comment: comment.slice(0, 200) }, `**💬 تعليقك:** ${comment.slice(0, 200)}`)
    : getText('movie_night.draft.no_comment', {}, '*لا يوجد تعليق.*');

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      getText('movie_night.draft.rating_line', { stars: starsLine, comment_line: commentLine }, `**⭐ تقييمك:** ${starsLine}\n${commentLine}`),
    ),
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      getText('movie_night.draft.helper', {}, 'اختر عدد النجوم، أضف تعليقًا (اختياري)، ثم اضغط **إرسال**.'),
    ),
  );
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const opts = [1, 2, 3, 4, 5].map((n) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(`${'★'.repeat(n)}${'☆'.repeat(5 - n)} — ${n} / 5`)
      .setValue(String(n))
      .setDefault(rating === n),
  );

  const selectPlaceholder = rating
    ? getText('movie_night.draft.select_current', { rating }, `⭐ التقييم الحالي: ${rating}/5`)
    : getText('movie_night.draft.select_prompt', {}, '⭐ اختر تقييمك (1-5)');

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`movie:unified:stars:${sessionId}`)
    .setPlaceholder(selectPlaceholder)
    .setMinValues(1).setMaxValues(1)
    .addOptions(opts);

  const commentBtn = new ButtonBuilder()
    .setCustomId(`movie:unified:comment:${sessionId}`)
    .setLabel(
      comment
        ? getText('movie_night.draft.comment_edit_btn', {}, '💬 تعديل التعليق')
        : getText('movie_night.draft.comment_add_btn', {}, '💬 إضافة تعليق (اختياري)'),
    )
    .setStyle(ButtonStyle.Secondary);

  const submitBtn = new ButtonBuilder()
    .setCustomId(`movie:unified:submit:${sessionId}`)
    .setLabel(getText('movie_night.dm.submit_button', {}, '✅ إرسال التقييم'))
    .setStyle(ButtonStyle.Success)
    .setDisabled(!rating);

  container.addActionRowComponents(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu) as any);
  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(commentBtn, submitBtn) as any);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(getText('movie_night.draft.footer', { botName: config.botName }, `-# ${config.botName} · Movie Night`)),
  );

  return container;
}

async function handleStart(interaction: ButtonInteraction): Promise<void> {
  const sessionId = parseSessionId(interaction.customId);
  const session = await getMovieSession(sessionId);

  if (!session) {
    await interaction.reply({ content: getText('movie_night.error.session_not_found', {}, '❌ الجلسة غير موجودة.'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (session.status !== 'open') {
    await interaction.reply({ content: getText('movie_night.error.session_closed', {}, '🔒 الجلسة أُغلقت.'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!await isMovieRecipient(sessionId, interaction.user.id)) {
    await interaction.reply({ content: getText('movie_night.error.not_recipient', {}, '❌ لست مشاركًا مؤهلًا.'), flags: MessageFlags.Ephemeral });
    return;
  }
  const existing = await getMovieRatingFull(sessionId, interaction.user.id);
  if ((existing?.rating ?? 0) > 0) {
    await interaction.reply({ content: getText('movie_night.error.already_rated', {}, '⚠️ قيّمت هذا الفيلم بالفعل.'), flags: MessageFlags.Ephemeral });
    return;
  }

  await upsertMovieDraft(interaction.user.id, sessionId, {});

  const container = await buildUnifiedPanel(sessionId, interaction.user.id);
  await interaction.reply({
    components: [container],
    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  } as any);
}

async function handleStarsSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const sessionId = parseSessionId(interaction.customId);
  const session = await getMovieSession(sessionId);

  if (!session || session.status !== 'open') {
    await interaction.reply({ content: getText('movie_night.error.session_closed_simple', {}, '🔒 الجلسة مغلقة.'), flags: MessageFlags.Ephemeral });
    return;
  }

  const rating = parseRatingValue(interaction.values[0]);
  if (rating === null) {
    await interaction.reply({ content: getText('movie_night.error.invalid_rating', {}, '❌ قيمة غير صالحة.'), flags: MessageFlags.Ephemeral });
    return;
  }

  await upsertMovieDraft(interaction.user.id, sessionId, { rating });

  const container = await buildUnifiedPanel(sessionId, interaction.user.id);
  await interaction.update({
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  } as any);
}

async function handleCommentButton(interaction: ButtonInteraction): Promise<void> {
  const sessionId = parseSessionId(interaction.customId);
  const session = await getMovieSession(sessionId);

  if (!session || session.status !== 'open') {
    await interaction.reply({ content: getText('movie_night.error.session_closed_simple', {}, '🔒 الجلسة مغلقة.'), flags: MessageFlags.Ephemeral });
    return;
  }

  const draft = await getMovieDraft(interaction.user.id, sessionId);

  const modal = new ModalBuilder()
    .setCustomId(`movie:unified:commentmodal:${sessionId}`)
    .setTitle(getText('movie_night.modal.title', {}, '💬 اكتب تعليقك (اختياري)'));

  const input = new TextInputBuilder()
    .setCustomId('comment')
    .setLabel(getText('movie_night.modal.label', {}, 'تعليقك على الفيلم'))
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(800)
    .setRequired(false)
    .setPlaceholder(getText('movie_night.modal.placeholder', {}, 'اكتب رأيك... (اتركه فارغًا لتخطي التعليق)'))
    .setValue(draft?.comment ?? '');

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

async function handleCommentModal(interaction: any): Promise<void> {
  const sessionId = parseSessionId(interaction.customId);
  const session = await getMovieSession(sessionId);

  if (!session || session.status !== 'open') {
    await interaction.reply({ content: getText('movie_night.error.session_closed_simple', {}, '🔒 الجلسة مغلقة.'), flags: MessageFlags.Ephemeral });
    return;
  }

  const comment = (interaction.fields.getTextInputValue('comment') ?? '').trim().slice(0, 800);
  await upsertMovieDraft(interaction.user.id, sessionId, { comment: comment || null });

  await interaction.reply({
    content: comment
      ? getText('movie_night.success.comment_saved', {}, '✅ تم حفظ التعليق.')
      : getText('movie_night.success.no_comment', {}, 'ℹ️ لم تكتب تعليقًا.'),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSubmit(interaction: ButtonInteraction): Promise<void> {
  const sessionId = parseSessionId(interaction.customId);
  const session = await getMovieSession(sessionId);

  if (!session) {
    await interaction.reply({ content: getText('movie_night.error.session_not_found', {}, '❌ الجلسة غير موجودة.'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (session.status !== 'open') {
    await interaction.reply({ content: getText('movie_night.error.session_closed', {}, '🔒 الجلسة أُغلقت.'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (!await isMovieRecipient(sessionId, interaction.user.id)) {
    await interaction.reply({ content: getText('movie_night.error.not_recipient', {}, '❌ لست مشاركًا مؤهلًا.'), flags: MessageFlags.Ephemeral });
    return;
  }

  const existing = await getMovieRatingFull(sessionId, interaction.user.id);
  if ((existing?.rating ?? 0) > 0) {
    await interaction.reply({ content: getText('movie_night.error.rating_already_submitted', {}, '⚠️ قيّمت الفيلم بالفعل.'), flags: MessageFlags.Ephemeral });
    await deleteMovieDraft(interaction.user.id, sessionId);
    return;
  }

  const draft = await getMovieDraft(interaction.user.id, sessionId);
  if (!draft || draft.rating < 1 || draft.rating > 5) {
    await interaction.reply({ content: getText('movie_night.error.no_rating_selected', {}, '❌ اختر تقييمًا أولًا.'), flags: MessageFlags.Ephemeral });
    return;
  }

  const rating = draft.rating;
  const comment = draft.comment;

  await upsertMovieRating(sessionId, interaction.user.id, rating, comment);
  await logActivity('movie_rating', interaction.user.id, `فيلم ${session.movie_name}: ${rating}/5`);
  await deleteMovieDraft(interaction.user.id, sessionId);

  let reviewMessageId: string | null = null;
  if (botClient) {
    reviewMessageId = await postReviewToThread(botClient, sessionId, interaction.user.id, rating, comment);
    if (reviewMessageId) await setReviewMessageId(sessionId, interaction.user.id, reviewMessageId);
  }

  const threadId = session.thread_id;
  const reviewUrl = (threadId && reviewMessageId)
    ? `https://discord.com/channels/${config.guildId}/${threadId}/${reviewMessageId}`
    : null;

  const { container, files } = buildThanksCard(session.movie_name, rating, reviewUrl);

  console.log(`[Blade X][movie] ✅ handleSubmit: files=${files.length} hasImage=${files.length > 0}`);

  const updatePayload: any = {
    components: [container],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  };
  if (files.length > 0) updatePayload.files = files;

  try {
    await interaction.update(updatePayload);
    console.log('[Blade X][movie] ✅ interaction.update succeeded with image');
  } catch (e) {
    console.error('[Blade X][movie] ❌ interaction.update failed:', e);
    await interaction.followUp({
      content: getText('movie_night.success.image_fallback', {}, '✅ تم استلام تقييمك، لكن تعذّر عرض الصورة.'),
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  if (botClient) {
    await updateSummary(botClient, sessionId);
  }
}

// ============================================================
// Close session
// ============================================================
export async function closeMovieSession(sessionId: number): Promise<boolean> {
  const session = await getMovieSession(sessionId);
  if (!session || session.status !== 'open') return false;

  await updateMovieSession(sessionId, { status: 'closed', closed_at: Date.now() });
  await logActivity('movie_close', null, `فيلم: ${session.movie_name} أُغلق`);

  const c = botClient;
  if (c) {
    const guild = c.guilds.cache.get(config.guildId);
    if (guild) {
      if (session.thread_id) {
        try {
          const thread = await guild.channels.fetch(session.thread_id) as ThreadChannel;
          if (thread) {
            await thread.setLocked(true, 'Movie Night session closed');
            await thread.setArchived(true, 'Movie Night session closed');
          }
        } catch (e) { console.error('[Blade X] ❌ فشل قفل Thread:', e); }
      }

      if (!session.separator_sent && session.reviews_channel_id) {
        try {
          const ch = guild.channels.cache.get(session.reviews_channel_id) as TextChannel | undefined;
          if (ch) {
            const linePath = resolveAsset('assets/line.png');
            if (linePath) {
              const att = new AttachmentBuilder(linePath, { name: 'line.png' });
              await ch.send({ files: [att], allowedMentions: { parse: [] } });
              await updateMovieSession(sessionId, { separator_sent: 1 });
            }
          }
        } catch (e) { console.error('[Blade X] ❌ فشل إرسال الفاصل:', e); }
      }
    }
  }
  return true;
}

// ============================================================
// Thread comment listener
// ============================================================
export function registerThreadCommentListener(c: Client): void {
  c.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (!message.channel.isThread()) return;
    const session = await getActiveMovieSession();
    if (!session) return;
    if (message.channel.id !== session.thread_id) return;
    if (!await isMovieRecipient(session.id, message.author.id)) return;
    const rating = await getMovieRatingFull(session.id, message.author.id);
    if (rating?.comment && rating.comment_posted) return;
    if ((rating?.rating ?? 0) > 0) return;

    const content = message.content.trim().slice(0, 800);
    if (!content) return;
    await setCommentOnly(session.id, message.author.id, content);
    await logActivity('movie_comment', message.author.id, session.movie_name);
    try { await message.react(getEmoji('success', '✅')); } catch { /* ignore */ }
    await updateSummary(c, session.id);
    await refreshUserDM(session.id, message.author.id);
  });
}

// ============================================================
// Register
// ============================================================
export function registerMovieNight(c: Client): void {
  botClient = c;
  c.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isButton()) {
        const id = interaction.customId;
        if (id.startsWith('movie:unified:start:')) { await handleStart(interaction); return; }
        if (id.startsWith('movie:unified:comment:')) { await handleCommentButton(interaction); return; }
        if (id.startsWith('movie:unified:submit:')) { await handleSubmit(interaction); return; }
      }
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('movie:unified:stars:')) {
        await handleStarsSelect(interaction); return;
      }
      if (interaction.isModalSubmit() && interaction.customId.startsWith('movie:unified:commentmodal:')) {
        await handleCommentModal(interaction); return;
      }
    } catch (e) {
      console.error('[Blade X] ❌ movie error:', e);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: getText('movie_night.error.generic', {}, '❌ حدث خطأ.'), flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });
  registerThreadCommentListener(c);
  console.log('[Blade X] ✅ Movie Night Review registered');
}