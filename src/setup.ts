// ============================================================
// Blade X — Setup command (v5 — Turso)
// ============================================================
import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { setSetting, getSetting } from './database.js';
import { bladeEmbed } from './utils.js';
import { config } from './config.js';

const LOG_TYPES = {
  join: 'logs_join_channel_id',
  leave: 'logs_leave_channel_id',
  voice: 'logs_voice_channel_id',
  message: 'logs_message_channel_id',
  channel: 'logs_channel_channel_id',
  role: 'logs_role_channel_id',
  role_added: 'logs_role_added_channel_id',
  role_removed: 'logs_role_removed_channel_id',
  moderation: 'logs_moderation_channel_id',
  security: 'logs_security_channel_id',
} as const;

type LogType = keyof typeof LOG_TYPES;

const logChoices = [
  { name: '👋 Join Logs', value: 'join' },
  { name: '🚪 Leave Logs', value: 'leave' },
  { name: '🎙️ Voice Logs', value: 'voice' },
  { name: '💬 Message Logs', value: 'message' },
  { name: '📁 Channel Logs', value: 'channel' },
  { name: '🎭 Role Create/Delete', value: 'role' },
  { name: '✅ Role Added', value: 'role_added' },
  { name: '❌ Role Removed', value: 'role_removed' },
  { name: '🔨 Moderation Logs', value: 'moderation' },
  { name: '🛡️ Security Logs', value: 'security' },
] as const;

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('إعداد Blade X للسيرفر')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    sub
      .setName('welcome')
      .setDescription('ضبط قناة الترحيب (يقبل ID أو اختيار القناة)')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('قناة الترحيب — يمكنك لصق ID القناة مباشرة')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('welcome-toggle')
      .setDescription('تشغيل أو إيقاف نظام الترحيب')
      .addBooleanOption((o) => o.setName('enabled').setDescription('مفعّل أم لا').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub
      .setName('logs')
      .setDescription('ضبط قناة لوج معينة')
      .addStringOption((o) =>
        o.setName('type').setDescription('نوع اللوج').setRequired(true).addChoices(...logChoices)
      )
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('قناة اللوج — يمكنك لصق ID')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('logs-disable')
      .setDescription('إيقاف لوج معين')
      .addStringOption((o) =>
        o.setName('type').setDescription('نوع اللوج').setRequired(true).addChoices(...logChoices)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('selfroles')
      .setDescription('ضبط قناة لوحة الرولات')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('قناة الرولات — يمكنك لصق ID')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('movie-voice')
      .setDescription('ضبط قناة السينما الصوتية')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('القناة الصوتية')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('movie-reviews')
      .setDescription('ضبط قناة المراجعات النصية')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('قناة المراجعات')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName('view').setDescription('عرض كل الإعدادات الحالية'))
  .addSubcommand((sub) =>
    sub
      .setName('reset')
      .setDescription('إعادة تعيين الإعدادات')
      .addStringOption((o) =>
        o
          .setName('section')
          .setDescription('القسم')
          .setRequired(true)
          .addChoices(
            { name: 'كل شيء', value: 'all' },
            { name: 'الترحيب', value: 'welcome' },
            { name: 'اللوجز', value: 'logs' },
            { name: 'الرولات', value: 'selfroles' },
            { name: 'السينما', value: 'movie' }
          )
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName('welcome-message')
      .setDescription('ضبط قناة الترحيب عبر ID كنص (طريقة بديلة)')
      .addStringOption((o) =>
        o.setName('channel_id').setDescription('معرف القناة (17-20 رقمًا)').setRequired(true)
      )
  )
  .toJSON();

export async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== 'setup') return;

  if (!interaction.guild) {
    await interaction.reply({ content: '❌ هذا الأمر للسيرفرات فقط.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: '❌ هذا الأمر للمديرين فقط.', flags: MessageFlags.Ephemeral });
    return;
  }

  const sub = interaction.options.getSubcommand(true);

  try {
    switch (sub) {
      case 'welcome': {
        const channel = interaction.options.getChannel('channel', true);
        await setSetting('welcome_channel_id', channel.id);
        await setSetting('welcome_enabled', 'true');
        await interaction.reply({
          content: `✅ تم ضبط قناة الترحيب على <#${channel.id}>\n✅ تم تفعيل نظام الترحيب تلقائيًا.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'welcome-message': {
        const id = interaction.options.getString('channel_id', true).trim();
        if (!/^\d{17,20}$/.test(id)) {
          await interaction.reply({ content: '❌ المعرف غير صالح. يجب أن يكون 17-20 رقمًا.', flags: MessageFlags.Ephemeral });
          return;
        }
        const channel = interaction.guild.channels.cache.get(id);
        if (!channel) {
          await interaction.reply({ content: `❌ لم أجد قناة بالمعرف \`${id}\`.`, flags: MessageFlags.Ephemeral });
          return;
        }
        await setSetting('welcome_channel_id', id);
        await setSetting('welcome_enabled', 'true');
        await interaction.reply({
          content: `✅ تم ضبط قناة الترحيب على <#${id}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'welcome-toggle': {
        const enabled = interaction.options.getBoolean('enabled', true);
        await setSetting('welcome_enabled', enabled ? 'true' : 'false');
        await interaction.reply({
          content: `${enabled ? '✅ تم تفعيل' : '⏸️ تم إيقاف'} نظام الترحيب.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'logs': {
        const type = interaction.options.getString('type', true) as LogType;
        const channel = interaction.options.getChannel('channel', true);
        const key = LOG_TYPES[type];
        if (!key) {
          await interaction.reply({ content: '❌ نوع لوج غير معروف.', flags: MessageFlags.Ephemeral });
          return;
        }
        await setSetting(key, channel.id);
        await interaction.reply({
          content: `✅ تم ضبط لوج **${type}** على <#${channel.id}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'logs-disable': {
        const type = interaction.options.getString('type', true) as LogType;
        const key = LOG_TYPES[type];
        if (!key) {
          await interaction.reply({ content: '❌ نوع لوج غير معروف.', flags: MessageFlags.Ephemeral });
          return;
        }
        await setSetting(key, '');
        await interaction.reply({
          content: `⏸️ تم إيقاف لوج **${type}**`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'selfroles': {
        const channel = interaction.options.getChannel('channel', true);
        await setSetting('self_roles_channel_id', channel.id);
        await interaction.reply({
          content: `✅ تم ضبط قناة الرولات على <#${channel.id}>\n💡 شغّل \`/role-panel publish\` لنشر اللوحة.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'movie-voice': {
        const ch = interaction.options.getChannel('channel', true);
        await setSetting('movie_voice_channel_id', ch.id);
        await interaction.reply({
          content: `✅ تم ضبط قناة السينما الصوتية على <#${ch.id}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'movie-reviews': {
        const ch = interaction.options.getChannel('channel', true);
        await setSetting('movie_reviews_channel_id', ch.id);
        await interaction.reply({
          content: `✅ تم ضبط قناة المراجعات النصية على <#${ch.id}>`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      case 'view': {
        const embed = buildConfigEmbed(interaction);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      case 'reset': {
        const section = interaction.options.getString('section', true);
        const welcomeKeys = ['welcome_channel_id', 'welcome_enabled'];
        const logKeys = Object.values(LOG_TYPES);
        const roleKeys = ['self_roles_channel_id', 'self_roles_message_id'];
        const movieKeys = ['movie_voice_channel_id', 'movie_reviews_channel_id'];

        let keys: string[] = [];
        if (section === 'all') keys = [...welcomeKeys, ...logKeys, ...roleKeys, ...movieKeys];
        else if (section === 'welcome') keys = welcomeKeys;
        else if (section === 'logs') keys = logKeys;
        else if (section === 'selfroles') keys = roleKeys;
        else if (section === 'movie') keys = movieKeys;

        for (const k of keys) await setSetting(k, '');
        await interaction.reply({
          content: `✅ تم إعادة تعيين: **${section}** (${keys.length} إعداد)`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }
  } catch (err) {
    console.error('[Blade X] ❌ خطأ في setup:', err);
    if (!interaction.replied) {
      await interaction.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

function buildConfigEmbed(interaction: ChatInputCommandInteraction): ReturnType<typeof bladeEmbed> {
  const guild = interaction.guild!;
  const welcomeChannel = getSetting('welcome_channel_id');
  const welcomeEnabled = getSetting('welcome_enabled') !== 'false';
  const selfRolesChannel = getSetting('self_roles_channel_id');
  const movieVoice = getSetting('movie_voice_channel_id');
  const movieReviews = getSetting('movie_reviews_channel_id');

  const fmt = (id: string | null): string => (id ? `<#${id}>` : '`غير مضبوط`');

  const embed = bladeEmbed(`⚙️ ${config.botName} · الإعدادات الحالية`).addFields(
    {
      name: '👋 نظام الترحيب',
      value: `**الحالة:** ${welcomeEnabled ? '✅ مفعّل' : '⏸️ معطّل'}\n**القناة:** ${fmt(welcomeChannel)}`,
      inline: false,
    },
    {
      name: '📋 قنوات اللوجز',
      value: (Object.entries(LOG_TYPES) as [LogType, string][])
        .map(([type, key]) => `**${type}:** ${fmt(getSetting(key))}`)
        .join('\n'),
      inline: false,
    },
    {
      name: '🎭 لوحة الرولات',
      value: `**القناة:** ${fmt(selfRolesChannel)}`,
      inline: false,
    },
    {
      name: '🎬 Movie Night',
      value: `**الصوتية:** ${fmt(movieVoice)}\n**المراجعات:** ${fmt(movieReviews)}`,
      inline: false,
    },
    {
      name: '🌐 Dashboard',
      value: `[فتح لوحة التحكم](${config.dashboard.baseUrl})`,
      inline: false,
    }
  );

  embed.setFooter({ text: `${config.botName} · Server: ${guild.name}` });
  return embed;
}

export function registerSetupHandlers(_client: import('discord.js').Client): void {
  // الإعداد يتم عبر Subcommands — لا حاجة لمعالجات إضافية.
}