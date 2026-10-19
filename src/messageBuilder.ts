import {
  Client, TextChannel, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, MessageFlags, ChannelType,
} from 'discord.js';
import { config } from './config.js';

// ===== الأنواع =====
export interface BuilderField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface BuilderEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: string; // hex
  author?: { name: string; icon_url?: string; url?: string };
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; icon_url?: string };
  timestamp?: boolean;
  fields?: BuilderField[];
}

export interface BuilderButton {
  type: 'primary' | 'secondary' | 'success' | 'danger' | 'link';
  label: string;
  emoji?: string;
  url?: string; // for link buttons
  custom_id?: string; // for non-link
}

export interface BuilderPayload {
  content?: string;
  embeds?: BuilderEmbed[];
  buttons?: BuilderButton[];
  allowedMentions?: { parse?: string[]; roles?: string[]; users?: string[] };
}

// ===== التحقق =====
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Returns null when payload is valid, or a clear Arabic error string otherwise.
 *
 * Important: Discord rejects empty messages with code 50006. We catch this
 * BEFORE calling channel.send() so the dashboard receives an actionable error
 * instead of a Discord API crash. Message is "empty" if it has:
 *   - no non-whitespace content
 *   - no embeds
 *   - no valid buttons (buttons must have at least a non-empty label)
 * Files-only messages are NOT supported by this builder (there's no files field).
 */
export function validatePayload(payload: BuilderPayload): string | null {
  if (!payload || typeof payload !== 'object') return 'payload مطلوب';

  const hasContent =
    typeof payload.content === 'string' && payload.content.trim().length > 0;
  const hasEmbeds =
    Array.isArray(payload.embeds) && payload.embeds.length > 0;
  const hasButtons =
    Array.isArray(payload.buttons) &&
    payload.buttons.some((b) => b && typeof b.label === 'string' && b.label.trim().length > 0);

  if (!hasContent && !hasEmbeds && !hasButtons) {
    return 'الرسالة فارغة: أضف نصًا أو Embed واحدًا على الأقل أو زرًا واحدًا';
  }

  if (payload.content && payload.content.length > 2000) return 'المحتوى يتجاوز 2000 حرف';
  if (payload.embeds) {
    if (payload.embeds.length > 10) return 'لا يمكن إرسال أكثر من 10 Embeds';
    let totalLen = 0;
    for (const e of payload.embeds) {
      if (e.title && e.title.length > 256) return 'عنوان Embed يتجاوز 256 حرف';
      if (e.description && e.description.length > 4096) return 'وصف Embed يتجاوز 4096 حرف';
      if (e.color && !HEX_RE.test(e.color)) return `لون غير صالح: ${e.color}`;
      if (e.fields && e.fields.length > 25) return 'الحقول تتجاوز 25';
      for (const f of e.fields ?? []) {
        if (f.name.length > 256) return 'اسم الحقل يتجاوز 256 حرف';
        if (f.value.length > 1024) return 'قيمة الحقل تتجاوز 1024 حرف';
      }
      if (e.footer && e.footer.text.length > 2048) return 'Footer يتجاوز 2048 حرف';
      if (e.author && e.author.name.length > 256) return 'Author name يتجاوز 256 حرف';
      totalLen += (e.title?.length ?? 0) + (e.description?.length ?? 0);
      totalLen += (e.fields ?? []).reduce((a, f) => a + f.name.length + f.value.length, 0);
    }
    if (totalLen > 6000) return 'مجموع محتوى Embeds يتجاوز 6000 حرف';
  }
  if (payload.buttons) {
    if (payload.buttons.length > 25) return 'لا يمكن إرسال أكثر من 25 زر';
    for (const b of payload.buttons) {
      if (!b.label || b.label.length === 0) return 'كل زر يحتاج label';
      if (b.label.length > 80) return 'label الزر يتجاوز 80 حرف';
      if (b.type === 'link' && !b.url) return 'زر Link يحتاج URL';
      if (b.type === 'link' && b.url && !/^https?:\/\//i.test(b.url)) return 'رابط الزر يجب أن يبدأ بـ http';
    }
  }
  return null;
}

// ===== التحويل إلى كائنات discord.js =====
export function toDiscordPayload(payload: BuilderPayload): any {
  const out: any = {};

  if (payload.content && payload.content.trim()) out.content = payload.content;

  if (payload.embeds && payload.embeds.length > 0) {
    out.embeds = payload.embeds.map(e => {
      const embed = new EmbedBuilder();
      if (e.title) embed.setTitle(e.title);
      if (e.description) embed.setDescription(e.description);
      if (e.url) embed.setURL(e.url);
      if (e.color && HEX_RE.test(e.color)) embed.setColor(parseInt(e.color.slice(1), 16) as any);
      if (e.author?.name) embed.setAuthor({ name: e.author.name, iconURL: e.author.icon_url, url: e.author.url });
      if (e.thumbnail?.url) embed.setThumbnail(e.thumbnail.url);
      if (e.image?.url) embed.setImage(e.image.url);
      if (e.footer?.text) embed.setFooter({ text: e.footer.text, iconURL: e.footer.icon_url });
      if (e.timestamp) embed.setTimestamp();
      if (e.fields && e.fields.length > 0) {
        embed.addFields(e.fields.map(f => ({ name: f.name || '—', value: f.value || '—', inline: !!f.inline })));
      }
      return embed;
    });
  }

  if (payload.buttons && payload.buttons.length > 0) {
    const valid = payload.buttons.filter(b => b && typeof b.label === 'string' && b.label.trim().length > 0);
    if (valid.length > 0) {
      const styleMap: Record<BuilderButton['type'], ButtonStyle> = {
        primary: ButtonStyle.Primary,
        secondary: ButtonStyle.Secondary,
        success: ButtonStyle.Success,
        danger: ButtonStyle.Danger,
        link: ButtonStyle.Link,
      };
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      let row = new ActionRowBuilder<ButtonBuilder>();
      for (const b of valid) {
        const btn = new ButtonBuilder()
          .setLabel(b.label.slice(0, 80))
          .setStyle(styleMap[b.type] ?? ButtonStyle.Secondary);
        if (b.type === 'link' && b.url) btn.setURL(b.url);
        else btn.setCustomId(b.custom_id || `mb:noop:${Math.random().toString(36).slice(2, 10)}`);
        if (b.emoji) {
          if (/^<a?:\w+:\d+>$/.test(b.emoji)) {
            const m = b.emoji.match(/^<a?:(\w+):(\d+)>$/);
            if (m) btn.setEmoji({ name: m[1], id: m[2] });
          } else {
            try { btn.setEmoji(b.emoji); } catch { /* ignore invalid */ }
          }
        }
        row.addComponents(btn);
        if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder<ButtonBuilder>(); }
      }
      if (row.components.length > 0) rows.push(row);
      if (rows.length > 0) out.components = rows;
    }
  }

  out.allowedMentions = payload.allowedMentions ?? { parse: [] };
  return out;
}

// ===== الإرسال الفعلي عبر البوت =====
export async function sendViaBot(
  client: Client,
  channelId: string,
  payload: BuilderPayload
): Promise<{ ok: true; messageId: string; channelId: string } | { ok: false; error: string }> {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return { ok: false, error: 'Guild not found' };

  const channel = guild.channels.cache.get(channelId);
  if (!channel) return { ok: false, error: 'القناة غير موجودة' };
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return { ok: false, error: 'القناة ليست نصية' };
  }

  const textChannel = channel as TextChannel;
  const me = guild.members.me;
  if (!me) return { ok: false, error: 'Bot not in guild' };

  const perms = textChannel.permissionsFor(me);
  if (!perms?.has('SendMessages') || !perms.has('EmbedLinks')) {
    return { ok: false, error: 'البوت لا يملك صلاحيات Send Messages / Embed Links' };
  }

  const validationError = validatePayload(payload);
  if (validationError) return { ok: false, error: validationError };

  try {
    const discordPayload = toDiscordPayload(payload);

    // ✅ Final safety net: never call channel.send() with a payload Discord will reject as empty.
    const hasAny =
      (typeof discordPayload.content === 'string' && discordPayload.content.trim().length > 0) ||
      (Array.isArray(discordPayload.embeds) && discordPayload.embeds.length > 0) ||
      (Array.isArray(discordPayload.components) && discordPayload.components.length > 0);

    if (!hasAny) {
      return {
        ok: false,
        error: 'الرسالة فارغة بعد المعالجة — تحقق من المحتوى/المكونات قبل الإرسال.',
      };
    }

    const msg = await textChannel.send(discordPayload);
    return { ok: true, messageId: msg.id, channelId: msg.channelId };
  } catch (e: any) {
    console.error('[Blade X] ❌ sendViaBot:', e);
    return { ok: false, error: e?.message ?? 'Send failed' };
  }
}