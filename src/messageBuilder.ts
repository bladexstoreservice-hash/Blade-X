import {
  Client, TextChannel, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, MessageFlags, ChannelType,
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder,
  SectionBuilder, ThumbnailBuilder, MediaGalleryBuilder, MediaGalleryItemBuilder
} from 'discord.js';
import { config } from './config.js';

export interface BuilderField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface BuilderEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: string;
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
  url?: string;
  custom_id?: string;
}

export interface V2ComponentData {
  id: string;
  type: 'text' | 'separator' | 'section' | 'gallery' | 'link_button';
  content?: string;
  divider?: boolean;
  spacing?: 'small' | 'large';
  accessoryUrl?: string;
  imageUrls?: string;
  label?: string;
  url?: string;
  emoji?: string;
}

export interface BuilderPayload {
  mode?: 'classic' | 'v2';
  content?: string;
  embeds?: BuilderEmbed[];
  buttons?: BuilderButton[];
  v2Components?: V2ComponentData[];
  v2Content?: string;
  v2Color?: string;
  allowedMentions?: { parse?: string[]; roles?: string[]; users?: string[] };
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function validatePayload(payload: BuilderPayload): string | null {
  if (!payload || typeof payload !== 'object') return 'payload مطلوب';

  const mode = payload.mode || 'classic';

  if (mode === 'v2') {
    if (payload.v2Color && !HEX_RE.test(payload.v2Color)) return 'لون طرف الحاوية (Accent Color) غير صالح';
    
    const comps = payload.v2Components || [];
    if (comps.length === 0 && !payload.v2Content?.trim()) return 'الرسالة فارغة: أضف محتوى أو عنصراً واحداً على الأقل';
    if (comps.length > 40) return 'الحد الأقصى للعناصر هو 40 عنصر';
    
    let totalTextLength = (payload.v2Content || '').length;
    for (const c of comps) {
      if (c.type === 'text' && c.content) totalTextLength += c.content.length;
      if (c.type === 'section' && c.content) totalTextLength += c.content.length;
      
      if (c.type === 'link_button') {
        if (!c.url || !/^https?:\/\//i.test(c.url)) return 'زر الرابط يحتاج رابطاً صالحاً يبدأ بـ http/https';
        if (!c.label?.trim() && !c.emoji?.trim()) return 'زر الرابط يحتاج نصاً (Label) أو إيموجي';
      }
    }
    if (totalTextLength > 4000) return 'مجموع النصوص يتجاوز 4000 حرف';
    return null;
  }

  // Classic Validation
  const hasContent = typeof payload.content === 'string' && payload.content.trim().length > 0;
  const hasEmbeds = Array.isArray(payload.embeds) && payload.embeds.length > 0;
  const hasButtons = Array.isArray(payload.buttons) && payload.buttons.some((b) => b && typeof b.label === 'string' && b.label.trim().length > 0);

  if (!hasContent && !hasEmbeds && !hasButtons) {
    return 'الرسالة فارغة: أضف نصًا أو Embed أو زرًا';
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

export function toDiscordPayload(payload: BuilderPayload): any {
  const out: any = { allowedMentions: payload.allowedMentions ?? { parse: [] } };
  const mode = payload.mode || 'classic';

  if (mode === 'v2') {
    // 1. استخراج جميع معرفات المستخدمين والرولات و @everyone / @here
    const mentionRegex = /<@!?(\d{17,20})>/g;
    const roleRegex = /<@&(\d{17,20})>/g;
    const userIds: string[] = [];
    const roleIds: string[] = [];
    let hasEveryone = false;
    let hasHere = false;
    let match;

    const extractMentions = (text: string | undefined) => {
      if (!text) return;
      while ((match = mentionRegex.exec(text)) !== null) userIds.push(match[1]);
      while ((match = roleRegex.exec(text)) !== null) roleIds.push(match[1]);
      if (text.includes('@everyone')) hasEveryone = true;
      if (text.includes('@here')) hasHere = true;
    };

    extractMentions(payload.v2Content);
    for (const c of (payload.v2Components || [])) {
      if (c.content) extractMentions(c.content);
    }

    const isEveryoneExplicitlyAllowed = payload.allowedMentions?.parse?.includes('everyone') ?? false;
    const allowEveryone = isEveryoneExplicitlyAllowed || hasEveryone || hasHere;
    
    // 2. إعداد allowedMentions بشكل دقيق
    out.allowedMentions = {
      parse: allowEveryone ? ['everyone'] : [],
      users: [...new Set(userIds)],
      roles: [...new Set(roleIds)]
    };

    const container = new ContainerBuilder();
    
    if (payload.v2Color && HEX_RE.test(payload.v2Color)) {
      container.setAccentColor(parseInt(payload.v2Color.slice(1), 16) as any);
    }

    let currentRow: ActionRowBuilder<ButtonBuilder> | null = null;

    for (const c of (payload.v2Components || [])) {
      if (c.type === 'text') {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(c.content || ' '));
        currentRow = null;
      } else if (c.type === 'separator') {
        const sep = new SeparatorBuilder();
        sep.setDivider(c.divider !== false);
        sep.setSpacing(c.spacing === 'large' ? 2 : 1);
        container.addSeparatorComponents(sep);
        currentRow = null;
      } else if (c.type === 'section') {
        const sec = new SectionBuilder();
        sec.addTextDisplayComponents(new TextDisplayBuilder().setContent(c.content || ' '));
        if (c.accessoryUrl) {
          try { sec.setThumbnailAccessory(new ThumbnailBuilder().setURL(c.accessoryUrl)); } catch {}
        }
        container.addSectionComponents(sec);
        currentRow = null;
      } else if (c.type === 'gallery' && c.imageUrls) {
        const gallery = new MediaGalleryBuilder();
        const urls = c.imageUrls.split(',').map(u => u.trim()).filter(u => u.startsWith('http'));
        for (const url of urls.slice(0, 10)) {
          gallery.addItems(new MediaGalleryItemBuilder().setURL(url));
        }
        if (gallery.items.length > 0) container.addMediaGalleryComponents(gallery);
        currentRow = null;
      } else if (c.type === 'link_button') {
        if (!currentRow) {
          currentRow = new ActionRowBuilder<ButtonBuilder>();
          container.addActionRowComponents(currentRow);
        }
        const btn = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(c.url || 'https://discord.com');
        if (c.label) btn.setLabel(c.label.slice(0, 80));
        if (c.emoji) {
          if (/^<a?:\w+:\d+>$/.test(c.emoji)) {
            const m = c.emoji.match(/^<a?:(\w+):(\d+)>$/);
            if (m) btn.setEmoji({ name: m[1], id: m[2] });
          } else {
            try { btn.setEmoji(c.emoji); } catch {}
          }
        }
        currentRow.addComponents(btn);
        if (currentRow.components.length >= 5) currentRow = null;
      }
    }
    
    const finalComponents: any[] = [];
    if (payload.v2Content && payload.v2Content.trim()) {
      finalComponents.push(new TextDisplayBuilder().setContent(payload.v2Content));
    }
    finalComponents.push(container);
    
    out.components = finalComponents;
    out.flags = MessageFlags.IsComponentsV2;
    return out;
  }

  // Classic Mode
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
      if (e.fields && e.fields.length > 0) embed.addFields(e.fields.map(f => ({ name: f.name || '—', value: f.value || '—', inline: !!f.inline })));
      return embed;
    });
  }

  if (payload.buttons && payload.buttons.length > 0) {
    const valid = payload.buttons.filter(b => b && typeof b.label === 'string' && b.label.trim().length > 0);
    if (valid.length > 0) {
      const styleMap: Record<BuilderButton['type'], ButtonStyle> = {
        primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary,
        success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link,
      };
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      let row = new ActionRowBuilder<ButtonBuilder>();
      for (const b of valid) {
        const btn = new ButtonBuilder().setLabel(b.label.slice(0, 80)).setStyle(styleMap[b.type] ?? ButtonStyle.Secondary);
        if (b.type === 'link' && b.url) btn.setURL(b.url);
        else btn.setCustomId(b.custom_id || `mb:noop:${Math.random().toString(36).slice(2, 10)}`);
        if (b.emoji) {
          if (/^<a?:\w+:\d+>$/.test(b.emoji)) {
            const m = b.emoji.match(/^<a?:(\w+):(\d+)>$/);
            if (m) btn.setEmoji({ name: m[1], id: m[2] });
          } else {
            try { btn.setEmoji(b.emoji); } catch { }
          }
        }
        row.addComponents(btn);
        if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder<ButtonBuilder>(); }
      }
      if (row.components.length > 0) rows.push(row);
      if (rows.length > 0) out.components = rows;
    }
  }
  return out;
}

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
    const hasAny = (discordPayload.content) || (discordPayload.embeds) || (discordPayload.components);
    
    if (!hasAny) return { ok: false, error: 'الرسالة فارغة' };

    const msg = await textChannel.send(discordPayload);
    return { ok: true, messageId: msg.id, channelId: msg.channelId };
  } catch (e: any) {
    console.error('[Blade X] ❌ sendViaBot:', e);
    return { ok: false, error: e?.message ?? 'Send failed' };
  }
}