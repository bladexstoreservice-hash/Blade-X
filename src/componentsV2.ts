import {
  Client, ChatInputCommandInteraction, SlashCommandBuilder,
  PermissionFlagsBits, MessageFlags, EmbedBuilder, TextChannel,
  ChannelType, Message, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { config } from './config.js';
import { getSetting, upsertCv2Job, getCv2Job, listCv2Jobs } from './database.js';
import { getEmoji } from './emojiRegistry.js';
import { discordTime } from './utils.js';

// ⚠️ تفعيل التحويل الفعلي متعطّل افتراضيًا
const ALLOW_CONVERT = process.env.ALLOW_COMPONENTS_V2_CONVERT === 'true';

// ===== قائمة اللوحات المعروفة =====
interface PanelEntry {
  type: string;
  settingKey: string;
  label: string;
}

const PANEL_KEYS: PanelEntry[] = [
  { type: 'welcome_panel', settingKey: 'welcome_panel_message_id', label: 'لوحة الترحيب' },
  { type: 'selfroles_panel', settingKey: 'self_roles_message_id', label: 'لوحة الرولات' },
  { type: 'support_panel', settingKey: 'support_panel_message_id', label: 'لوحة الدعم' },
  { type: 'movie_summary', settingKey: 'movie_summary_message_id', label: 'ملخص Movie Night' },
];

interface ScanResult {
  type: string;
  label: string;
  messageId: string | null;
  channelId: string | null;
  found: boolean;
  alreadyConverted: boolean;
  convertible: boolean;
  reason: string;
}

// ===== فحص لوحة =====
async function scanPanel(client: Client, entry: PanelEntry): Promise<ScanResult> {
  const messageId = getSetting(entry.settingKey);
  if (!messageId) {
    return {
      type: entry.type, label: entry.label, messageId: null, channelId: null,
      found: false, alreadyConverted: false, convertible: false,
      reason: 'لا يوجد معرّف محفوظ في الإعدادات',
    };
  }

  const job = getCv2Job(messageId);
  if (job?.status === 'converted') {
    return {
      type: entry.type, label: entry.label, messageId, channelId: job.channel_id,
      found: true, alreadyConverted: true, convertible: false,
      reason: 'تم التحويل مسبقًا',
    };
  }

  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) {
    return { type: entry.type, label: entry.label, messageId, channelId: null, found: false, alreadyConverted: false, convertible: false, reason: 'السيرفر غير موجود' };
  }

  // ابحث في القنوات
  let found: Message | null = null;
  let channelId: string | null = null;
  for (const ch of guild.channels.cache.values()) {
    if (ch.type !== ChannelType.GuildText) continue;
    try {
      const msg = await (ch as TextChannel).messages.fetch(messageId).catch(() => null);
      if (msg) { found = msg; channelId = ch.id; break; }
    } catch { /* ignore */ }
  }

  if (!found) {
    return {
      type: entry.type, label: entry.label, messageId, channelId: null,
      found: false, alreadyConverted: false, convertible: false,
      reason: 'الرسالة غير موجودة أو لا يمكن الوصول إليها',
    };
  }

  // فحص المحتوى
  const hasEmbed = found.embeds.length > 0;
  const hasComponents = found.components.length > 0;
  if (!hasEmbed && !hasComponents) {
    return {
      type: entry.type, label: entry.label, messageId, channelId,
      found: true, alreadyConverted: false, convertible: false,
      reason: 'لا تحتوي على Embeds أو Components — لا حاجة للتحويل',
    };
  }

  // تحقق من عدم وجود Polls
  if ((found as any).poll) {
    return {
      type: entry.type, label: entry.label, messageId, channelId,
      found: true, alreadyConverted: false, convertible: false,
      reason: 'تحتوي على Poll — غير متوافق مع Components V2',
    };
  }

  return {
    type: entry.type, label: entry.label, messageId, channelId,
    found: true, alreadyConverted: false, convertible: true,
    reason: 'جاهزة للتحويل',
  };
}

// ===== الأوامر =====
export const componentsV2Command = new SlashCommandBuilder()
  .setName('componentsv2')
  .setDescription('أدوات تحويل رسائل البوت إلى Components V2')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(s => s.setName('scan').setDescription('فحص اللوحات المتاحة للتحويل'))
  .addSubcommand(s => s.setName('preview').setDescription('عرض تقرير التحويل المتوقع'))
  .addSubcommand(s => s.setName('status').setDescription('عرض حالة آخر عملية'))
  .addSubcommand(s =>
    s.setName('convert').setDescription('تنفيذ التحويل الفعلي (يتطلب تفعيل ALLOW_COMPONENTS_V2_CONVERT)')
      .addStringOption(o => o.setName('confirm').setDescription('اكتب CONVERT للتأكيد').setRequired(true))
  )
  .toJSON();

export async function handleComponentsV2(interaction: ChatInputCommandInteraction, client: Client): Promise<void> {
  if (interaction.commandName !== 'componentsv2') return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ للإدارة فقط.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand(true);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const results: ScanResult[] = [];
  for (const entry of PANEL_KEYS) {
    try {
      results.push(await scanPanel(client, entry));
    } catch (e: any) {
      results.push({
        type: entry.type, label: entry.label, messageId: null, channelId: null,
        found: false, alreadyConverted: false, convertible: false,
        reason: `خطأ: ${e?.message ?? 'unknown'}`,
      });
    }
  }

  if (sub === 'scan') {
    const lines = results.map(r => {
      const icon = r.alreadyConverted ? '✅' : r.convertible ? '🟢' : r.found ? '⚠️' : '❌';
      return `${icon} **${r.label}** — ${r.reason}${r.messageId ? `\n   \`${r.messageId}\`` : ''}`;
    }).join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${getEmoji('info', '🔍')} Components V2 — Scan`)
      .setDescription(lines || 'لا توجد لوحات مسجّلة.')
      .setFooter({ text: `${config.botName} · ComponentsV2` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === 'preview') {
    const convertibles = results.filter(r => r.convertible);
    const converted = results.filter(r => r.alreadyConverted);
    const skipped = results.filter(r => !r.convertible && !r.alreadyConverted);

    const embed = new EmbedBuilder()
      .setColor(0xf59e0b)
      .setTitle(`${getEmoji('warning', '⚠️')} Components V2 — Preview`)
      .setDescription(
        `**⚠️ تحذير:** تحويل رسالة إلى Components V2 **لا يمكن التراجع عنه**.\n` +
        `سيتم حذف Embeds والـ content التقليدية واستبدالها بمكونات.\n\n` +
        `**🟢 قابلة للتحويل:** ${convertibles.length}\n` +
        `**✅ محوّلة مسبقًا:** ${converted.length}\n` +
        `**⚠️ متجاوزة:** ${skipped.length}`
      )
      .addFields(
        { name: '📋 القابلة للتحويل', value: convertibles.length === 0 ? '*لا شيء*' : convertibles.map(r => `• ${r.label}`).join('\n').slice(0, 1020), inline: false },
        { name: '⏭️ المتجاوزة', value: skipped.length === 0 ? '*لا شيء*' : skipped.map(r => `• ${r.label} — ${r.reason}`).join('\n').slice(0, 1020), inline: false },
      )
      .setFooter({ text: ALLOW_CONVERT ? '✅ التحويل مفعّل' : '⛔ التحويل معطّل — فعّل ALLOW_COMPONENTS_V2_CONVERT=true' });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === 'status') {
    const jobs = listCv2Jobs(config.guildId);
    const stats = {
      pending: jobs.filter(j => j.status === 'pending').length,
      converted: jobs.filter(j => j.status === 'converted').length,
      failed: jobs.filter(j => j.status === 'failed').length,
      skipped: jobs.filter(j => j.status === 'skipped').length,
    };

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`${getEmoji('info', '📊')} Components V2 — Status`)
      .addFields(
        { name: '✅ محوّلة', value: `${stats.converted}`, inline: true },
        { name: '⏳ معلّقة', value: `${stats.pending}`, inline: true },
        { name: '❌ فاشلة', value: `${stats.failed}`, inline: true },
        { name: '⏭️ متجاوزة', value: `${stats.skipped}`, inline: true },
      )
      .setFooter({ text: ALLOW_CONVERT ? '✅ التحويل مفعّل' : '⛔ التحويل معطّل' });

    if (jobs.length > 0) {
      const lines = jobs.slice(0, 10).map(j => {
        const icon = j.status === 'converted' ? '✅' : j.status === 'failed' ? '❌' : j.status === 'skipped' ? '⏭️' : '⏳';
        return `${icon} **${j.panel_type}** — ${j.status}${j.error ? ` (${j.error.slice(0, 60)})` : ''}`;
      }).join('\n');
      embed.addFields({ name: '📋 آخر العمليات', value: lines, inline: false });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (sub === 'convert') {
    if (!ALLOW_CONVERT) {
      await interaction.editReply({
        content: `⛔ **التحويل الفعلي معطّل لأسباب أمنية.**\n\n` +
          `لتفعيله:\n` +
          `1. أضف \`ALLOW_COMPONENTS_V2_CONVERT=true\` إلى \`.env\`\n` +
          `2. أعد تشغيل البوت\n` +
          `3. شغّل الأمر مرة أخرى\n\n` +
          `**سبب التعطيل:** تفعيل \`IS_COMPONENTS_V2\` لا يمكن التراجع عنه، وقد يكسر اللوحات الحالية.`,
      });
      return;
    }

    const confirm = interaction.options.getString('confirm', true);
    if (confirm !== 'CONVERT') {
      await interaction.editReply({ content: '⚠️ اكتب `CONVERT` بالضبط للتأكيد.' });
      return;
    }

    const convertibles = results.filter(r => r.convertible);
    if (convertibles.length === 0) {
      await interaction.editReply({ content: '✅ لا توجد لوحات تحتاج تحويلًا.' });
      return;
    }

    let converted = 0, failed = 0;
    const errors: string[] = [];

    for (const r of convertibles) {
      if (!r.messageId || !r.channelId) continue;
      try {
        // ⚠️ التحويل الفعلي يحتاج تطبيق مكونات V2 لكل نوع لوحة بشكل مخصص.
        // حاليًا نُسجّل job بحالة pending ونعرض للمستخدم أن التنفيذ الكامل يتطلب تفعيله يدويًا.
        upsertCv2Job({
          guild_id: config.guildId,
          panel_type: r.type,
          channel_id: r.channelId,
          message_id: r.messageId,
          status: 'pending',
          error: 'التحويل التلقائي لكل نوع لوحة قيد التطوير — يُنصح بتحويل كل نوع يدويًا بعد الاختبار.',
        });
        failed++;
        errors.push(`• ${r.label}: ${r.messageId}`);
      } catch (e: any) {
        failed++;
        errors.push(`• ${r.label}: ${e?.message ?? 'unknown'}`);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(failed > 0 ? 0xf59e0b : 0x57f287)
      .setTitle(`${getEmoji('warning', '⚠️')} Components V2 — Conversion Report`)
      .setDescription(
        `تم تشغيل التحويل.\n\n` +
        `**✅ نجح:** ${converted}\n**⚠️ يحتاج تدخل يدوي:** ${failed}\n\n` +
        `**لماذا لم يتم التحويل تلقائيًا؟**\n` +
        `كل لوحة لها بنية Embeds مختلفة (Welcome, Self Roles, Support, Movie Night). ` +
        `التحويل التلقائي قد يفقد معلومات أو يكسر أزرارًا.\n\n` +
        `**الخطوة التالية:** راجع كل لوحة يدويًا، وبعد التأكد استخدم أمرًا مخصصًا للتحويل الفعلي.`
      );

    if (errors.length > 0) embed.addFields({ name: '📋 اللوحات', value: errors.slice(0, 10).join('\n'), inline: false });

    await interaction.editReply({ embeds: [embed] });
    return;
  }
}