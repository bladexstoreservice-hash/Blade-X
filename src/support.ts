import {
  Client, Events, Interaction, ButtonInteraction, StringSelectMenuInteraction,
  ModalSubmitInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  TextChannel, ChannelType, PermissionFlagsBits, MessageFlags,
  AttachmentBuilder, Collection, Message,
} from 'discord.js';
import { config } from './config.js';
import {
  getSetting, setSetting, createTicket, getTicket, closeTicket,
  getNextTicketNumber, getUserOpenTickets,
  createSuggestion, getSuggestion, decideSuggestion,
  addSuggestionVote, getSuggestionVotes,
  logActivity,
} from './database.js';
import { getEmoji } from './emojiRegistry.js';
import { buildV2Panel, buildV2Payload, isV2Available } from './ui/v2.js';
import fs from 'node:fs';
import path from 'node:path';

let botClient: Client | null = null;
const PROJECT_ROOT = path.resolve(process.cwd());

// ===== Helpers =====
function getAsset(...candidates: string[]): string | null {
  for (const rel of candidates) {
    const abs = path.isAbsolute(rel) ? rel : path.join(PROJECT_ROOT, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeChannelId(key: string): string | null {
  const v = getSetting(key);
  return v && /^\d{17,20}$/.test(v) ? v : null;
}

// ===== Build select placeholder from text + emoji settings =====
function buildSelectPlaceholder(): string {
  const emoji = (getSetting('support_select_placeholder_emoji') || '').trim();
  const text = (getSetting('support_select_placeholder') || 'اختر الخدمة...').trim();
  if (emoji) {
    // Strip a leading emoji from text to avoid duplication, then prepend chosen emoji
    const stripped = text.replace(/^[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*/u, '');
    return `${emoji} ${stripped}`;
  }
  return text;
}

function ensureDefaults(): void {
  const defaults: Record<string, string> = {
    support_enabled: 'true',
    support_panel_channel: '',
    support_ticket_category: '',
    support_suggestions_channel: '',
    support_transcript_channel: '',
    support_admin_role: '',
    support_max_open_per_user: '3',
    support_title: '🎫 Support Center',
    support_description:
      '**اختر الخدمة التي تحتاجها من القائمة أدناه:**\n\n' +
      '🎧 **Support** — لفتح تذكرة خاصة مع فريق الإدارة.\n' +
      '💡 **Ideas & Suggestions** — لتقديم فكرة أو اقتراح للسيرفر.',
    support_color: '#5865f2',
    // Phase 1: placeholder split into text + emoji (backward compatible)
    support_select_placeholder: 'اختر الخدمة...',
    support_select_placeholder_emoji: '🎯',
    support_option_support_label: 'Support',
    support_option_support_desc: 'افتح تذكرة مع الإدارة',
    support_option_support_emoji: '🎧',
    support_option_suggestion_label: 'Ideas & Suggestions',
    support_option_suggestion_desc: 'قدّم فكرة أو اقتراحًا',
    support_option_suggestion_emoji: '💡',
    support_ticket_title: '🎫 تذكرة دعم',
    support_ticket_close_label: 'إغلاق التذكرة',
    support_ticket_close_emoji: '🔒',
    support_ticket_dm_title: 'تم إنشاء تذكرتك',
    support_ticket_dm_desc: 'سيتواصل معك فريق الإدارة قريبًا.',
    support_suggestion_title: '💡 اقتراح جديد',
    support_suggestion_approved: '✅ تم قبول الاقتراح',
    support_suggestion_rejected: '❌ تم رفض الاقتراح',
    support_transcript_title: '📄 Ticket Transcript',
  };
  for (const [k, v] of Object.entries(defaults)) {
    if (getSetting(k) === null) setSetting(k, v);
  }
}

// ===== نشر رسالة Support الرئيسية (Components V2) =====
export async function publishSupportPanel(client: Client): Promise<{ ok: boolean; error?: string }> {
  ensureDefaults();
  if (!isV2Available()) return { ok: false, error: 'Components V2 غير متاح في discord.js' };

  const channelId = safeChannelId('support_panel_channel');
  if (!channelId) return { ok: false, error: 'قناة اللوحة غير مضبوطة' };

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) return { ok: false, error: 'السيرفر غير موجود' };
  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) return { ok: false, error: 'القناة غير موجودة' };

  const files: AttachmentBuilder[] = [];
  let imageUrl: string | undefined;
  const supportImg = getAsset('assets/support.png', 'assets/Support.png');
  if (supportImg) {
    files.push(new AttachmentBuilder(supportImg, { name: 'support.png' }));
    imageUrl = 'attachment://support.png';
  } else {
    console.warn('[Blade X] ⚠️ support.png غير موجود');
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId('support:select')
    .setPlaceholder(buildSelectPlaceholder())
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(getSetting('support_option_support_label') || 'Support')
        .setDescription(getSetting('support_option_support_desc') || 'افتح تذكرة')
        .setValue('support')
        .setEmoji(getSetting('support_option_support_emoji') || '🎧'),
      new StringSelectMenuOptionBuilder()
        .setLabel(getSetting('support_option_suggestion_label') || 'Ideas & Suggestions')
        .setDescription(getSetting('support_option_suggestion_desc') || 'قدّم اقتراحًا')
        .setValue('suggestion')
        .setEmoji(getSetting('support_option_suggestion_emoji') || '💡')
    );

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const container = buildV2Panel({
    accentColor: parseInt((getSetting('support_color') || '#5865f2').replace('#', ''), 16),
    title: getSetting('support_title') || '🎫 Support Center',
    description: getSetting('support_description') || '',
    imageUrl,
    imageDescription: 'Support Center',
    actionRows: [selectRow as any],
    footerText: `${config.botName} · Support`,
  });

  try {
    const oldId = getSetting('support_panel_message_id');
    if (oldId) {
      try { const m = await channel.messages.fetch(oldId); await m.delete(); } catch {}
    }
    const msg = await channel.send({
      ...(buildV2Payload(container) as any),
      files,
      allowedMentions: { parse: [] },
    });
    setSetting('support_panel_message_id', msg.id);
    console.log('[Blade X] ✅ Support Center panel published');
    return { ok: true };
  } catch (e: any) {
    console.error('[Blade X] ❌ publishSupportPanel:', e);
    return { ok: false, error: e?.message ?? 'فشل الإرسال' };
  }
}

// ===== Select Menu Handler =====
async function handleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const value = interaction.values[0];

  if (value === 'support') {
    const modal = new ModalBuilder()
      .setCustomId('support:modal:ticket')
      .setTitle('🎫 فتح تذكرة دعم');

    const subject = new TextInputBuilder()
      .setCustomId('subject')
      .setLabel('عنوان المشكلة')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    const description = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('وصف المشكلة')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1500)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(subject),
      new ActionRowBuilder<TextInputBuilder>().addComponents(description),
    );

    await interaction.showModal(modal);
    return;
  }

  if (value === 'suggestion') {
    const modal = new ModalBuilder()
      .setCustomId('support:modal:suggestion')
      .setTitle('💡 قدّم اقتراحًا');

    const title = new TextInputBuilder()
      .setCustomId('title')
      .setLabel('عنوان الاقتراح')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);

    const description = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('تفاصيل الاقتراح')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(1500)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(title),
      new ActionRowBuilder<TextInputBuilder>().addComponents(description),
    );

    await interaction.showModal(modal);
    return;
  }
}

// ============================================================
// Ticket Modal Handler — no legacy `content` with V2
// ============================================================
async function handleTicketModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '❌ هذا الأمر للسيرفرات فقط.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const subject = interaction.fields.getTextInputValue('subject').trim().slice(0, 100);
  const description = interaction.fields.getTextInputValue('description').trim().slice(0, 1500);

  const maxOpen = parseInt(getSetting('support_max_open_per_user') || '3', 10);
  const open = getUserOpenTickets(guild.id, interaction.user.id);
  if (open.length >= maxOpen) {
    await interaction.editReply({ content: `❌ لديك بالفعل **${open.length}** تذكرة مفتوحة. الحد الأقصى ${maxOpen}.` });
    return;
  }

  const categoryId = safeChannelId('support_ticket_category');
  const adminRoleId = safeChannelId('support_admin_role');
  const number = getNextTicketNumber(guild.id);

  let channel: TextChannel | null = null;
  let ticketId: number | null = null;

  try {
    const overwrites: any[] = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: guild.members.me!.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
    ];
    if (adminRoleId) {
      overwrites.push({
        id: adminRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory],
      });
    }

    channel = await guild.channels.create({
      name: `ticket-${number}`,
      type: ChannelType.GuildText,
      parent: categoryId || undefined,
      permissionOverwrites: overwrites,
      topic: `Ticket #${number} — ${subject} | Owner: ${interaction.user.id}`,
    });

    ticketId = createTicket({
      guild_id: guild.id,
      number,
      user_id: interaction.user.id,
      channel_id: channel.id,
      subject,
      description,
      status: 'open',
      created_at: Date.now(),
    });

    const closeBtn = new ButtonBuilder()
      .setCustomId(`support:close:${ticketId}`)
      .setLabel(getSetting('support_ticket_close_label') || 'إغلاق التذكرة')
      .setEmoji(getSetting('support_ticket_close_emoji') || '🔒')
      .setStyle(ButtonStyle.Danger);

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(closeBtn);

    const mentionParts: string[] = [`<@${interaction.user.id}>`];
    if (adminRoleId) mentionParts.push(`<@&${adminRoleId}>`);
    const mentionText = mentionParts.join(' · ');

    const ticketContainer = buildV2Panel({
      accentColor: parseInt((getSetting('support_color') || '#5865f2').replace('#', ''), 16),
      title: `${getSetting('support_ticket_title') || '🎫 تذكرة'} #${number}`,
      sections: [
        { text: mentionText },
        { text: `**الموضوع:** ${subject}` },
        { text: `**صاحب التذكرة:** ${interaction.user} (\`${interaction.user.id}\`)` },
        { text: `**الوصف:**\n${description.slice(0, 1000)}` },
        { text: `**الحالة:** 🟢 مفتوحة` },
      ],
      separatorBetweenSections: true,
      actionRows: [closeRow as any],
      footerText: `${config.botName} · Ticket #${number}`,
    });

    try {
      await channel.send({
        ...(buildV2Payload(ticketContainer) as any),
        allowedMentions: {
          parse: [],
          users: [interaction.user.id],
          roles: adminRoleId ? [adminRoleId] : [],
        },
      });
    } catch (sendErr: any) {
      console.error('[Blade X] ❌ Ticket V2 send failed:', sendErr);
      try { await channel.delete('Ticket send failed').catch(() => {}); } catch {}
      if (ticketId) {
        try {
          const { default: db } = await import('./database.js');
          db.prepare('DELETE FROM tickets WHERE id = ?').run(ticketId);
        } catch { /* ignore */ }
      }
      await interaction.editReply({
        content: `❌ فشل إرسال رسالة التذكرة: ${sendErr?.message ?? 'خطأ'}`,
      });
      return;
    }

    try {
      const dmContainer = buildV2Panel({
        accentColor: 0x57f287,
        title: getSetting('support_ticket_dm_title') || 'تم إنشاء تذكرتك',
        description:
          `**رقم التذكرة:** #${number}\n` +
          `**الموضوع:** ${subject}\n\n` +
          (getSetting('support_ticket_dm_desc') || ''),
        footerText: config.botName,
      });
      await interaction.user.send({
        ...(buildV2Payload(dmContainer) as any),
        allowedMentions: { parse: [] },
      });
    } catch { /* DM مقفل */ }

    logActivity('ticket_create', interaction.user.id, `#${number} ${subject}`);
    await interaction.editReply({ content: `✅ تم إنشاء تذكرتك: ${channel}` });
  } catch (e: any) {
    console.error('[Blade X] ❌ handleTicketModal:', e);
    if (channel && ticketId === null) {
      try { await channel.delete('Ticket creation failed').catch(() => {}); } catch {}
    }
    await interaction.editReply({ content: `❌ فشل إنشاء التذكرة: ${e?.message ?? 'خطأ'}` });
  }
}

// ===== Suggestion Modal Handler =====
async function handleSuggestionModal(interaction: ModalSubmitInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '❌ هذا الأمر للسيرفرات فقط.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const title = interaction.fields.getTextInputValue('title').trim().slice(0, 100);
  const description = interaction.fields.getTextInputValue('description').trim().slice(0, 1500);

  const channelId = safeChannelId('support_suggestions_channel');
  if (!channelId) {
    await interaction.editReply({ content: '❌ قناة الاقتراحات غير مضبوطة.' });
    return;
  }
  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) {
    await interaction.editReply({ content: '❌ القناة غير موجودة.' });
    return;
  }

  try {
    const upBtn = new ButtonBuilder()
      .setCustomId('support:vote:up:placeholder')
      .setEmoji('👍').setLabel('0').setStyle(ButtonStyle.Success);
    const downBtn = new ButtonBuilder()
      .setCustomId('support:vote:down:placeholder')
      .setEmoji('👎').setLabel('0').setStyle(ButtonStyle.Danger);
    const approveBtn = new ButtonBuilder()
      .setCustomId('support:approve:placeholder')
      .setLabel('موافقة').setEmoji('✅').setStyle(ButtonStyle.Secondary);
    const rejectBtn = new ButtonBuilder()
      .setCustomId('support:reject:placeholder')
      .setLabel('رفض').setEmoji('❌').setStyle(ButtonStyle.Secondary);

    const container = buildV2Panel({
      accentColor: 0xf59e0b,
      title: `${getSetting('support_suggestion_title') || '💡 اقتراح'}: ${title}`,
      description,
      sections: [
        { text: `**صاحب الاقتراح:** ${interaction.user}` },
        { text: `**الحالة:** 🟡 قيد المراجعة` },
      ],
      actionRows: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(upBtn, downBtn),
        new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rejectBtn),
      ] as any,
      footerText: `${config.botName} · Suggestions`,
    });

    const msg = await channel.send({
      ...(buildV2Payload(container) as any),
      allowedMentions: { parse: [] },
    });

    const suggestionId = createSuggestion({
      guild_id: guild.id,
      user_id: interaction.user.id,
      message_id: msg.id,
      channel_id: channel.id,
      title,
      description,
      status: 'pending',
      created_at: Date.now(),
    });

    const upBtn2 = new ButtonBuilder()
      .setCustomId(`support:vote:up:${suggestionId}`)
      .setEmoji('👍').setLabel('0').setStyle(ButtonStyle.Success);
    const downBtn2 = new ButtonBuilder()
      .setCustomId(`support:vote:down:${suggestionId}`)
      .setEmoji('👎').setLabel('0').setStyle(ButtonStyle.Danger);
    const approveBtn2 = new ButtonBuilder()
      .setCustomId(`support:approve:${suggestionId}`)
      .setLabel('موافقة').setEmoji('✅').setStyle(ButtonStyle.Secondary);
    const rejectBtn2 = new ButtonBuilder()
      .setCustomId(`support:reject:${suggestionId}`)
      .setLabel('رفض').setEmoji('❌').setStyle(ButtonStyle.Secondary);

    const finalContainer = buildV2Panel({
      accentColor: 0xf59e0b,
      title: `${getSetting('support_suggestion_title') || '💡 اقتراح'}: ${title}`,
      description,
      sections: [
        { text: `**صاحب الاقتراح:** ${interaction.user}` },
        { text: `**الحالة:** 🟡 قيد المراجعة` },
      ],
      actionRows: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(upBtn2, downBtn2),
        new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn2, rejectBtn2),
      ] as any,
      footerText: `${config.botName} · Suggestions`,
    });

    await msg.edit({
      ...(buildV2Payload(finalContainer) as any),
      allowedMentions: { parse: [] },
    });

    logActivity('suggestion_create', interaction.user.id, `#${suggestionId} ${title}`);
    await interaction.editReply({ content: `✅ تم إرسال اقتراحك! ${msg.url}` });
  } catch (e: any) {
    console.error('[Blade X] ❌ handleSuggestionModal:', e);
    await interaction.editReply({ content: `❌ فشل: ${e?.message ?? 'خطأ'}` });
  }
}

// ===== Vote Handlers =====
async function handleVote(interaction: ButtonInteraction, direction: 'up' | 'down'): Promise<void> {
  const suggestionId = Number(interaction.customId.split(':')[3]);
  const suggestion = getSuggestion(suggestionId);
  if (!suggestion) {
    await interaction.reply({ content: '❌ الاقتراح غير موجود.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (suggestion.status !== 'pending') {
    await interaction.reply({ content: '🔒 الاقتراح مغلق.', flags: MessageFlags.Ephemeral });
    return;
  }

  addSuggestionVote(suggestionId, interaction.user.id, direction === 'up' ? 1 : -1);

  const votes = getSuggestionVotes(suggestionId);
  const guild = interaction.guild;
  if (!guild) return;
  const ch = guild.channels.cache.get(suggestion.channel_id) as TextChannel | undefined;
  const msg = await ch?.messages.fetch(suggestion.message_id).catch(() => null);
  if (msg) {
    const upBtn = new ButtonBuilder()
      .setCustomId(`support:vote:up:${suggestionId}`)
      .setEmoji('👍').setLabel(String(votes.up)).setStyle(ButtonStyle.Success);
    const downBtn = new ButtonBuilder()
      .setCustomId(`support:vote:down:${suggestionId}`)
      .setEmoji('👎').setLabel(String(votes.down)).setStyle(ButtonStyle.Danger);
    const approveBtn = new ButtonBuilder()
      .setCustomId(`support:approve:${suggestionId}`)
      .setLabel('موافقة').setEmoji('✅').setStyle(ButtonStyle.Secondary);
    const rejectBtn = new ButtonBuilder()
      .setCustomId(`support:reject:${suggestionId}`)
      .setLabel('رفض').setEmoji('❌').setStyle(ButtonStyle.Secondary);

    const container = buildV2Panel({
      accentColor: 0xf59e0b,
      title: `${getSetting('support_suggestion_title') || '💡 اقتراح'}: ${suggestion.title}`,
      description: suggestion.description,
      sections: [
        { text: `**صاحب الاقتراح:** <@${suggestion.user_id}>` },
        { text: `**الحالة:** 🟡 قيد المراجعة` },
      ],
      actionRows: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(upBtn, downBtn),
        new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rejectBtn),
      ] as any,
      footerText: `${config.botName} · Suggestions`,
    });

    await msg.edit({
      ...(buildV2Payload(container) as any),
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  await interaction.deferUpdate().catch(() => {});
}

// ===== Suggestion Decision =====
async function handleSuggestionDecision(interaction: ButtonInteraction, decision: 'approved' | 'rejected'): Promise<void> {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({ content: '❌ للإدارة فقط.', flags: MessageFlags.Ephemeral });
    return;
  }
  const suggestionId = Number(interaction.customId.split(':')[2]);
  const suggestion = getSuggestion(suggestionId);
  if (!suggestion) { await interaction.reply({ content: '❌ غير موجود.', flags: MessageFlags.Ephemeral }); return; }
  if (suggestion.status !== 'pending') { await interaction.reply({ content: '⚠️ تم البت فيه.', flags: MessageFlags.Ephemeral }); return; }

  decideSuggestion(suggestionId, decision, interaction.user.id);
  logActivity('suggestion_' + decision, interaction.user.id, `#${suggestionId}`);

  const guild = interaction.guild;
  if (!guild) return;
  const ch = guild.channels.cache.get(suggestion.channel_id) as TextChannel | undefined;
  const msg = await ch?.messages.fetch(suggestion.message_id).catch(() => null);
  if (msg) {
    const emoji = decision === 'approved' ? '✅' : '❌';
    const text = decision === 'approved'
      ? (getSetting('support_suggestion_approved') || '✅ تم قبول الاقتراح')
      : (getSetting('support_suggestion_rejected') || '❌ تم رفض الاقتراح');

    const container = buildV2Panel({
      accentColor: decision === 'approved' ? 0x57f287 : 0xed4245,
      title: `${getSetting('support_suggestion_title') || '💡 اقتراح'}: ${suggestion.title}`,
      description: suggestion.description,
      sections: [
        { text: `**صاحب الاقتراح:** <@${suggestion.user_id}>` },
        { text: `**الحالة:** ${emoji} ${text}` },
      ],
      footerText: `${config.botName} · Suggestions`,
    });
    await msg.edit({
      ...(buildV2Payload(container) as any),
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }

  await interaction.reply({ content: `✅ تم ${decision === 'approved' ? 'قبول' : 'رفض'} الاقتراح.`, flags: MessageFlags.Ephemeral });
}

// ===== بناء Transcript =====
async function buildTranscript(channel: TextChannel, ticket: any): Promise<{ html: string; count: number }> {
  let allMessages: Message[] = [];
  let lastId: string | undefined = undefined;

  for (let i = 0; i < 5; i++) {
    const batch: Collection<string, Message> = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => new Collection());
    if (batch.size === 0) break;
    allMessages.push(...batch.values());
    lastId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  allMessages.reverse();

  const rowsHtml = allMessages.map((m) => {
    const author = escapeHtml(m.author.tag);
    const authorId = m.author.id;
    const avatar = m.author.displayAvatarURL({ size: 64, extension: 'png' });
    const time = new Date(m.createdTimestamp).toISOString();
    const content = escapeHtml(m.content || '').replace(/\n/g, '<br>');
    const attachments = m.attachments.map((a) => `<a href="${escapeHtml(a.url)}" target="_blank">${escapeHtml(a.name)}</a>`).join(', ');
    return `
      <div class="msg">
        <img class="avatar" src="${escapeHtml(avatar)}" alt="">
        <div class="body">
          <div class="meta"><strong>${author}</strong> <span class="id">(${escapeHtml(authorId)})</span> <span class="time">${time}</span></div>
          <div class="content">${content}${attachments ? `<div class="attachments">📎 ${attachments}</div>` : ''}</div>
        </div>
      </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Ticket #${ticket.number} — Transcript</title>
<style>
  body { background:#1e1f22; color:#dbdee1; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; padding:24px; max-width:900px; margin:0 auto; }
  h1 { color:#fff; border-bottom:2px solid #5865f2; padding-bottom:12px; }
  .meta-box { background:#2b2d31; border-radius:8px; padding:16px; margin-bottom:24px; }
  .meta-box div { margin:4px 0; }
  .msg { display:flex; gap:12px; padding:12px 0; border-bottom:1px solid #2b2d31; }
  .avatar { width:40px; height:40px; border-radius:50%; flex-shrink:0; }
  .body { flex:1; min-width:0; }
  .meta { color:#949ba4; font-size:12px; margin-bottom:4px; }
  .meta strong { color:#fff; font-size:14px; }
  .meta .id { color:#6d6f78; }
  .meta .time { margin-left:8px; }
  .content { font-size:14px; line-height:1.5; word-wrap:break-word; }
  .attachments { color:#00a8fc; margin-top:6px; font-size:12px; }
  .attachments a { color:#00a8fc; text-decoration:none; }
</style>
</head>
<body>
  <h1>📄 Ticket #${ticket.number} — Transcript</h1>
  <div class="meta-box">
    <div><strong>Subject:</strong> ${escapeHtml(ticket.subject)}</div>
    <div><strong>Owner:</strong> ${escapeHtml(ticket.user_id)}</div>
    <div><strong>Created:</strong> ${new Date(ticket.created_at).toISOString()}</div>
    <div><strong>Closed:</strong> ${new Date().toISOString()}</div>
    <div><strong>Messages:</strong> ${allMessages.length}</div>
  </div>
  <div class="messages">${rowsHtml}</div>
</body>
</html>`;

  return { html, count: allMessages.length };
}

// ===== Close Ticket =====
async function handleCloseTicket(interaction: ButtonInteraction): Promise<void> {
  const ticketId = Number(interaction.customId.split(':')[2]);
  const ticket = getTicket(ticketId);
  if (!ticket) {
    await interaction.reply({ content: '❌ التذكرة غير موجودة.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (ticket.status !== 'open') {
    await interaction.reply({ content: '⚠️ التذكرة مغلقة بالفعل.', flags: MessageFlags.Ephemeral });
    return;
  }

  const guild = interaction.guild;
  if (!guild) return;

  const isOwner = interaction.user.id === ticket.user_id;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) ?? false;
  if (!isOwner && !isAdmin) {
    await interaction.reply({ content: '❌ غير مصرح لك بإغلاق هذه التذكرة.', flags: MessageFlags.Ephemeral });
    return;
  }

  closeTicket(ticketId, interaction.user.id);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = guild.channels.cache.get(ticket.channel_id) as TextChannel | undefined;
  if (!channel) {
    await interaction.editReply({ content: '❌ قناة التذكرة غير موجودة. لكن تم تعليمها كمغلقة.' });
    return;
  }

  let transcriptHtml: string;
  let msgCount: number;
  try {
    const t = await buildTranscript(channel, ticket);
    transcriptHtml = t.html;
    msgCount = t.count;
  } catch (e: any) {
    await interaction.editReply({ content: `❌ فشل إنشاء Transcript: ${e?.message ?? 'خطأ'}. لم يتم حذف القناة.` });
    return;
  }

  const transcriptChannelId = safeChannelId('support_transcript_channel');
  let transcriptSent = false;
  let transcriptError: string | null = null;

  if (!transcriptChannelId) {
    transcriptError = 'قناة الأرشفة غير مضبوطة';
  } else {
    const archiveCh = guild.channels.cache.get(transcriptChannelId) as TextChannel | undefined;
    if (!archiveCh) {
      transcriptError = 'قناة الأرشفة غير موجودة';
    } else {
      try {
        const buffer = Buffer.from(transcriptHtml, 'utf-8');
        const att = new AttachmentBuilder(buffer, { name: `ticket-${ticket.number}-transcript.html` });

        const metaContainer = buildV2Panel({
          accentColor: 0x5865f2,
          title: getSetting('support_transcript_title') || '📄 Ticket Transcript',
          sections: [
            { text: `**رقم التذكرة:** #${ticket.number}` },
            { text: `**صاحب التذكرة:** <@${ticket.user_id}>` },
            { text: `**الموضوع:** ${ticket.subject}` },
            { text: `**عدد الرسائل:** ${msgCount}` },
            { text: `**تم الإغلاق بواسطة:** ${interaction.user}` },
          ],
          footerText: `${config.botName} · Ticket Archive`,
        });

        await archiveCh.send({
          ...(buildV2Payload(metaContainer) as any),
          files: [att],
          allowedMentions: { parse: [] },
        });
        transcriptSent = true;
      } catch (e: any) {
        transcriptError = e?.message ?? 'فشل الإرسال';
      }
    }
  }

  const { default: db } = await import('./database.js');
  try {
    db.prepare('UPDATE tickets SET transcript_sent = ?, close_status = ?, close_error = ? WHERE id = ?')
      .run(transcriptSent ? 1 : 0, transcriptSent ? 'archived' : 'archive_failed', transcriptError, ticketId);
  } catch { /* ignore */ }

  if (!transcriptSent) {
    console.error(`[Blade X] ❌ فشل أرشفة التذكرة #${ticket.number}:`, transcriptError);
    await interaction.editReply({
      content: `⚠️ تم تعليم التذكرة كمغلقة لكن **فشل الأرشفة**: ${transcriptError}.\n**لم يتم حذف القناة.** راجع الإعدادات وأعد المحاولة.`,
    });
    return;
  }

  try {
    await interaction.editReply({ content: `✅ تم أرشفة التذكرة وحذف القناة خلال ثوانٍ...` });
    setTimeout(async () => {
      try { await channel.delete('Ticket archived and closed'); }
      catch (e) { console.error('[Blade X] ❌ فشل حذف القناة:', e); }
    }, 3000);
  } catch (e: any) {
    await interaction.editReply({ content: `⚠️ الأرشفة نجحت لكن فشل حذف القناة: ${e?.message ?? 'خطأ'}` });
  }

  logActivity('ticket_close', interaction.user.id, `#${ticket.number}`);
}

// ===== التسجيل =====
export function registerSupport(client: Client): void {
  botClient = client;
  ensureDefaults();

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isStringSelectMenu() && interaction.customId === 'support:select') {
        await handleSelect(interaction); return;
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === 'support:modal:ticket') { await handleTicketModal(interaction); return; }
        if (interaction.customId === 'support:modal:suggestion') { await handleSuggestionModal(interaction); return; }
      }

      if (interaction.isButton()) {
        const id = interaction.customId;
        if (id.startsWith('support:close:')) { await handleCloseTicket(interaction); return; }
        if (id.startsWith('support:vote:up:')) { await handleVote(interaction, 'up'); return; }
        if (id.startsWith('support:vote:down:')) { await handleVote(interaction, 'down'); return; }
        if (id.startsWith('support:approve:')) { await handleSuggestionDecision(interaction, 'approved'); return; }
        if (id.startsWith('support:reject:')) { await handleSuggestionDecision(interaction, 'rejected'); return; }
      }
    } catch (e) {
      console.error('[Blade X] ❌ support error:', e);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });

  console.log('[Blade X] ✅ Support Center V2 registered');
}