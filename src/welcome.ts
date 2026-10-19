// ============================================================
// Blade X — Welcome System (v5 — Turso)
// ============================================================
import {
  GuildMember, AttachmentBuilder, MessageFlags, ButtonInteraction,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel, Client,
} from 'discord.js';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
import { config } from './config.js';
import {
  getSetting, getWelcomePhrases, getWelcomeButtons, upsertWelcomeButton,
  logActivity, getSettingNumber, getSettingJSON, dbClient,
} from './database.js';
import { getDisplayName, BLADE_COLOR } from './utils.js';
import { T, render } from './texts.js';
import { getEmoji } from './emojiRegistry.js';
import { buildV2Panel, buildV2Payload, isV2Available } from './ui/v2.js';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = path.resolve(process.cwd());
const TEMPLATE_PATH = path.join(PROJECT_ROOT, 'assets', 'welcome.png');
const FONT_PATH = path.join(PROJECT_ROOT, 'assets', 'ArbFONTS-RH-Zak-Bold.otf');

const WELCOME_CUSTOM_EMOJI_ID = '1560403456966004826';

let botClientRef: Client | null = null;
export function setWelcomeClient(c: Client): void { botClientRef = c; }

function getWelcomeEmojiString(): string {
  const c = botClientRef;
  if (c) {
    const guild = c.guilds.cache.get(config.guildId);
    const emoji = guild?.emojis.cache.get(WELCOME_CUSTOM_EMOJI_ID);
    if (emoji) {
      return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
    }
  }
  return getEmoji('welcome', '👋');
}

function stripUnknownVars(text: string): string {
  return text.replace(/\{[a-zA-Z_]\w*\}/g, '');
}

function renderWelcome(template: string, vars: Record<string, string | number>): string {
  return stripUnknownVars(render(template, vars));
}

let fontLoaded = false;
function ensureFont(): void {
  if (fontLoaded) return;
  try {
    if (fs.existsSync(FONT_PATH)) {
      GlobalFonts.registerFromPath(FONT_PATH, 'RH Zak');
      fontLoaded = true;
      console.log('[Blade X] ✅ تم تحميل خط RH Zak');
    } else {
      console.warn('[Blade X] ⚠️ خط RH Zak غير موجود');
    }
  } catch (e) { console.error('[Blade X] ❌ فشل تحميل الخط:', e); }
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function outlineToPixel(strength: number, fontSize: number): number {
  return (strength / 200) * (fontSize * 0.46);
}

// ============================================================
// Hi-images
// ============================================================
function getHiImages(): string[] {
  const result: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const gif = path.join(PROJECT_ROOT, 'assets', `hi${i}.gif`);
    const png = path.join(PROJECT_ROOT, 'assets', `hi${i}.png`);
    if (fs.existsSync(gif)) result.push(gif);
    else if (fs.existsSync(png)) result.push(png);
  }
  return result;
}

function getWelcomeGifs(): string[] {
  const raw = getSetting('welcome_gifs');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u): u is string => typeof u === 'string')
      .map((u) => u.trim())
      .filter((u) => /^https?:\/\//.test(u));
  } catch { return []; }
}

function pickRandomGif(): string | null {
  const gifs = getWelcomeGifs();
  if (gifs.length === 0) return null;
  return gifs[Math.floor(Math.random() * gifs.length)];
}

// ============================================================
// Canvas welcome image
// ============================================================
export async function generateWelcomeImage(member: GuildMember): Promise<AttachmentBuilder | null> {
  ensureFont();
  try {
    if (!fs.existsSync(TEMPLATE_PATH)) {
      console.error('[Blade X] ❌ قالب الترحيب غير موجود:', TEMPLATE_PATH);
      return null;
    }
    const template = await loadImage(TEMPLATE_PATH);
    const canvas = createCanvas(template.width, template.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(template, 0, 0);

    const avatarUrl = member.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true });
    const avatar = await loadImage(avatarUrl);
    const ax = getSettingNumber('welcome_avatar_x', config.welcome.avatarCenterX);
    const ay = getSettingNumber('welcome_avatar_y', config.welcome.avatarCenterY);
    const as = getSettingNumber('welcome_avatar_size', config.welcome.avatarSize);
    const r = as / 2;

    ctx.save();
    ctx.beginPath();
    ctx.arc(ax, ay, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = '#1e2024';
    ctx.fillRect(ax - r, ay - r, as, as);
    ctx.drawImage(avatar, ax - r, ay - r, as, as);
    ctx.restore();

    const showUsername = getSetting('welcome_show_username') !== 'false';

    if (showUsername) {
      const name = getDisplayName(member);
      const nx = getSettingNumber('welcome_name_x', config.welcome.nameStartX);
      const ny = getSettingNumber('welcome_name_y', config.welcome.nameY);
      const baseFontSize = getSettingNumber('welcome_name_size', config.welcome.nameFontSize);
      const fontName = fontLoaded ? '"RH Zak"' : 'sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.direction = 'rtl';

      let fontSize = baseFontSize;
      ctx.font = `${fontSize}px ${fontName}`;
      const maxWidth = template.width - nx - 60;
      while (ctx.measureText(name).width > maxWidth && fontSize > 40) {
        fontSize -= 5;
        ctx.font = `${fontSize}px ${fontName}`;
      }

      const shadow = getSettingJSON('welcome_shadow', {
        directionDeg: config.welcome.shadow.directionDeg,
        offsetPx: config.welcome.shadow.offsetPx,
        blurPx: config.welcome.shadow.blurPx,
        opacity: config.welcome.shadow.opacity,
        color: config.welcome.shadow.color,
      });
      const shadowRad = (shadow.directionDeg * Math.PI) / 180;
      const sox = Math.cos(shadowRad) * shadow.offsetPx;
      const soy = Math.sin(shadowRad) * shadow.offsetPx;

      ctx.save();
      ctx.font = `${fontSize}px ${fontName}`;
      ctx.shadowColor = hexToRgba(shadow.color, shadow.opacity);
      ctx.shadowBlur = shadow.blurPx;
      ctx.shadowOffsetX = sox;
      ctx.shadowOffsetY = soy;
      ctx.fillStyle = '#000000';
      ctx.fillText(name, nx, ny);
      ctx.restore();

      const outlineColor = T('welcome.outline.color', config.welcome.outline.color);
      const outlineStrength = getSettingNumber('welcome_outline_strength', config.welcome.outline.strength);
      const outlinePx = outlineToPixel(outlineStrength, fontSize);

      ctx.save();
      ctx.font = `${fontSize}px ${fontName}`;
      ctx.lineWidth = outlinePx;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outlineColor;
      ctx.strokeText(name, nx, ny);
      ctx.restore();

      ctx.save();
      ctx.font = `${fontSize}px ${fontName}`;
      const grd = ctx.createLinearGradient(nx, ny - fontSize / 2, nx, ny + fontSize / 2);
      grd.addColorStop(0, T('welcome.gradient.from', config.welcome.gradient.from));
      grd.addColorStop(1, T('welcome.gradient.to', config.welcome.gradient.to));
      ctx.fillStyle = grd;
      ctx.fillText(name, nx, ny);
      ctx.restore();
    }

    const buffer = canvas.toBuffer('image/png');
    return new AttachmentBuilder(buffer, { name: 'welcome-generated.png' });
  } catch (e) {
    console.error('[Blade X] ❌ فشل إنشاء صورة الترحيب:', e);
    return null;
  }
}

function pickRandom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

let lastPhrase = '';
async function pickPhrase(): Promise<string> {
  const phrases = await getWelcomePhrases();
  const pool = phrases.length > 0 ? phrases : [...config.defaultWelcomePhrases];
  if (pool.length === 0) return 'Welcome!';
  let c: string; let i = 0;
  do { c = pickRandom(pool); i++; } while (c === lastPhrase && pool.length > 1 && i < 10);
  lastPhrase = c;
  return c;
}

// ============================================================
// Default buttons
// ============================================================
export async function ensureDefaultButtons(): Promise<void> {
  const existing = await getWelcomeButtons();
  if (existing.length > 0) return;
  await upsertWelcomeButton({ button_id: 'welcome', label: '', emoji_id: null, url: null, style: 'Secondary', enabled: 1 });
  await upsertWelcomeButton({ button_id: 'rules', label: '', emoji_id: null, url: config.defaultButtonLinks.rules, style: 'Link', enabled: 1 });
  await upsertWelcomeButton({ button_id: 'roles', label: '', emoji_id: null, url: config.defaultButtonLinks.roles, style: 'Link', enabled: 1 });
  await upsertWelcomeButton({ button_id: 'community', label: '', emoji_id: null, url: config.defaultButtonLinks.community, style: 'Link', enabled: 1 });
}

const DEFAULT_BUTTON_EMOJIS: Record<string, string> = {
  welcome: '👋',
  rules: '📜',
  roles: '🎭',
  community: '💬',
};

export async function buildWelcomeButtons(targetMemberId: string): Promise<ActionRowBuilder<ButtonBuilder>[]> {
  await ensureDefaultButtons();
  const buttons = await getWelcomeButtons();
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let row = new ActionRowBuilder<ButtonBuilder>();

  for (const b of buttons) {
    if (!b.enabled) continue;

    const label = (b.label ?? '').trim();
    const hasLabel = label.length > 0;
    const hasCustomEmoji = !!(b.emoji_id && b.emoji_id.trim().length > 0);

    const btn = new ButtonBuilder();
    if (hasLabel) btn.setLabel(label);

    let emojiWasSet = false;

    if (hasCustomEmoji) {
      try { btn.setEmoji({ id: b.emoji_id! }); emojiWasSet = true; }
      catch {
        if (!hasLabel) {
          const fallback = DEFAULT_BUTTON_EMOJIS[b.button_id] ?? '🔗';
          try { btn.setEmoji(fallback); emojiWasSet = true; } catch { /* ignore */ }
        }
      }
    } else if (!hasLabel) {
      const fallback = DEFAULT_BUTTON_EMOJIS[b.button_id] ?? '🔗';
      try { btn.setEmoji(fallback); emojiWasSet = true; } catch { /* ignore */ }
    }

    if (!hasLabel && !emojiWasSet) continue;

    if (b.button_id === 'welcome') {
      btn.setStyle(ButtonStyle.Secondary).setCustomId(`welcome:sayhi:${targetMemberId}`);
    } else if (b.url) {
      btn.setStyle(ButtonStyle.Link).setURL(b.url);
    } else {
      btn.setStyle(ButtonStyle.Secondary).setCustomId(`welcome:noop:${b.button_id}`);
    }

    row.addComponents(btn);
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder<ButtonBuilder>();
    }
  }

  if (row.components.length > 0) rows.push(row);
  return rows;
}

// ============================================================
// Build welcome text
// ============================================================
interface WelcomeVars {
  user: string;
  username: string;
  displayName: string;
  server: string;
  memberCount: number;
  phrase: string;
  emoji: string;
}

function buildWelcomeVars(member: GuildMember, phrase: string, emoji: string): WelcomeVars {
  return {
    user: `${member}`,
    username: member.user.username,
    displayName: getDisplayName(member),
    server: member.guild.name,
    memberCount: member.guild.memberCount,
    phrase,
    emoji,
  };
}

function buildWelcomeContent(vars: WelcomeVars): { title: string; description: string; footer: string } {
  const titleTemplate = T('welcome.panel.title', '') || `${vars.emoji} Welcome`;
  const title = renderWelcome(titleTemplate, vars as any);

  const bodyAr = (T('welcome.panel.body_ar', '') || '').trim();
  const bodyEn = (T('welcome.panel.body_en', '') || '').trim();

  let description: string;
  if (bodyAr || bodyEn) {
    const parts: string[] = [];
    if (bodyAr) parts.push(renderWelcome(bodyAr, vars as any));
    if (bodyEn) parts.push(renderWelcome(bodyEn, vars as any));
    description = parts.join('\n\n');
  } else {
    const bodyTemplate = T('welcome.panel.body', '') || '{user} — {phrase}';
    description = renderWelcome(bodyTemplate, vars as any);
  }

  const footerTemplate = T('welcome.panel.footer', '') || `${config.botName} · Welcome`;
  const footer = stripUnknownVars(footerTemplate);

  return { title, description, footer };
}

// ============================================================
// Main welcome handler
// ============================================================
export async function handleMemberJoin(member: GuildMember): Promise<void> {
  if (member.user.bot) return;
  if (getSetting('welcome_enabled') === 'false') return;

  const channelId = getSetting('welcome_channel_id');
  if (!channelId) return;
  const channel = member.guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) return;
  if (!isV2Available()) return;

  const phrase = await pickPhrase();
  const files: AttachmentBuilder[] = [];
  let imageUrl: string | undefined;

  const gifUrl = pickRandomGif();
  if (gifUrl) {
    imageUrl = gifUrl;
  } else {
    const attachment = await generateWelcomeImage(member);
    if (attachment) {
      files.push(attachment);
      imageUrl = 'attachment://welcome-generated.png';
    }
  }

  const buttons = await buildWelcomeButtons(member.id);
  const welcomeEmoji = getWelcomeEmojiString();

  const vars = buildWelcomeVars(member, phrase, welcomeEmoji);
  const { title, description, footer } = buildWelcomeContent(vars);

  const container = buildV2Panel({
    accentColor: BLADE_COLOR,
    title,
    description,
    imageUrl,
    imageDescription: 'Welcome image',
    actionRows: buttons,
    footerText: footer,
  });

  const payload = buildV2Payload(container);

  try {
    await channel.send({
      ...(payload as any),
      files,
      allowedMentions: { users: [member.id] },
    });
    await logActivity('welcome_sent', member.id, `تم الترحيب بـ ${member.user.tag}`);
  } catch (e) { console.error('[Blade X] ❌ فشل إرسال رسالة الترحيب:', e); }
}

// ============================================================
// Say Hi
// ============================================================
export async function handleSayHi(interaction: ButtonInteraction): Promise<void> {
  const id = interaction.customId;
  if (!id.startsWith('welcome:sayhi:')) return;

  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (e) {
      console.error('[Blade X][sayhi] deferReply failed:', e);
      return;
    }
  }

  try {
    const targetId = id.slice('welcome:sayhi:'.length);
    if (!/^\d{17,20}$/.test(targetId)) {
      await interaction.editReply({ content: '⚠️ معرف غير صالح.' });
      return;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply({ content: '⚠️ السيرفر غير متاح.' });
      return;
    }

    const key = `greet:${interaction.user.id}:${targetId}:${interaction.message.id}`;
    const existing = await dbClient.execute({ sql: 'SELECT 1 FROM settings WHERE key = ?', args: [key] });
    if (existing.rows.length > 0) {
      await interaction.editReply({ content: T('welcome.sayhi.already', '') || '⚠️ رحّبت بهذا العضو بالفعل.' });
      return;
    }
    await dbClient.execute({ sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', args: [key, '1'] });

    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target) {
      await interaction.editReply({ content: T('welcome.sayhi.target_missing', '') || '⚠️ العضو غير موجود.' });
      return;
    }

    const channelId = getSetting('welcome_channel_id');
    const channel = channelId ? (guild.channels.cache.get(channelId) as TextChannel | undefined) : null;
    if (!channel) {
      await interaction.editReply({ content: T('welcome.sayhi.channel_missing', '') || '⚠️ قناة الترحيب غير مضبوطة.' });
      return;
    }

    if (!isV2Available()) {
      await interaction.editReply({ content: '⚠️ Components V2 غير متاح.' });
      return;
    }

    const files: AttachmentBuilder[] = [];
    let imageUrl: string | undefined;
    const hiImages = getHiImages();
    if (hiImages.length > 0) {
      const picked = pickRandom(hiImages);
      const ext = path.extname(picked).toLowerCase();
      const attachName = `sayhi${ext}`;
      files.push(new AttachmentBuilder(picked, { name: attachName }));
      imageUrl = `attachment://${attachName}`;
    }

    const sayHiEmoji = getWelcomeEmojiString();

    const sayHiTemplate = T('welcome.sayhi.text', '') || '**{user}** says hi to **{target}** {emoji}';
    const sayHiText = renderWelcome(sayHiTemplate, {
      user: `${interaction.user}`,
      target: `${target.user}`,
      emoji: sayHiEmoji,
    });

    const sayHiFooter = stripUnknownVars(T('welcome.sayhi.footer', '') || `${config.botName} · Welcome`);

    const container = buildV2Panel({
      accentColor: BLADE_COLOR,
      description: sayHiText,
      imageUrl,
      imageDescription: 'Say Hi image',
      footerText: sayHiFooter,
    });

    const payload = buildV2Payload(container);

    await channel.send({
      ...(payload as any),
      files,
      allowedMentions: { users: [interaction.user.id, targetId] },
    });

    await interaction.editReply({ content: T('welcome.sayhi.success', '') || '✅ تم إرسال ترحيبك!' });
    await logActivity('say_hi', interaction.user.id, `رحّب بـ ${targetId}`);
  } catch (e) {
    console.error('[Blade X] ❌ فشل Say Hi:', e);
    await interaction.editReply({ content: '❌ حدث خطأ.' }).catch(() => {});
  }
}