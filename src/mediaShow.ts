import {
  Client, Events, Message, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, TextChannel, MessageFlags,
  Interaction, ButtonInteraction, AttachmentBuilder,
  PermissionFlagsBits, Guild, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  MediaGalleryBuilder, MediaGalleryItemBuilder, SeparatorBuilder,
  EmbedBuilder, UserSelectMenuBuilder, UserSelectMenuInteraction,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import db, {
  getMediaChannel, isMediaChannel, getMediaPostBySource,
  getMediaPostById, reserveMediaPost, updateMediaPostDisplay,
  updateMediaPostThread, deleteMediaPost, updateMediaPostSeparator,
  updateMediaPostMediaUrl,
  addMediaReaction, removeMediaReaction, hasMediaReaction, getMediaReactionCount,
  getMediaReactionUsers, getUserMediaPosts, insertMediaFile, getMediaFiles,
  deleteMediaFilesForPost, logActivity,
  getSetting, getSettingNumber,
  type MediaPost, type MediaChannel, type MediaFileRow,
} from './database.js';
import {
  saveMediaBuffer, readMediaFile, deleteMediaForPost, fileExists,
  cleanupMediaStorage, getStorageUsage, type RetentionPolicy,
} from './mediaStorage.js';
import { buildV2Payload, isV2Available } from './ui/v2.js';

// ============================================================
// Logging
// ============================================================
type LogLevel = 'info' | 'warn' | 'error';
function log(level: LogLevel, op: string, ctx: Record<string, unknown> = {}, err?: unknown): void {
  const ctxStr = Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).slice(0, 150)}`)
    .join(' ');
  const msg = `[Blade X][media] [${op}] ${ctxStr}`.trim();
  if (level === 'error') console.error(msg, err ?? '');
  else if (level === 'warn') console.warn(msg, err ?? '');
  else console.log(msg);
}

const MAX_ATTACHMENTS = 10;
// ✅ رُفع من 24MB إلى 100MB (Discord Tier 3 max). الخوادم ذات المستوى الأقل
// سترفض الرفع تلقائيًا في مرحلة الإرسال، وتُبقي رسالة المصدر سليمة.
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_USER_CONTENT = 1900;
const THREAD_ARCHIVE_MINUTES = 60;
const LINE_IMAGE_PATH = path.resolve(process.cwd(), 'assets', 'line.png');

const DEFAULT_EMOJI = {
  author: '🎃', reaction: '🎃', comment: '💬', delete: '🗑️', viewall: '👥',
  share: '📤', confirm: '✅', cancel: '❌',
  openPost: '🎃', prev: '◀️', next: '▶️',
} as const;

// ============================================================
// Share session storage
// ============================================================
interface ShareSession {
  postId: number;
  ownerId: string;
  recipients: Set<string>;
  createdAt: number;
}
const shareSessions = new Map<string, ShareSession>();

setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of shareSessions) {
    if (s.createdAt < cutoff) {
      shareSessions.delete(id);
      log('info', 'share_session_cleaned', { sessionId: id, postId: s.postId });
    }
  }
}, 5 * 60_000);

function generateShareSessionId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ============================================================
// Emoji handling
// ============================================================
type ParsedEmoji =
  | { kind: 'unicode'; unicode: string }
  | { kind: 'custom'; id: string; name: string; animated: boolean };

const emojiResolutionCache = new Map<string, ParsedEmoji | null>();
const emojiWarningsLogged = new Set<string>();

export function invalidateMediaEmojiCache(): void {
  emojiResolutionCache.clear();
  emojiWarningsLogged.clear();
}

function warnOnceOnce(key: string, op: string, ctx: Record<string, unknown> = {}): void {
  if (emojiWarningsLogged.has(key)) return;
  emojiWarningsLogged.add(key);
  log('warn', op, ctx);
}

function isSingleEmoji(str: string): boolean {
  if (!str) return false;
  const trimmed = str.trim();
  if (!trimmed) return false;
  if (trimmed.length > 40) return false;
  if (/^[\x00-\x7F]+$/.test(trimmed)) return false;
  try {
    const IntlAny = Intl as any;
    if (IntlAny?.Segmenter) {
      const seg = new IntlAny.Segmenter('en', { granularity: 'grapheme' });
      const segments = Array.from(seg.segment(trimmed), (s: any) => s.segment);
      if (segments.length !== 1) return false;
    } else {
      if (Array.from(trimmed).length > 12) return false;
    }
  } catch {
    if (trimmed.length > 24) return false;
  }
  const hasPictographic = /\p{Extended_Pictographic}/u.test(trimmed);
  const hasRegional = /[\u{1F1E6}-\u{1F1FF}]/u.test(trimmed);
  const hasSymbol = /[\u{2600}-\u{27BF}]/u.test(trimmed);
  return hasPictographic || hasRegional || hasSymbol;
}

async function resolveCustomEmojiById(
  client: Client | null, guild: Guild | null, id: string,
): Promise<{ id: string; name: string; animated: boolean } | null> {
  const cached = guild?.emojis.cache.get(id);
  if (cached) return { id: cached.id, name: cached.name ?? 'emoji', animated: cached.animated ?? false };
  if (guild) {
    try {
      const fetched = await guild.emojis.fetch(id);
      if (fetched) return { id: fetched.id, name: fetched.name ?? 'emoji', animated: fetched.animated ?? false };
    } catch { /* not found */ }
  }
  if (client?.application) {
    const appEmoji = client.application.emojis.cache.get(id);
    if (appEmoji) return { id: appEmoji.id, name: appEmoji.name ?? 'emoji', animated: appEmoji.animated ?? false };
    try {
      const fetched = await client.application.emojis.fetch(id);
      if (fetched) return { id: fetched.id, name: fetched.name ?? 'emoji', animated: fetched.animated ?? false };
    } catch { /* not found */ }
  }
  return null;
}

async function parseEmojiInputAsync(
  client: Client | null, guild: Guild | null,
  input: string | null | undefined, logKey?: string,
): Promise<ParsedEmoji | null> {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const customMatch = raw.match(/^<(a?):([A-Za-z0-9_]+):(\d{17,20})>$/);
  if (customMatch) {
    return { kind: 'custom', animated: customMatch[1] === 'a', name: customMatch[2], id: customMatch[3] };
  }
  if (/^\d{17,20}$/.test(raw)) {
    const resolved = await resolveCustomEmojiById(client, guild, raw);
    if (resolved) return { kind: 'custom', ...resolved };
    if (logKey) warnOnceOnce(`snowflake:${logKey}:${raw}`, 'emoji_snowflake_missing', { key: logKey, id: raw });
    return null;
  }
  const truncatedMatch = raw.match(/^<(a?):([A-Za-z0-9_]+)(?::\d{0,16})?$/);
  if (truncatedMatch && guild) {
    const name = truncatedMatch[2];
    const byName = guild.emojis.cache.find(e => e.name === name);
    if (byName) {
      warnOnceOnce(`repaired:${logKey}:${name}`, 'emoji_truncated_repaired', { key: logKey, name });
      return { kind: 'custom', id: byName.id, name: byName.name ?? 'emoji', animated: byName.animated ?? false };
    }
  }
  if (isSingleEmoji(raw)) return { kind: 'unicode', unicode: raw };
  if (logKey) {
    warnOnceOnce(`invalid:${logKey}:${raw.slice(0, 40)}`, 'emoji_invalid_format',
      { key: logKey, preview: raw.slice(0, 60), fullLength: raw.length });
  }
  return null;
}

async function resolveEmojiCached(
  client: Client | null, guild: Guild | null,
  raw: string | null | undefined, logKey?: string,
): Promise<ParsedEmoji | null> {
  const cacheKey = `${logKey ?? 'x'}:${raw ?? ''}`;
  if (emojiResolutionCache.has(cacheKey)) return emojiResolutionCache.get(cacheKey) ?? null;
  const parsed = await parseEmojiInputAsync(client, guild, raw, logKey);
  emojiResolutionCache.set(cacheKey, parsed);
  return parsed;
}

async function applyButtonEmoji(
  btn: ButtonBuilder, client: Client | null, guild: Guild | null,
  customValue: string | null | undefined, defaultEmoji: string, logKey?: string,
): Promise<void> {
  const parsed = await resolveEmojiCached(client, guild, customValue, logKey);
  if (parsed) {
    try {
      if (parsed.kind === 'custom') btn.setEmoji({ id: parsed.id, name: parsed.name, animated: parsed.animated });
      else btn.setEmoji(parsed.unicode);
      return;
    } catch (e) { log('warn', 'emoji_apply_failed', { key: logKey }, e); }
  }
  try { btn.setEmoji(defaultEmoji); } catch { /* ignore */ }
}

async function resolveEmojiTextAsync(
  client: Client | null, guild: Guild | null,
  raw: string | null | undefined, logKey?: string,
): Promise<string> {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  if (/^<a?:[A-Za-z0-9_]+:\d{17,20}>$/.test(trimmed)) return trimmed;
  const parsed = await resolveEmojiCached(client, guild, trimmed, logKey);
  if (parsed) {
    if (parsed.kind === 'custom') return `<${parsed.animated ? 'a' : ''}:${parsed.name}:${parsed.id}>`;
    return parsed.unicode;
  }
  return '';
}

// ============================================================
// Archive helpers
// ============================================================
const archiveUrlCache = new Map<string, { url: string; expiresAt: number }>();
const ARCHIVE_URL_CACHE_MS = 30 * 60_000;

async function fetchArchiveAttachmentUrl(
  guild: Guild | null, channelId: string, messageId: string,
  attachmentId: string | null, fileName: string,
): Promise<string | null> {
  const cacheKey = `${messageId}:${attachmentId ?? fileName}`;
  const cached = archiveUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  if (!guild) return null;
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !ch.isTextBased() || ch.isDMBased()) return null;
  try {
    const msg = await (ch as TextChannel).messages.fetch(messageId);
    let att = attachmentId ? msg.attachments.get(attachmentId) : undefined;
    if (!att) att = msg.attachments.find(a => a.name === fileName) ?? msg.attachments.first() ?? undefined;
    if (!att) return null;
    archiveUrlCache.set(cacheKey, { url: att.url, expiresAt: Date.now() + ARCHIVE_URL_CACHE_MS });
    return att.url;
  } catch (e) {
    log('warn', 'archive_fetch_failed', { channelId, messageId }, e);
    return null;
  }
}

async function uploadToArchive(
  archiveChannel: TextChannel, buffer: Buffer, fileName: string,
): Promise<{ channelId: string; messageId: string; attachmentId: string; url: string } | null> {
  try {
    const msg = await archiveChannel.send({
      files: [new AttachmentBuilder(buffer, { name: fileName })],
      allowedMentions: { parse: [] },
    });
    const att = msg.attachments.first();
    if (!att) { log('error', 'archive_no_attachment_returned', { msgId: msg.id }); return null; }
    return { channelId: archiveChannel.id, messageId: msg.id, attachmentId: att.id, url: att.url };
  } catch (e) {
    log('error', 'archive_upload_failed', { fileName }, e);
    return null;
  }
}

function getArchiveChannel(guild: Guild, client: Client): TextChannel | null {
  const channelId = getSetting('media_archive_channel_id');
  if (!channelId) return null;
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !ch.isTextBased() || ch.isDMBased()) {
    log('error', 'archive_channel_invalid', { channelId });
    return null;
  }
  const me = guild.members.me ?? client.user;
  if (!me) return null;
  const perms = (ch as TextChannel).permissionsFor(me);
  const missing: string[] = [];
  if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push('ViewChannel');
  if (!perms?.has(PermissionFlagsBits.SendMessages)) missing.push('SendMessages');
  if (!perms?.has(PermissionFlagsBits.AttachFiles)) missing.push('AttachFiles');
  if (!perms?.has(PermissionFlagsBits.ReadMessageHistory)) missing.push('ReadMessageHistory');
  if (missing.length > 0) { log('error', 'archive_channel_perms_missing', { channelId, missing: missing.join(',') }); return null; }
  return ch as TextChannel;
}

// ============================================================
// Media helpers
// ============================================================
// ✅ تحسين التصنيف: يعتمد على MIME أولاً، ثم الامتداد كبديل عند غياب
// MIME أو كونه عامًّا (octet-stream). لا يُصنّف أي ملف غير صورة/فيديو
// كوسائط، ولا يقبل صيغًا خطيرة (PDF/ZIP/نصوص) حتى لو كان امتدادها
// يشبه اسم صورة أو فيديو.
function isSupportedMedia(att: { contentType: string | null; url: string; size: number; name: string }): {
  type: 'image' | 'video' | null;
} {
  const ct = (att.contentType ?? '').toLowerCase().split(';')[0].trim();
  const name = att.name.toLowerCase();

  if (ct.startsWith('image/')) return { type: 'image' };
  if (ct.startsWith('video/')) return { type: 'video' };
  if (ct.startsWith('audio/')) return { type: null };

  const genericMimes = new Set(['application/octet-stream', 'binary/octet-stream', '']);
  if (ct && !genericMimes.has(ct)) return { type: null };

  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp|avif)$/i.test(name)) return { type: 'image' };
  if (/\.(mp4|webm|mov|m4v|mkv)$/i.test(name)) return { type: 'video' };

  return { type: null };
}

function sanitizeFileName(name: string, type: 'image' | 'video'): string {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  const validExt = type === 'video'
    ? (['mp4', 'webm', 'mov', 'm4v'].includes(ext) ? ext : 'mp4')
    : (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png');
  const base = name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'media';
  return `${base}.${validExt}`;
}

async function fetchAttachment(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) { log('warn', 'attachment_http_error', { status: res.status }); return null; }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    log('error', 'attachment_fetch_failed', {}, e);
    return null;
  }
}

function extractMentionIds(content: string): string[] {
  const ids: string[] = [];
  const re = /<@!?(\d{17,20})>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

function stripMentions(content: string): string {
  return content.replace(/<@!?\d{17,20}>/g, '').replace(/[ \t]+/g, ' ').trim();
}

function formatUserContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return '';
  const capped = trimmed.length > MAX_USER_CONTENT ? trimmed.slice(0, MAX_USER_CONTENT) + '…' : trimmed;
  const backtickRuns = capped.match(/`+/g) ?? [];
  const maxRun = backtickRuns.reduce((m, s) => Math.max(m, s.length), 0);
  if (capped.includes('\n')) {
    const fenceLen = Math.max(3, maxRun + 1);
    const fence = '`'.repeat(fenceLen);
    return `# ${fence}\n${capped}\n${fence}`;
  }
  const fenceLen = Math.max(1, maxRun + 1);
  const fence = '`'.repeat(fenceLen);
  const padded = capped.startsWith('`') || capped.endsWith('`') ? ` ${capped} ` : capped;
  return `# ${fence}${padded}${fence}`;
}

async function buildAuthorTitle(
  client: Client | null, guild: Guild | null,
  channel: MediaChannel, userMention: string,
): Promise<string> {
  const template = (channel.title_format ?? '').trim() || '{user}';
  const idsInTemplate = template.match(/(?<!\d)(\d{17,20})(?!\d)/g) ?? [];
  let title = template;
  for (const id of idsInTemplate) {
    const resolved = await resolveEmojiTextAsync(client, guild, id, 'title_emoji');
    title = title.replace(id, resolved || '');
  }
  title = title.replace(/\{user\}/g, userMention);
  const authorEmojiRaw = (channel.author_emoji ?? '').trim();
  if (authorEmojiRaw) {
    const resolved = await resolveEmojiTextAsync(client, guild, authorEmojiRaw, 'author_emoji');
    const finalEmoji = resolved || (/^\d{17,20}$/.test(authorEmojiRaw) ? '' : authorEmojiRaw);
    if (finalEmoji) {
      title = title.replace(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})+\s*/u, '');
      title = `${finalEmoji} ${title}`.trim();
    }
  }
  return title.trim() || userMention;
}

async function getAuthorPostCount(authorId: string, channelId: string): Promise<number> {
  try {
    const posts = await getUserMediaPosts(authorId, 500);
    return posts.filter((p) => p.display_channel_id === channelId).length;
  } catch { return 0; }
}

async function buildReactorsLine(
  client: Client | null, guild: Guild | null,
  post: MediaPost, channel: MediaChannel, count: number,
): Promise<string> {
  if (count === 0) return 'لا يوجد متفاعلون بعد';
  const userIds = await getMediaReactionUsers(post.id, 10);
  if (userIds.length === 0) return 'لا يوجد متفاعلون بعد';
  const emoji = (await resolveEmojiTextAsync(client, guild, channel.reaction_emoji, 'reaction_emoji')) || DEFAULT_EMOJI.reaction;
  const label = channel.footer_from_label || 'Pumpkins from';
  const shown = userIds.slice(0, 3).map((id) => `<@${id}>`).join(', ');
  const extra = Math.max(0, count - 3);
  const othersLabel = channel.footer_others_label || 'and {n} others';
  const extraText = extra > 0 ? ` ${othersLabel.replace('{n}', String(extra))}` : '';
  return `${emoji} **${label}** ${shown}${extraText}`;
}

interface GalleryItem { url: string; description: string; }

// ============================================================
// Main action row
// ============================================================
async function buildMainActionRow(
  client: Client | null, post: MediaPost, channel: MediaChannel,
  reactionCount: number, guild: Guild | null, threadId: string | null,
): Promise<ActionRowBuilder<ButtonBuilder>> {
  const reactBtn = new ButtonBuilder()
    .setCustomId(`media:react:${post.id}`)
    .setLabel(String(reactionCount))
    .setStyle(ButtonStyle.Secondary);
  await applyButtonEmoji(reactBtn, client, guild, channel.reaction_emoji, DEFAULT_EMOJI.reaction, 'reaction_emoji');

  const actualThreadId = threadId ?? post.thread_id;
  const commentBtn = actualThreadId
    ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${post.guild_id}/${actualThreadId}`)
    : new ButtonBuilder().setCustomId(`media:comment:${post.id}`).setStyle(ButtonStyle.Secondary).setDisabled(true);
  await applyButtonEmoji(commentBtn, client, guild, channel.comment_emoji, DEFAULT_EMOJI.comment, 'comment_emoji');

  const shareBtn = new ButtonBuilder()
    .setCustomId(`media:share:${post.id}`)
    .setStyle(ButtonStyle.Secondary);
  await applyButtonEmoji(shareBtn, client, guild, channel.share_emoji, DEFAULT_EMOJI.share, 'share_emoji');

  const deleteBtn = new ButtonBuilder()
    .setCustomId(`media:delete:${post.id}`)
    .setStyle(ButtonStyle.Danger);
  await applyButtonEmoji(deleteBtn, client, guild, channel.delete_emoji, DEFAULT_EMOJI.delete, 'delete_emoji');

  return new ActionRowBuilder<ButtonBuilder>().addComponents(reactBtn, commentBtn, shareBtn, deleteBtn);
}

async function buildPostContainer(
  client: Client | null, post: MediaPost, channel: MediaChannel,
  guild: Guild | null, authorMention: string, authorAvatarUrl: string,
  galleryItems: GalleryItem[], reactionCount: number,
  userContent: string | null, mentionsLine: string | null, threadId: string | null,
): Promise<ContainerBuilder> {
  const container = new ContainerBuilder();
  let accent = 0xf59e0b;
  try {
    accent = parseInt((channel.color || '#f59e0b').replace('#', ''), 16);
    if (!Number.isFinite(accent)) accent = 0xf59e0b;
  } catch { /* default */ }
  container.setAccentColor(accent);

  const authorTitle = await buildAuthorTitle(client, guild, channel, authorMention);
  const headerSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${authorTitle}`),
  );
  if (authorAvatarUrl) {
    try { headerSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(authorAvatarUrl).setDescription('Avatar')); }
    catch (e) { log('warn', 'header_thumbnail_failed', {}, e); }
  }
  container.addSectionComponents(headerSection);

  if (userContent && userContent.trim()) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(userContent));
  }
  if (mentionsLine && mentionsLine.trim()) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(mentionsLine));
  }
  if (galleryItems.length > 0) {
    try {
      const gallery = new MediaGalleryBuilder();
      for (const item of galleryItems.slice(0, MAX_ATTACHMENTS)) {
        gallery.addItems(new MediaGalleryItemBuilder().setURL(item.url).setDescription(item.description.slice(0, 1024)));
      }
      container.addMediaGalleryComponents(gallery);
    } catch (e) { log('error', 'media_gallery_build_failed', { items: galleryItems.length }, e); }
  }
  try {
    const row = await buildMainActionRow(client, post, channel, reactionCount, guild, threadId);
    container.addActionRowComponents(row);
  } catch (e) { log('error', 'action_row_failed', {}, e); }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const reactorsLine = await buildReactorsLine(client, guild, post, channel, reactionCount);
  const postCount = post.source_author_id ? await getAuthorPostCount(post.source_author_id, post.display_channel_id) : 0;
  const timeAgo = `<t:${Math.floor(post.created_at / 1000)}:R>`;
  const footerText = `${reactorsLine}\n-# ${postCount} posts · ${timeAgo}`;

  const viewAllBtn = new ButtonBuilder()
    .setCustomId(`media:viewall:${post.id}`)
    .setLabel(channel.button_view_all_label || 'View All')
    .setStyle(ButtonStyle.Secondary);
  await applyButtonEmoji(viewAllBtn, client, guild, channel.viewall_emoji, DEFAULT_EMOJI.viewall, 'viewall_emoji');

  const footerSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(footerText),
  );
  try {
    footerSection.setButtonAccessory(viewAllBtn);
    container.addSectionComponents(footerSection);
  } catch (e) {
    log('warn', 'footer_button_accessory_failed', {}, e);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText));
    container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(viewAllBtn));
  }
  return container;
}

async function getMediaForPost(post: MediaPost, guild: Guild | null): Promise<{
  items: GalleryItem[]; files: AttachmentBuilder[]; source: string;
}> {
  const items: GalleryItem[] = [];
  const files: AttachmentBuilder[] = [];
  let usedArchive = false;
  let usedDisk = false;

  let dbFiles: MediaFileRow[] = [];
  try { dbFiles = await getMediaFiles(post.id); }
  catch (e) { log('warn', 'media_files_read_failed', { postId: post.id }, e); }

  const archiveRows = dbFiles.filter(f => f.storage_source === 'archive' && f.archive_channel_id && f.archive_message_id);
  const diskRows = dbFiles.filter(f => f.storage_source !== 'archive' && f.file_path && f.file_path.length > 0);

  for (const row of archiveRows) {
    const url = await fetchArchiveAttachmentUrl(guild, row.archive_channel_id!, row.archive_message_id!, row.archive_attachment_id, row.file_name);
    if (url) {
      items.push({ url, description: row.media_type === 'video' ? 'Video' : 'Image' });
      usedArchive = true;
    } else {
      log('warn', 'archive_attachment_unavailable', { postId: post.id, messageId: row.archive_message_id, fileName: row.file_name });
    }
  }
  for (const row of diskRows) {
    if (!fileExists(row.file_path)) continue;
    const buf = readMediaFile(row.file_path);
    if (!buf || buf.length === 0) continue;
    try {
      files.push(new AttachmentBuilder(buf, { name: row.file_name }));
      items.push({ url: `attachment://${row.file_name}`, description: row.media_type === 'video' ? 'Video' : 'Image' });
      usedDisk = true;
    } catch { /* skip */ }
  }
  if (items.length > 0) {
    const source = usedArchive && !usedDisk ? 'archive' : (usedDisk && !usedArchive ? 'legacy_disk_fallback' : 'archive+legacy_disk');
    log('info', 'viewall_media_source_found', { postId: post.id, source, count: items.length, files: files.length });
    return { items, files, source };
  }
  if (post.media_url && /^https?:\/\//.test(post.media_url)) {
    log('info', 'viewall_media_source_found', { postId: post.id, source: 'cdn_url' });
    return { items: [{ url: post.media_url, description: post.media_type === 'video' ? 'Video' : 'Image' }], files: [], source: 'cdn_url' };
  }
  if (guild) {
    try {
      const ch = guild.channels.cache.get(post.display_channel_id) as TextChannel | undefined;
      if (ch) {
        const msg = await ch.messages.fetch(post.display_message_id).catch(() => null);
        if (msg) {
          const legacy: GalleryItem[] = [];
          for (const att of msg.attachments.values()) {
            if (!att.url || !/^https?:\/\//.test(att.url)) continue;
            const ct = (att.contentType ?? '').toLowerCase();
            const name = (att.name ?? '').toLowerCase();
            const isVideo = ct.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(name);
            legacy.push({ url: att.url, description: isVideo ? 'Video' : 'Image' });
          }
          if (legacy.length > 0) {
            log('info', 'viewall_media_source_found', { postId: post.id, source: 'legacy_msg', count: legacy.length });
            return { items: legacy, files: [], source: 'legacy_msg' };
          }
        }
      }
    } catch (e) { log('warn', 'viewall_legacy_fetch_failed', { postId: post.id }, e); }
  }
  log('warn', 'viewall_media_source_missing', { postId: post.id, media_url: post.media_url });
  return { items: [], files: [], source: 'none' };
}

async function sendLineSeparator(textChannel: TextChannel): Promise<Message | null> {
  try {
    if (!fs.existsSync(LINE_IMAGE_PATH)) {
      log('warn', 'line_image_missing', { path: LINE_IMAGE_PATH });
      return null;
    }
    const att = new AttachmentBuilder(LINE_IMAGE_PATH, { name: 'line.png' });
    const msg = await textChannel.send({ files: [att], allowedMentions: { parse: [] } });
    log('info', 'line_separator_sent', { messageId: msg.id });
    return msg;
  } catch (e) {
    log('error', 'line_separator_failed', {}, e);
    return null;
  }
}

// ============================================================
// Share UI — Components V2 Container (selector)
// ============================================================
interface ShareUiOpts {
  channel: MediaChannel;
  sessionId: string;
  postId: number;
  selectedCount: number;
}

async function buildShareContainer(
  client: Client | null, guild: Guild | null, opts: ShareUiOpts,
): Promise<ContainerBuilder> {
  const { channel, sessionId, postId, selectedCount } = opts;

  const titleEmoji = (await resolveEmojiTextAsync(client, guild, channel.share_title_emoji, 'share_title_emoji')) || DEFAULT_EMOJI.share;
  const confirmEmoji = (await resolveEmojiTextAsync(client, guild, channel.share_confirm_emoji, 'share_confirm_emoji')) || DEFAULT_EMOJI.confirm;
  const cancelEmoji = (await resolveEmojiTextAsync(client, guild, channel.share_cancel_emoji, 'share_cancel_emoji')) || DEFAULT_EMOJI.cancel;

  const title = channel.share_title || 'مشاركة المنشور';
  const hint = channel.share_hint || 'اختر المستلمين ثم اضغط تأكيد.';
  const placeholder = channel.share_select_placeholder || 'اختر مستلمًا أو أكثر...';
  const confirmLabel = channel.share_confirm_label || 'تأكيد الإرسال';
  const cancelLabel = channel.share_cancel_label || 'إلغاء';

  let accent = 0xf59e0b;
  try {
    accent = parseInt((channel.share_color || '#f59e0b').replace('#', ''), 16);
    if (!Number.isFinite(accent)) accent = 0xf59e0b;
  } catch { /* default */ }

  const container = new ContainerBuilder();
  container.setAccentColor(accent);

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${titleEmoji} **${title}**`),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(hint),
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const selectPlaceholder = selectedCount > 0
    ? `${placeholder} (محدد: ${selectedCount})`
    : placeholder;

  const select = new UserSelectMenuBuilder()
    .setCustomId(`media:sharepick:${postId}:${sessionId}`)
    .setPlaceholder(selectPlaceholder.slice(0, 150))
    .setMinValues(1)
    .setMaxValues(5);

  container.addActionRowComponents(new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(select));

  const confirmBtn = new ButtonBuilder()
    .setCustomId(`media:sharego:${postId}:${sessionId}`)
    .setLabel(selectedCount > 0 ? `${confirmLabel} (${selectedCount})` : confirmLabel)
    .setStyle(ButtonStyle.Success);
  try {
    if (/^<a?:\w+:\d+>$/.test(confirmEmoji)) {
      const m = confirmEmoji.match(/^<(a?):(\w+):(\d+)>$/);
      if (m) confirmBtn.setEmoji({ name: m[2], id: m[3], animated: m[1] === 'a' });
    } else confirmBtn.setEmoji(confirmEmoji);
  } catch { /* ignore */ }
  if (selectedCount === 0) confirmBtn.setDisabled(true);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`media:shareno:${postId}:${sessionId}`)
    .setLabel(cancelLabel)
    .setStyle(ButtonStyle.Secondary);
  try {
    if (/^<a?:\w+:\d+>$/.test(cancelEmoji)) {
      const m = cancelEmoji.match(/^<(a?):(\w+):(\d+)>$/);
      if (m) cancelBtn.setEmoji({ name: m[2], id: m[3], animated: m[1] === 'a' });
    } else cancelBtn.setEmoji(cancelEmoji);
  } catch { /* ignore */ }

  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(cancelBtn, confirmBtn));

  return container;
}

async function handleShareButton(interaction: ButtonInteraction, post: MediaPost, channelCfg: MediaChannel): Promise<void> {
  const sessionId = generateShareSessionId();
  shareSessions.set(sessionId, {
    postId: post.id,
    ownerId: interaction.user.id,
    recipients: new Set(),
    createdAt: Date.now(),
  });

  const guild = interaction.guild;
  const container = await buildShareContainer(interaction.client, guild, {
    channel: channelCfg,
    sessionId,
    postId: post.id,
    selectedCount: 0,
  });

  const payload = buildV2Payload(container);
  await interaction.reply({
    ...(payload as any),
    flags: payload.flags | MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
  log('info', 'share_ui_opened', { postId: post.id, sessionId, userId: interaction.user.id });
}

async function handleSharePick(
  interaction: UserSelectMenuInteraction,
  postId: number,
  sessionId: string,
): Promise<void> {
  const session = shareSessions.get(sessionId);
  if (!session || session.ownerId !== interaction.user.id) {
    log('warn', 'share_session_expired', { postId, sessionId, userId: interaction.user.id });
    await interaction.reply({ content: '❌ انتهت صلاحية الجلسة.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  log('info', 'share_select_received', {
    postId, sessionId, userId: interaction.user.id, count: interaction.values.length,
  });

  const post = await getMediaPostById(postId);
  if (!post) {
    await interaction.reply({ content: '❌ المنشور غير موجود.', flags: MessageFlags.Ephemeral });
    return;
  }
  const channelCfg = await getMediaChannel(post.display_channel_id);
  if (!channelCfg) {
    await interaction.reply({ content: '❌ القناة غير مهيأة.', flags: MessageFlags.Ephemeral });
    return;
  }

  session.recipients = new Set(interaction.values);
  log('info', 'share_recipients_saved', { postId, sessionId, count: session.recipients.size });

  const container = await buildShareContainer(interaction.client, interaction.guild, {
    channel: channelCfg,
    sessionId,
    postId,
    selectedCount: session.recipients.size,
  });

  const payload = buildV2Payload(container);
  await interaction.update({
    ...(payload as any),
    allowedMentions: { parse: [] },
  });
}

// ============================================================
// DM Container with sharer section
// ============================================================
async function buildShareDmContainer(
  client: Client | null,
  guild: Guild | null,
  post: MediaPost,
  channel: MediaChannel,
  galleryItems: GalleryItem[],
  sharerId: string,
): Promise<ContainerBuilder> {
  const authorMention = `<@${post.source_author_id}>`;
  const sharerMention = `<@${sharerId}>`;

  const member = guild ? await guild.members.fetch(post.source_author_id).catch(() => null) : null;
  const authorAvatarUrl = member?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true }) ?? '';

  let accent = 0xf59e0b;
  try {
    accent = parseInt((channel.color || '#f59e0b').replace('#', ''), 16);
    if (!Number.isFinite(accent)) accent = 0xf59e0b;
  } catch { /* default */ }

  const container = new ContainerBuilder();
  container.setAccentColor(accent);

  const sharerEmojiRaw = (channel.share_title_emoji ?? '').trim();
  const sharerEmoji = sharerEmojiRaw
    ? (await resolveEmojiTextAsync(client, guild, sharerEmojiRaw, 'share_title_emoji')) || DEFAULT_EMOJI.share
    : DEFAULT_EMOJI.share;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${sharerEmoji} ${sharerMention}`),
  );

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const authorTitle = await buildAuthorTitle(client, guild, channel, authorMention);
  const headerSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${authorTitle}`),
  );
  if (authorAvatarUrl) {
    try { headerSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(authorAvatarUrl).setDescription('Avatar')); }
    catch { /* ignore */ }
  }
  container.addSectionComponents(headerSection);

  if (post.content_snapshot && post.content_snapshot.trim()) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(post.content_snapshot));
  }

  if (galleryItems.length > 0) {
    try {
      const gallery = new MediaGalleryBuilder();
      for (const item of galleryItems.slice(0, MAX_ATTACHMENTS)) {
        gallery.addItems(new MediaGalleryItemBuilder().setURL(item.url).setDescription(item.description.slice(0, 1024)));
      }
      container.addMediaGalleryComponents(gallery);
    } catch (e) { log('warn', 'share_dm_gallery_failed', { postId: post.id }, e); }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const linkBtn = new ButtonBuilder()
    .setLabel(channel.button_open_post_label || 'افتح المنشور الأصلي')
    .setStyle(ButtonStyle.Link)
    .setURL(`https://discord.com/channels/${post.guild_id}/${post.source_channel_id}/${post.source_message_id}`);
  await applyButtonEmoji(linkBtn, client, guild, channel.button_open_post_emoji, DEFAULT_EMOJI.openPost, 'button_open_post_emoji');

  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(linkBtn));

  const dmNote = (channel.share_dm_title || '').trim() || '📤 تمت مشاركة هذا المنشور';
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`-# ${dmNote}`),
  );

  return container;
}

async function handleShareConfirm(
  interaction: ButtonInteraction,
  postId: number,
  sessionId: string,
): Promise<void> {
  log('info', 'share_confirm_clicked', { postId, sessionId, userId: interaction.user.id });

  const session = shareSessions.get(sessionId);
  if (!session || session.ownerId !== interaction.user.id) {
    log('warn', 'share_session_expired', { postId, sessionId, userId: interaction.user.id });
    await interaction.reply({ content: '❌ انتهت صلاحية الجلسة.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  if (session.recipients.size === 0) {
    await interaction.reply({ content: '⚠️ لم تختر مستلمين.', flags: MessageFlags.Ephemeral });
    return;
  }

  const post = await getMediaPostById(postId);
  if (!post) {
    await interaction.reply({ content: '❌ المنشور غير موجود.', flags: MessageFlags.Ephemeral });
    return;
  }
  const channelCfg = await getMediaChannel(post.display_channel_id);
  if (!channelCfg) {
    await interaction.reply({ content: '❌ القناة غير مهيأة.', flags: MessageFlags.Ephemeral });
    return;
  }

  shareSessions.delete(sessionId);
  await interaction.deferUpdate().catch(() => {});

  const sharerId = interaction.user.id;
  log('info', 'share_send_started', { postId, sessionId, total: session.recipients.size, sharerId });

  const guild = interaction.guild;

  const shareMedia: { name: string; buffer: Buffer; type: 'image' | 'video' }[] = [];
  try {
    const rows = await getMediaFiles(post.id);
    for (const row of rows) {
      if (row.storage_source === 'archive' && row.archive_channel_id && row.archive_message_id) {
        try {
          const ch = guild?.channels.cache.get(row.archive_channel_id) as TextChannel | undefined;
          if (!ch) continue;
          const msg = await ch.messages.fetch(row.archive_message_id).catch(() => null);
          if (!msg) continue;
          let att = row.archive_attachment_id ? msg.attachments.get(row.archive_attachment_id) : undefined;
          if (!att) att = msg.attachments.find(a => a.name === row.file_name) ?? msg.attachments.first() ?? undefined;
          if (!att) continue;
          const res = await fetch(att.url);
          if (!res.ok) { log('warn', 'share_fetch_archive_http_error', { postId, status: res.status }); continue; }
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length === 0) continue;
          shareMedia.push({ name: row.file_name, buffer: buf, type: row.media_type });
        } catch (e) {
          log('warn', 'share_fetch_archive_failed', { postId, fileName: row.file_name }, e);
        }
      } else if (row.file_path && fileExists(row.file_path)) {
        const buf = readMediaFile(row.file_path);
        if (buf && buf.length > 0) {
          shareMedia.push({ name: row.file_name, buffer: buf, type: row.media_type });
        }
      }
    }
  } catch (e) {
    log('error', 'share_media_extraction_failed', { postId }, e);
  }

  const hasContent = !!(post.content_snapshot && post.content_snapshot.trim());
  if (shareMedia.length === 0 && !hasContent) {
    log('warn', 'share_no_content', { postId });
    const errContainer = new ContainerBuilder();
    errContainer.setAccentColor(0xed4245);
    errContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ لا يمكن مشاركة هذا المنشور — لا محتوى ولا وسائط.'));
    await interaction.editReply({ ...(buildV2Payload(errContainer) as any), allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  const usedNames = new Set<string>();
  const dedupedMedia = shareMedia.map(m => {
    let name = m.name;
    let i = 1;
    while (usedNames.has(name)) {
      const dotIdx = name.lastIndexOf('.');
      const base = dotIdx > 0 ? name.slice(0, dotIdx) : name;
      const ext = dotIdx > 0 ? name.slice(dotIdx) : '';
      name = `${base}_${i}${ext}`;
      i++;
    }
    usedNames.add(name);
    return { ...m, name };
  });

  const galleryItems: GalleryItem[] = dedupedMedia.map(m => ({
    url: `attachment://${m.name}`,
    description: m.type === 'video' ? 'Video' : 'Image',
  }));

  let dmContainer: ContainerBuilder;
  try {
    dmContainer = await buildShareDmContainer(
      interaction.client, guild, post, channelCfg, galleryItems, sharerId,
    );
  } catch (e) {
    log('error', 'share_dm_container_failed', { postId }, e);
    const errContainer = new ContainerBuilder();
    errContainer.setAccentColor(0xed4245);
    errContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent('❌ تعذّر بناء المنشور للمشاركة.'));
    await interaction.editReply({ ...(buildV2Payload(errContainer) as any), allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  let success = 0;
  const failed: string[] = [];

  for (const recipientId of session.recipients) {
    try {
      const user = await interaction.client.users.fetch(recipientId).catch(() => null);
      if (!user) {
        failed.push(`<@${recipientId}>`);
        log('warn', 'share_recipient_failed', { postId, recipientId, reason: 'fetch_failed' });
        continue;
      }

      const files = dedupedMedia.map(m => new AttachmentBuilder(m.buffer, { name: m.name }));

      const payload: any = {
        ...(buildV2Payload(dmContainer) as any),
        files: files.length > 0 ? files : undefined,
        allowedMentions: { parse: [] },
      };

      await user.send(payload);
      success++;
      log('info', 'share_recipient_sent', { postId, recipientId });
    } catch (e: any) {
      failed.push(`<@${recipientId}>`);
      log('warn', 'share_recipient_failed', { postId, recipientId, reason: e?.code ?? e?.message ?? 'unknown' });
    }
    await new Promise(r => setTimeout(r, 150));
  }

  const total = session.recipients.size;
  const successMsg = channelCfg.share_success_msg || '✅ تم الإرسال';
  const partialMsg = channelCfg.share_partial_msg || '⚠️ تعذّر إرسال إلى بعض المستلمين';

  const lines: string[] = [];
  if (success === total) {
    lines.push(`${successMsg}: **${success} / ${total}**`);
  } else if (success > 0) {
    lines.push(`${successMsg}: **${success} / ${total}**`);
    lines.push(`${partialMsg}: ${failed.join('، ')}`);
  } else {
    lines.push(`❌ ${partialMsg}`);
    if (failed.length > 0) lines.push(failed.join('، '));
  }

  const resultContainer = new ContainerBuilder();
  resultContainer.setAccentColor(
    success === total ? 0x57f287 : success > 0 ? 0xf59e0b : 0xed4245,
  );
  resultContainer.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));

  await interaction.editReply({
    ...(buildV2Payload(resultContainer) as any),
    allowedMentions: { parse: [] },
  }).catch((e) => log('warn', 'share_edit_reply_failed', { postId }, e));

  log('info', 'share_send_completed', { postId, sessionId, total, success, failed: failed.length, sharerId });
}

async function handleShareCancel(
  interaction: ButtonInteraction,
  sessionId: string,
  postId: number,
): Promise<void> {
  shareSessions.delete(sessionId);
  log('info', 'share_cancelled', { postId, sessionId, userId: interaction.user.id });

  const cancelContainer = new ContainerBuilder();
  cancelContainer.setAccentColor(0xed4245);
  cancelContainer.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('❌ تم إلغاء المشاركة.'),
  );

  await interaction.update({
    ...(buildV2Payload(cancelContainer) as any),
    allowedMentions: { parse: [] },
  }).catch((e) => log('warn', 'share_cancel_update_failed', { postId, sessionId }, e));
}

// ============================================================
// Main handler
// ============================================================
async function handleMediaMessage(client: Client, message: Message): Promise<void> {
  const tStart = Date.now();
  if (!message.guild) return;
  const guildId = message.guild.id;
  const guildRef = message.guild;

  if (!await isMediaChannel(message.channelId)) return;
  const channelCfg = await getMediaChannel(message.channelId);
  if (!channelCfg) return;
  if (channelCfg.ignore_bots && message.author.bot) return;

  const ch = message.channel;
  if (!ch.isTextBased() || ch.isDMBased() || !('send' in ch)) return;
  const textChannel = ch as TextChannel;

  if (await getMediaPostBySource(message.id)) return;

  const attachments = [...message.attachments.values()];

  // ✅ تشخيص مفصّل للمرفقات
  if (attachments.length > 0) {
    log('info', 'message_media_detect', {
      messageId: message.id,
      count: attachments.length,
      details: attachments
        .map((a) => `${a.name}|${a.contentType ?? 'null'}|${a.size}`)
        .join(', ')
        .slice(0, 800),
    });
  }

  const supported: { att: (typeof attachments)[0]; type: 'image' | 'video' }[] = [];
  for (const att of attachments) {
    const kind = isSupportedMedia({ contentType: att.contentType ?? null, url: att.url, size: att.size, name: att.name });
    if (kind.type) supported.push({ att, type: kind.type });
  }

  if (supported.length === 0) {
    if (message.author.bot) return;
    if (message.system) return;
    if (attachments.length > 0) {
      // ✅ رسالة تحتوي مرفقات غير مدعومة — لا تُصنّف كنص خالص، ولا تُحذف
      log('info', 'unsupported_attachments_kept', {
        messageId: message.id,
        count: attachments.length,
        names: attachments.map(a => a.name).join(',').slice(0, 200),
      });
      return;
    }
    const hasMediaUrl = /https?:\/\/\S+\.(png|jpe?g|gif|webp|mp4|webm|mov|m4v)(\?\S*)?/i.test(message.content);
    if (hasMediaUrl) return;

    const me = guildRef.members.me;
    const canDelete = me && textChannel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages);
    if (!canDelete) { log('warn', 'text_only_delete_no_perms', { messageId: message.id }); return; }
    try {
      await message.delete();
      log('info', 'text_only_message_deleted', { messageId: message.id });
    } catch (e) {
      log('warn', 'text_only_delete_failed', { messageId: message.id }, e);
    }
    return;
  }

  if (!isV2Available()) { log('error', 'v2_unavailable', {}); return; }

  const archiveChannel = getArchiveChannel(guildRef, client);
  if (getSetting('media_archive_channel_id') && !archiveChannel) {
    log('error', 'archive_configured_but_unavailable', {});
    log('warn', 'archive_fallback_to_disk', { reason: 'archive_unavailable' });
  }

  const authorMention = `<@${message.author.id}>`;
  const authorAvatarUrl = message.author.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true });
  const mentionIds = extractMentionIds(message.content);
  const strippedContent = stripMentions(message.content);
  const userContent = formatUserContent(strippedContent);
  const mentionsLine = mentionIds.length > 0 ? mentionIds.map((id) => `<@${id}>`).join(' ') : null;
  const allowedMentions = mentionIds.length > 0 ? { parse: [] as any[], users: mentionIds } : { parse: [] as any[] };

  let postId: number;
  try {
    postId = await reserveMediaPost({
      guild_id: guildId,
      source_channel_id: message.channelId,
      source_message_id: message.id,
      source_author_id: message.author.id,
      display_message_id: '',
      display_channel_id: message.channelId,
      thread_id: null,
      media_url: null,
      media_type: supported[0]?.type ?? null,
      content_snapshot: userContent || null,
      created_at: Date.now(),
    });
    log('info', 'post_db_reserved', { postId });
  } catch (e) {
    log('error', 'post_db_reserve_failed', {}, e);
    return;
  }

  // ✅ فلترة الحجم قبل التنزيل (مع تسجيل الأسباب)
  const maxSlice = supported.slice(0, MAX_ATTACHMENTS);
  const filtered: typeof maxSlice = [];
  let oversizedCount = 0;
  for (const item of maxSlice) {
    if (item.att.size > MAX_FILE_BYTES) {
      oversizedCount++;
      log('warn', 'attachment_oversized', {
        postId,
        name: item.att.name,
        type: item.type,
        size: item.att.size,
        limit: MAX_FILE_BYTES,
      });
      continue;
    }
    filtered.push(item);
  }

  const downloadResults = await Promise.all(
    filtered.map(async (item) => {
      const buffer = await fetchAttachment(item.att.url);
      if (!buffer || buffer.length === 0) {
        log('warn', 'attachment_download_failed', {
          postId,
          name: item.att.name,
          contentType: item.att.contentType,
          type: item.type,
          size: item.att.size,
        });
        return null;
      }
      const safeName = sanitizeFileName(item.att.name, item.type);
      return { item, buffer, safeName };
    }),
  );

  const downloadSuccessCount = downloadResults.filter((r) => r !== null).length;

  const files: AttachmentBuilder[] = [];
  const gallery: GalleryItem[] = [];
  const diskFiles: { name: string; buffer: Buffer; type: 'image' | 'video' }[] = [];
  let archiveUsed = 0;
  let diskUsed = 0;

  for (const r of downloadResults) {
    if (!r) continue;
    if (archiveChannel) {
      const archived = await uploadToArchive(archiveChannel, r.buffer, r.safeName);
      if (archived) {
        await insertMediaFile({
          postId, fileName: r.safeName, filePath: '', mediaType: r.item.type, size: r.buffer.length,
          storageSource: 'archive',
          archiveChannelId: archived.channelId, archiveMessageId: archived.messageId,
          archiveAttachmentId: archived.attachmentId, archiveUrl: archived.url,
        });
        gallery.push({ url: archived.url, description: r.item.type === 'video' ? 'Video' : 'Image' });
        archiveUsed++;
        continue;
      }
      log('warn', 'archive_file_upload_failed_fallback_disk', { postId, fileName: r.safeName });
    }
    const saved = saveMediaBuffer(postId, r.safeName, r.buffer);
    if (saved) {
      await insertMediaFile({
        postId, fileName: saved.fileName, filePath: saved.filePath,
        mediaType: r.item.type, size: saved.size, storageSource: 'disk',
      });
      diskFiles.push({ name: saved.fileName, buffer: r.buffer, type: r.item.type });
      files.push(new AttachmentBuilder(r.buffer, { name: r.safeName }));
      gallery.push({ url: `attachment://${r.safeName}`, description: r.item.type === 'video' ? 'Video' : 'Image' });
      diskUsed++;
    } else {
      log('error', 'disk_save_failed', { postId, fileName: r.safeName, size: r.buffer.length });
    }
  }

  if (gallery.length === 0) {
    log('error', 'no_files_prepared', {
      postId,
      messageId: message.id,
      attachmentCount: attachments.length,
      supportedTypes: supported.map(s => s.type).join(','),
      supportedCount: supported.length,
      filteredCount: filtered.length,
      oversizedCount,
      downloadSuccessCount,
      archiveUsed,
      diskUsed,
    });
    try { await deleteMediaPost(postId); deleteMediaForPost(postId); } catch { /* ignore */ }
    // ✅ رسالة المصدر لا تُحذف — نتركها سليمة للمستخدم
    return;
  }

  log('info', 'media_persistence_success', {
    postId, count: gallery.length, archive: archiveUsed, disk: diskUsed,
  });

  const tempPost: MediaPost = {
    id: postId, guild_id: guildId,
    source_channel_id: message.channelId, source_message_id: message.id,
    source_author_id: message.author.id, display_message_id: '',
    display_channel_id: message.channelId, thread_id: null,
    media_url: null, media_type: supported[0]?.type ?? null,
    content_snapshot: userContent || null, created_at: Date.now(),
  };

  const initialContainer = await buildPostContainer(
    client, tempPost, channelCfg, guildRef,
    authorMention, authorAvatarUrl, gallery, 0,
    userContent || null, mentionsLine, null,
  );

  let displayMsg: Message | null = null;
  let usedCdnFallback = false;
  let activeGallery: GalleryItem[] = gallery;

  try {
    const payload: any = { ...(buildV2Payload(initialContainer) as any), allowedMentions };
    if (files.length > 0) payload.files = files;
    displayMsg = await textChannel.send(payload);
    log('info', 'post_sent', { displayMsgId: displayMsg.id, postId, filesSent: files.length });
  } catch (sendErr: any) {
    // ✅ سبب شائع: حجم الملف يتجاوز حد رفع السيرفر (tier boost)
    log('warn', 'post_send_with_files_failed', {
      postId,
      filesSent: files.length,
      error: sendErr?.message ?? 'unknown',
    });

    // Fallback: استخدام CDN URLs الأصلية من رسالة المصدر (لا رفع ملفات)
    const cdnGallery: GalleryItem[] = [];
    for (const r of downloadResults) {
      if (!r) continue;
      if (r.item.att.url && /^https?:\/\//.test(r.item.att.url)) {
        cdnGallery.push({
          url: r.item.att.url,
          description: r.item.type === 'video' ? 'Video' : 'Image',
        });
      }
    }

    if (cdnGallery.length === 0) {
      log('error', 'post_send_failed_no_fallback', { postId });
      try { await deleteMediaPost(postId); deleteMediaForPost(postId); } catch { /* ignore */ }
      return;
    }

    try {
      const fallbackPost: MediaPost = { ...tempPost, media_url: cdnGallery[0]?.url ?? null };
      const fallbackContainer = await buildPostContainer(
        client, fallbackPost, channelCfg, guildRef,
        authorMention, authorAvatarUrl, cdnGallery, 0,
        userContent || null, mentionsLine, null,
      );
      displayMsg = await textChannel.send({
        ...(buildV2Payload(fallbackContainer) as any),
        allowedMentions,
      });
      usedCdnFallback = true;
      activeGallery = cdnGallery;
      log('info', 'post_sent_via_cdn', {
        postId, cdnCount: cdnGallery.length,
        note: 'CDN URLs تنتهي صلاحيتها تلقائيًا (~24 ساعة)، رسالة المصدر محفوظة',
      });
      await updateMediaPostMediaUrl(postId, cdnGallery[0]?.url ?? null);
    } catch (e2) {
      log('error', 'post_send_fallback_failed', { postId }, e2);
      try { await deleteMediaPost(postId); deleteMediaForPost(postId); } catch { /* ignore */ }
      return;
    }
  }

  await updateMediaPostDisplay(postId, displayMsg.id);

  let threadId: string | null = null;
  try {
    const threadName = (channelCfg.thread_name_format || 'Comments · {user}')
      .replace(/\{user\}/g, message.author.username).slice(0, 100) || `Comments · ${message.author.username}`;
    const thread = await displayMsg.startThread({
      name: threadName,
      autoArchiveDuration: THREAD_ARCHIVE_MINUTES as 60 | 1440 | 4320 | 10080,
      reason: 'Media Show discussion',
    });
    threadId = thread.id;
    await updateMediaPostThread(postId, threadId);
    log('info', 'post_thread_created', { postId, threadId });
  } catch (e) {
    log('warn', 'thread_create_failed', { postId }, e);
  }

  if (threadId) {
    try {
      const updatedPost: MediaPost = { ...tempPost, display_message_id: displayMsg.id, thread_id: threadId };
      const updatedContainer = await buildPostContainer(
        client, updatedPost, channelCfg, guildRef,
        authorMention, authorAvatarUrl, activeGallery, 0,
        userContent || null, mentionsLine, threadId,
      );
      const editFiles = usedCdnFallback ? [] : diskFiles.map((d) => new AttachmentBuilder(d.buffer, { name: d.name }));
      const editPayload: any = { ...(buildV2Payload(updatedContainer) as any), allowedMentions };
      if (editFiles.length > 0) editPayload.files = editFiles;
      await displayMsg.edit(editPayload);
      log('info', 'post_edit_thread_link_done', { postId });
    } catch (e) {
      log('warn', 'post_edit_failed', { postId }, e);
    }
  }

  const separatorMsg = await sendLineSeparator(textChannel);
  if (separatorMsg) {
    try {
      await updateMediaPostSeparator(postId, separatorMsg.channelId, separatorMsg.id);
    } catch (e) {
      log('warn', 'separator_db_update_failed', { postId }, e);
    }
  }

  // ✅ حذف رسالة المصدر فقط عند النجاح الكامل بدون CDN fallback
  // (في CDN fallback: نحتفظ بالمصدر لأن الرابط قد ينتهي)
  if (!usedCdnFallback) {
    try {
      const me = guildRef.members.me;
      const canDelete = me && textChannel.permissionsFor(me)?.has(PermissionFlagsBits.ManageMessages);
      if (canDelete) await message.delete().catch(() => {});
    } catch { /* ignore */ }
  } else {
    log('info', 'source_message_preserved', { postId, reason: 'cdn_fallback' });
  }

  await logActivity('media_post', message.author.id, `${message.channelId}:${message.id}`);
  log('info', 'post_complete', {
    postId, totalMs: Date.now() - tStart, archiveUsed, diskUsed,
    cdnFallback: usedCdnFallback,
    source: usedCdnFallback ? 'cdn_fallback' : (archiveUsed > 0 && diskUsed === 0 ? 'archive' : archiveUsed > 0 ? 'archive+disk' : 'disk'),
  });
}

// ============================================================
// View All
// ============================================================
async function buildViewAllContainer(
  client: Client, post: MediaPost,
): Promise<{ container: ContainerBuilder; files: AttachmentBuilder[] }> {
  const channelCfg = await getMediaChannel(post.display_channel_id);
  const guild = client.guilds.cache.get(post.guild_id);
  const member = guild ? await guild.members.fetch(post.source_author_id).catch(() => null) : null;
  const user = member?.user ?? await client.users.fetch(post.source_author_id).catch(() => null);
  const authorMention = `<@${post.source_author_id}>`;
  const authorAvatarUrl = member?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true })
    ?? user?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true }) ?? '';
  const accent = channelCfg
    ? (() => { try { const n = parseInt(channelCfg.color.replace('#', ''), 16); return Number.isFinite(n) ? n : 0xf59e0b; } catch { return 0xf59e0b; } })()
    : 0xf59e0b;

  const container = new ContainerBuilder();
  container.setAccentColor(accent);
  const authorTitle = channelCfg
    ? await buildAuthorTitle(client, guild ?? null, channelCfg, authorMention)
    : `# ${authorMention}`;
  const headerSection = new SectionBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`# ${authorTitle}`),
  );
  if (authorAvatarUrl) {
    try { headerSection.setThumbnailAccessory(new ThumbnailBuilder().setURL(authorAvatarUrl).setDescription('Avatar')); }
    catch { /* ignore */ }
  }
  container.addSectionComponents(headerSection);

  const userContent = post.content_snapshot ?? '';
  if (userContent && userContent.trim()) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(userContent));
  }

  const { items: galleryItems, files: mediaFiles } = await getMediaForPost(post, guild ?? null);
  if (galleryItems.length > 0) {
    try {
      const gallery = new MediaGalleryBuilder();
      for (const item of galleryItems.slice(0, MAX_ATTACHMENTS)) {
        gallery.addItems(new MediaGalleryItemBuilder().setURL(item.url).setDescription(item.description.slice(0, 1024)));
      }
      container.addMediaGalleryComponents(gallery);
      // ✅ سجل منفصل: عدد عناصر الغاليري (CDN أو attachment) — الفرق عن files عدد طبيعي
      log('info', 'viewall_gallery_built', {
        postId: post.id,
        galleryCount: galleryItems.length,
        attachmentFiles: mediaFiles.length,
      });
    } catch (e) { log('warn', 'viewall_media_failed', { postId: post.id }, e); }
  } else {
    log('warn', 'viewall_no_gallery', { postId: post.id });
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent('*⚠️ الميديا غير متاحة حاليًا*'));
  }
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const reactionCount = await getMediaReactionCount(post.id);
  const reactorsLine = channelCfg
    ? await buildReactorsLine(client, guild ?? null, post, channelCfg, reactionCount)
    : `⭐ **${reactionCount}** reactions`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(reactorsLine));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(1));

  const allPosts = (await getUserMediaPosts(post.source_author_id, 500))
    .filter((p) => p.display_channel_id === post.display_channel_id)
    .sort((a, b) => b.created_at - a.created_at);
  const ids = allPosts.map((p) => p.id);
  const currentIndex = ids.indexOf(post.id);

  const openBtn = new ButtonBuilder()
    .setLabel(channelCfg?.button_open_post_label ?? 'افتح المنشور')
    .setStyle(ButtonStyle.Link)
    .setURL(`https://discord.com/channels/${post.guild_id}/${post.source_channel_id}/${post.source_message_id}`);
  await applyButtonEmoji(openBtn, client, guild ?? null, channelCfg?.button_open_post_emoji, DEFAULT_EMOJI.openPost, 'button_open_post_emoji');

  const prevBtn = new ButtonBuilder()
    .setCustomId(`media:nav:prev:${post.id}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentIndex <= 0);
  const prevLabel = (channelCfg?.viewall_prev_label ?? '').trim();
  if (prevLabel) prevBtn.setLabel(prevLabel.slice(0, 80));
  await applyButtonEmoji(prevBtn, client, guild ?? null, channelCfg?.viewall_prev_emoji, DEFAULT_EMOJI.prev, 'viewall_prev_emoji');

  const nextBtn = new ButtonBuilder()
    .setCustomId(`media:nav:next:${post.id}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentIndex >= ids.length - 1 || currentIndex < 0);
  const nextLabel = (channelCfg?.viewall_next_label ?? '').trim();
  if (nextLabel) nextBtn.setLabel(nextLabel.slice(0, 80));
  await applyButtonEmoji(nextBtn, client, guild ?? null, channelCfg?.viewall_next_emoji, DEFAULT_EMOJI.next, 'viewall_next_emoji');

  const counterBtn = new ButtonBuilder()
    .setCustomId(`media:nav:count:${post.id}`)
    .setLabel(`${currentIndex + 1} / ${Math.max(ids.length, 1)}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  container.addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, openBtn, counterBtn, nextBtn));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${config.botName} · Media Show · <@${post.source_author_id}>`));
  return { container, files: mediaFiles };
}

// ============================================================
// Button handler
// ============================================================
async function handleMediaButton(interaction: ButtonInteraction): Promise<void> {
  const tStart = Date.now();
  const parts = interaction.customId.split(':');
  const action = parts[1];

  let postId: number;
  let sessionId: string | null = null;
  if (action === 'share' || action === 'sharepick' || action === 'sharego' || action === 'shareno') {
    postId = Number(parts[2]);
    if (parts[3]) sessionId = parts[3];
  } else {
    postId = Number(parts[parts.length - 1]);
  }

  log('info', 'media_button_clicked', { customId: interaction.customId, action, postId, userId: interaction.user.id });

  if (!Number.isFinite(postId) || postId <= 0) {
    await interaction.reply({ content: '❌ معرف منشور غير صالح.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const post = await getMediaPostById(postId);
  if (!post) {
    await interaction.reply({ content: '❌ المنشور غير موجود.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const channelCfg = await getMediaChannel(post.display_channel_id);
  if (!channelCfg) {
    await interaction.reply({ content: '❌ القناة غير مهيأة.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const guild = interaction.guild;
  if (!guild) return;

  if (action === 'share') {
    await handleShareButton(interaction, post, channelCfg);
    return;
  }
  if (action === 'sharego' && sessionId) {
    await handleShareConfirm(interaction, postId, sessionId);
    return;
  }
  if (action === 'shareno' && sessionId) {
    await handleShareCancel(interaction, sessionId, postId);
    return;
  }

  if (action === 'react') {
    await interaction.deferUpdate().catch(() => {});
    let count = 0;
    let has = false;
    try {
      has = await hasMediaReaction(postId, interaction.user.id);
      if (has) await removeMediaReaction(postId, interaction.user.id);
      else await addMediaReaction(postId, interaction.user.id, channelCfg.reaction_emoji);
      count = await getMediaReactionCount(postId);
    } catch (e) { log('error', 'react_db_failed', { postId }, e); return; }
    try {
      const displayCh = guild.channels.cache.get(post.display_channel_id) as TextChannel | undefined;
      if (!displayCh) return;
      const displayMsg = await displayCh.messages.fetch(post.display_message_id).catch(() => null);
      if (!displayMsg) return;
      const { items: gallery, files, source } = await getMediaForPost(post, guild);
      if (gallery.length === 0) { log('warn', 'react_skip_no_media', { postId }); return; }
      const member = await guild.members.fetch(post.source_author_id).catch(() => null);
      const authorMention = `<@${post.source_author_id}>`;
      const authorAvatarUrl = member?.displayAvatarURL({ size: 256, extension: 'png', forceStatic: true }) ?? '';
      const updatedPost: MediaPost = { ...post, display_message_id: displayMsg.id };
      const container = await buildPostContainer(
        interaction.client, updatedPost, channelCfg, guild, authorMention, authorAvatarUrl,
        gallery, count, post.content_snapshot ?? null, null, post.thread_id,
      );
      const payload: any = { ...buildV2Payload(container), allowedMentions: { parse: [] } };
      if (files.length > 0) payload.files = files;
      await displayMsg.edit(payload);
      log('info', 'react_updated', { postId, count, has, source, totalMs: Date.now() - tStart });
    } catch (e) { log('error', 'react_msg_update_failed', { postId, count }, e); }
    return;
  }

  if (action === 'comment') { await interaction.deferUpdate().catch(() => {}); return; }

  if (action === 'delete') {
    const isOwner = interaction.user.id === post.source_author_id;
    const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages) ?? false;
    const adminAllowed = channelCfg.allow_admin_delete === 1;
    if (!isOwner && !(isAdmin && adminAllowed)) {
      await interaction.reply({ content: '❌ هذا المنشور ليس لك.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    // ✅ أقرّ بالتفاعل مبكرًا قبل عمليات الحذف الطويلة (تجاوز 3s → 10062 Unknown interaction)
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (e) {
      log('warn', 'delete_defer_failed', { postId, error: (e as Error)?.message });
      return;
    }

    let postDeleted = false;
    let threadDeleted = false;
    let separatorDeleted = false;
    let dbCleaned = false;
    const cleanupErrors: string[] = [];

    try {
      const displayCh = guild.channels.cache.get(post.display_channel_id) as TextChannel | undefined;
      if (displayCh) {
        const displayMsg = await displayCh.messages.fetch(post.display_message_id).catch(() => null);
        if (displayMsg) {
          await displayMsg.delete().catch(() => {});
          postDeleted = true;
        }
      }
    } catch (e) {
      cleanupErrors.push('display');
      log('warn', 'delete_display_failed', { postId }, e);
    }

    if (post.thread_id) {
      try {
        const thread = await guild.channels.fetch(post.thread_id).catch(() => null);
        if (thread && thread.isThread()) {
          await thread.delete('Post deleted').catch(() => {});
          threadDeleted = true;
          log('info', 'thread_deleted_cleaned', { threadId: post.thread_id, postId });
        }
      } catch (e) {
        cleanupErrors.push('thread');
        log('warn', 'delete_thread_failed', { postId }, e);
      }
    }

    if (post.separator_message_id && post.separator_channel_id) {
      try {
        const sepCh = guild.channels.cache.get(post.separator_channel_id) as TextChannel | undefined;
        if (sepCh) {
          const sepMsg = await sepCh.messages.fetch(post.separator_message_id).catch(() => null);
          if (sepMsg) {
            await sepMsg.delete().catch(() => {});
            separatorDeleted = true;
            log('info', 'separator_deleted', { postId, separatorMessageId: post.separator_message_id });
          }
        }
      } catch (e) {
        cleanupErrors.push('separator');
        log('warn', 'separator_delete_failed', { postId }, e);
      }
    }

    try {
      await deleteMediaFilesForPost(postId);
      deleteMediaForPost(postId);
      await deleteMediaPost(postId);
      await logActivity('media_delete', interaction.user.id, `${postId}`);
      dbCleaned = true;
    } catch (e) {
      cleanupErrors.push('db');
      log('warn', 'delete_db_failed', { postId }, e);
    }

    // ✅ فصل نتيجة الحذف عن نتيجة الرد
    const parts2: string[] = [];
    if (postDeleted) parts2.push('✅ تم حذف العرض');
    if (threadDeleted) parts2.push('✅ Thread');
    if (separatorDeleted) parts2.push('✅ الفاصل');
    if (dbCleaned) parts2.push('✅ البيانات');
    if (cleanupErrors.length > 0) parts2.push(`⚠️ فشل: ${cleanupErrors.join(', ')}`);

    const summary = parts2.join(' · ') || '⚠️ لم يتم حذف أي مورد.';
    try {
      await interaction.editReply({ content: summary });
    } catch (e) {
      log('warn', 'delete_edit_reply_failed', { postId, error: (e as Error)?.message });
    }
    return;
  }

  if (action === 'viewall') {
    try {
      const { container, files } = await buildViewAllContainer(interaction.client, post);
      const payload = buildV2Payload(container);
      const replyPayload: any = { ...payload, allowedMentions: { parse: [] }, flags: payload.flags | MessageFlags.Ephemeral };
      if (files.length > 0) replyPayload.files = files;
      await interaction.reply(replyPayload);
      log('info', 'viewall_opened', { postId, attachmentFiles: files.length });
    } catch (e: any) {
      log('error', 'viewall_failed', { postId }, e);
      await interaction.reply({ content: `❌ فشل عرض القائمة: ${e?.message ?? 'خطأ'}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  if (action === 'nav') {
    const dir = parts[2];
    if (dir === 'count') { await interaction.deferUpdate().catch(() => {}); return; }
    const sorted = (await getUserMediaPosts(post.source_author_id, 500))
      .filter((p) => p.display_channel_id === post.display_channel_id)
      .sort((a, b) => b.created_at - a.created_at);
    const ids = sorted.map((p) => p.id);
    let idx = ids.indexOf(post.id);
    if (idx < 0) idx = 0;
    if (dir === 'prev') idx = Math.max(0, idx - 1);
    if (dir === 'next') idx = Math.min(ids.length - 1, idx + 1);
    const newPostId = ids[idx];
    if (!newPostId || newPostId === postId) { await interaction.deferUpdate().catch(() => {}); return; }
    const newPost = await getMediaPostById(newPostId);
    if (!newPost) { await interaction.deferUpdate().catch(() => {}); return; }
    try {
      const { container, files } = await buildViewAllContainer(interaction.client, newPost);
      const payload: any = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };
      if (files.length > 0) payload.files = files;
      await interaction.update(payload);
      log('info', 'viewall_message_update_success', { to: newPostId, dir, attachmentFiles: files.length });
    } catch (e: any) {
      log('error', 'viewall_navigation_failed', { postId, dir, newPostId }, e);
      await interaction.deferUpdate().catch(() => {});
    }
    return;
  }

  log('warn', 'media_button_unknown_action', { action, customId: interaction.customId });
  await interaction.deferUpdate().catch(() => {});
}

// ============================================================
// Storage cleanup
// ============================================================
function getRetentionPolicy(): RetentionPolicy & { enabled: boolean } {
  const enabled = getSetting('media_cleanup_enabled') !== 'false';
  const envMaxTotal = parseInt(process.env.MEDIA_MAX_TOTAL_SIZE_MB ?? '', 10);
  const envMaxAge = parseInt(process.env.MEDIA_MAX_AGE_DAYS ?? '', 10);
  const envMaxPosts = parseInt(process.env.MEDIA_MAX_POSTS_KEPT ?? '', 10);
  const maxTotalMB = getSettingNumber('media_max_total_size_mb', Number.isFinite(envMaxTotal) && envMaxTotal > 0 ? envMaxTotal : 1024);
  const maxAgeDays = getSettingNumber('media_max_age_days', Number.isFinite(envMaxAge) && envMaxAge > 0 ? envMaxAge : 30);
  const maxPosts = getSettingNumber('media_max_posts_kept', Number.isFinite(envMaxPosts) && envMaxPosts > 0 ? envMaxPosts : 500);
  return {
    enabled,
    maxTotalBytes: maxTotalMB > 0 ? maxTotalMB * 1024 * 1024 : null,
    maxAgeMs: maxAgeDays > 0 ? maxAgeDays * 86_400_000 : null,
    maxPosts: maxPosts > 0 ? maxPosts : null,
  };
}

let cleanupRunning = false;
function startStorageCleanup(): void {
  const INTERVAL_MS = 5 * 60_000;
  setInterval(() => {
    if (cleanupRunning) return;
    cleanupRunning = true;
    try {
      const policy = getRetentionPolicy();
      if (!policy.enabled) { cleanupRunning = false; return; }
      const result = cleanupMediaStorage(policy);
      if (result.removedPosts > 0) {
        log('info', 'storage_cleanup', { removedPosts: result.removedPosts, removedFiles: result.removedFiles, freedBytes: result.freedBytes, reason: result.reason });
      }
      const usage = getStorageUsage();
      const usageMb = (usage.totalBytes / (1024 * 1024)).toFixed(2);
      const limitMb = policy.maxTotalBytes ? (policy.maxTotalBytes / (1024 * 1024)).toFixed(0) : '∞';
      log('info', 'storage_usage', { diskPosts: usage.postCount, diskFiles: usage.fileCount, diskUsedMb: usageMb, limitMb });
    } catch (e) {
      log('error', 'storage_cleanup_failed', {}, e);
    } finally { cleanupRunning = false; }
  }, INTERVAL_MS);
  setTimeout(() => {
    try {
      const policy = getRetentionPolicy();
      if (policy.enabled) {
        const result = cleanupMediaStorage(policy);
        if (result.removedPosts > 0) log('info', 'storage_cleanup_startup', { removedPosts: result.removedPosts, freedBytes: result.freedBytes });
      }
    } catch (e) { log('warn', 'storage_cleanup_startup_failed', {}, e); }
  }, 30_000);
}

// ============================================================
// Registration
// ============================================================
export function registerMediaShow(client: Client): void {
  if (client.isReady()) {
    void client.guilds.cache.get(config.guildId)?.emojis.fetch().catch(() => {});
    void client.application?.emojis.fetch().catch(() => {});
  } else {
    client.once(Events.ClientReady, () => {
      void client.guilds.cache.get(config.guildId)?.emojis.fetch().catch(() => {});
      void client.application?.emojis.fetch().catch(() => {});
    });
  }

  client.on(Events.MessageCreate, async (message) => {
    try { await handleMediaMessage(client, message); }
    catch (e) { log('error', 'media_message_unhandled', { messageId: message.id }, e); }
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (interaction.isUserSelectMenu() && interaction.customId.startsWith('media:sharepick:')) {
      const parts = interaction.customId.split(':');
      const postId = Number(parts[2]);
      const sessionId = parts[3];
      try { await handleSharePick(interaction, postId, sessionId); }
      catch (e) {
        log('error', 'share_pick_unhandled', { postId, sessionId }, e);
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '❌ حدث خطأ أثناء معالجة الاختيار.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
      return;
    }

    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('media:')) return;
    try { await handleMediaButton(interaction); }
    catch (e) {
      log('error', 'media_button_unhandled', { customId: interaction.customId }, e);
      // ✅ لا نحاول الرد مرة أخرى إذا كان الـ interaction قد تم التعامل معه (10062)
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  client.on(Events.ThreadDelete, (thread) => {
    void (async () => {
      try {
        const r = await db.execute({
          sql: 'SELECT id FROM media_posts WHERE thread_id = ?',
          args: [thread.id],
        });
        const row = r.rows[0];
        if (row) {
          const rowId = Number(row.id);
          await db.execute({
            sql: 'UPDATE media_posts SET thread_id = NULL WHERE id = ?',
            args: [rowId],
          });
          log('info', 'thread_deleted_cleaned', { threadId: thread.id, postId: rowId });
        }
      } catch (e) { log('error', 'thread_delete_cleanup_failed', { threadId: thread.id }, e); }
    })();
  });

  startStorageCleanup();
  log('info', 'registered', { cleanup: 'scheduled', archive: 'enabled', shareUi: 'componentsV2+userSelect', shareDm: 'reconstructedPostWithSharer', viewAllCustomizable: true, noteRemoved: true, resultNoteRemoved: true, videoSupport: 'extended-mime+ext' });
}