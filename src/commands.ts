// ============================================================
// Blade X — Utility Commands (v5 — Turso)
// ============================================================
import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
  ChannelType,
  TextChannel,
  GuildMember,
  User,
} from 'discord.js';
import { bladeEmbed, discordTime, BLADE_COLOR } from './utils.js';
import { config } from './config.js';
import { logActivity, logModeration, dbClient } from './database.js';

const startTime = Date.now();

// ===== تعريفات الأوامر =====
export const utilityCommands = [
  new SlashCommandBuilder().setName('ping').setDescription('عرض سرعة استجابة البوت'),
  new SlashCommandBuilder().setName('help').setDescription('عرض قائمة أوامر Blade X'),
  new SlashCommandBuilder().setName('bot-status').setDescription('معلومات عن Blade X'),

  new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('معلومات عن عضو')
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(false)),

  new SlashCommandBuilder().setName('serverinfo').setDescription('معلومات عن السيرفر'),

  new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('عرض صورة عضو')
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(false)),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('تحذير عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('السبب').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('عرض تحذيرات عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true)),

  new SlashCommandBuilder()
    .setName('clear-warnings')
    .setDescription('مسح تحذيرات عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true)),

  new SlashCommandBuilder()
    .setName('lock')
    .setDescription('قفل القناة')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('فتح القناة')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('hide')
    .setDescription('إخفاء القناة')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('show')
    .setDescription('إظهار القناة')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('القناة').addChannelTypes(ChannelType.GuildText).setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('إرسال إعلان')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) => o.setName('message').setDescription('نص الإعلان').setRequired(true))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('القناة (افتراضيًا الحالية)')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('say')
    .setDescription('قل شيئًا كالبوت')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((o) => o.setName('message').setDescription('النص').setRequired(true)),

  new SlashCommandBuilder()
    .setName('role')
    .setDescription('إدارة رولات الأعضاء')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('إضافة رول لعضو')
        .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('الرول').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('إزالة رول من عضو')
        .addUserOption((o) => o.setName('member').setDescription('العضو').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('الرول').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('welcome-test')
    .setDescription('اختبار صورة الترحيب في القناة الحالية')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('movie-review')
    .setDescription('إدارة Movie Night Review')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('بدء جلسة تقييم فيلم جديدة')
        .addStringOption((o) => o.setName('movie').setDescription('اسم الفيلم').setRequired(true))
    )
    .addSubcommand((s) => s.setName('close').setDescription('إغلاق الجلسة الحالية'))
    .addSubcommand((s) => s.setName('status').setDescription('عرض حالة الجلسة الحالية')),
].map((c) => c.toJSON());

// ===== المعالج =====
export async function handleUtilityCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const name = interaction.commandName;
  const known = [
    'ping', 'help', 'bot-status', 'userinfo', 'serverinfo', 'avatar',
    'warn', 'warnings', 'clear-warnings',
    'lock', 'unlock', 'hide', 'show',
    'announce', 'say', 'role', 'welcome-test',
    'movie-review',
  ];
  if (!known.includes(name)) return false;

  try {
    switch (name) {
      case 'ping': {
        const sent = Date.now();
        await interaction.reply({ content: '🏓 يقيس...', flags: MessageFlags.Ephemeral });
        const roundTrip = Date.now() - sent;
        const wsLatency = interaction.client.ws.ping;
        await interaction.editReply({
          content: `🏓 **Pong!**\n📡 Round-trip: \`${roundTrip}ms\`\n💓 WebSocket: \`${wsLatency}ms\``,
        });
        return true;
      }

      case 'help': {
        const embed = bladeEmbed(`⚔️ ${config.botName} · قائمة الأوامر`).setDescription(
          [
            '**🛠️ الإعداد**',
            '`/setup` — إعداد النظام (قنوات، لوجز، رولات)',
            '`/dashboard` — فتح لوحة التحكم',
            '`/role-panel` — نشر لوحة الرولات',
            '',
            '**🔨 العقوبات**',
            '`/kick` `/ban` `/unban`',
            '`/timeout` `/untimeout`',
            '`/warn` `/warnings` `/clear-warnings`',
            '`/purge` `/slowmode`',
            '',
            '**🎬 Movie Night**',
            '`/movie-review start` — بدء تقييم فيلم',
            '`/movie-review close` — إغلاق الجلسة',
            '`/movie-review status` — حالة الجلسة',
            '',
            '**📢 عام**',
            '`/ping` `/bot-status` `/help`',
            '`/userinfo` `/serverinfo` `/avatar`',
            '',
            '**🎛️ إدارة القنوات**',
            '`/lock` `/unlock` `/hide` `/show`',
            '`/announce` `/say`',
            '',
            '**🎭 الرولات**',
            '`/role add` `/role remove`',
            '',
            '**🧪 اختبار**',
            '`/welcome-test`',
          ].join('\n')
        );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return true;
      }

      case 'bot-status': {
        const uptime = Date.now() - startTime;
        const hours = Math.floor(uptime / 3_600_000);
        const minutes = Math.floor((uptime % 3_600_000) / 60_000);
        const guilds = interaction.client.guilds.cache.size;
        const users = interaction.client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);

        const embed = bladeEmbed(`⚔️ ${config.botName} · حالة البوت`).addFields(
          { name: '🟢 الحالة', value: 'متصل', inline: true },
          { name: '⏱️ Uptime', value: `${hours}h ${minutes}m`, inline: true },
          { name: '📡 Ping', value: `${interaction.client.ws.ping}ms`, inline: true },
          { name: '🌐 Guilds', value: `${guilds}`, inline: true },
          { name: '👥 Users', value: `${users}`, inline: true },
          { name: '🤖 الإصدار', value: 'v1.0.0', inline: true }
        );
        await interaction.reply({ embeds: [embed] });
        return true;
      }

      case 'userinfo': {
        const user = (interaction.options.getUser('user', false) ?? interaction.user) as User;
        const member = await interaction.guild!.members.fetch(user.id).catch(() => null);
        const embed = bladeEmbed(`👤 ${config.botName} · معلومات العضو`)
          .setThumbnail(user.displayAvatarURL({ size: 256 }))
          .addFields(
            { name: 'الاسم', value: user.tag, inline: true },
            { name: 'المعرف', value: user.id, inline: true },
            { name: 'بوت', value: user.bot ? 'نعم' : 'لا', inline: true },
            { name: 'إنشاء الحساب', value: discordTime(user.createdAt.getTime(), 'F'), inline: false },
            { name: 'عمر الحساب', value: discordTime(user.createdAt.getTime(), 'R'), inline: false }
          );
        if (member) {
          embed.addFields(
            { name: 'الكنية', value: member.nickname ?? 'لا يوجد', inline: true },
            {
              name: 'انضم في',
              value: member.joinedAt ? discordTime(member.joinedAt.getTime(), 'F') : 'غير معروف',
              inline: false,
            },
            {
              name: 'أعلى رول',
              value:
                member.roles.highest.id === interaction.guild!.id ? 'لا يوجد' : member.roles.highest.toString(),
              inline: true,
            }
          );
        }
        await interaction.reply({ embeds: [embed] });
        return true;
      }

      case 'serverinfo': {
        const g = interaction.guild!;
        await g.fetch();
        const owner = await g.fetchOwner().catch(() => null);
        const embed = bladeEmbed(`🏰 ${config.botName} · معلومات السيرفر`)
          .setThumbnail(g.iconURL({ size: 256 }) ?? null)
          .addFields(
            { name: 'الاسم', value: g.name, inline: true },
            { name: 'المعرف', value: g.id, inline: true },
            { name: 'المالك', value: owner ? owner.user.tag : 'غير معروف', inline: true },
            { name: 'الأعضاء', value: `${g.memberCount}`, inline: true },
            { name: 'القنوات', value: `${g.channels.cache.size}`, inline: true },
            { name: 'الرولات', value: `${g.roles.cache.size}`, inline: true },
            {
              name: 'التعزيزات',
              value: `${g.premiumSubscriptionCount ?? 0} (المستوى ${g.premiumTier})`,
              inline: true,
            },
            { name: 'إنشاء السيرفر', value: discordTime(g.createdAt.getTime(), 'F'), inline: false }
          );
        await interaction.reply({ embeds: [embed] });
        return true;
      }

      case 'avatar': {
        const user = (interaction.options.getUser('user', false) ?? interaction.user) as User;
        const embed = new EmbedBuilder()
          .setColor(BLADE_COLOR)
          .setTitle(`🖼️ صورة ${user.username}`)
          .setImage(user.displayAvatarURL({ size: 1024 }))
          .setFooter({ text: `${config.botName} · Avatar` });
        await interaction.reply({ embeds: [embed] });
        return true;
      }

      case 'warn': {
        const member = interaction.options.getMember('member') as GuildMember;
        const reason = interaction.options.getString('reason', true);
        await logModeration('warn', member.id, interaction.user.id, reason, null, 'n/a');
        await logActivity('warn', member.id, reason);
        const { getModerationEmbed } = await import('./utils.js');
        const dm = getModerationEmbed('Warn', member.user, interaction.user, reason, null, interaction.guild!.name);
        try { await member.send({ embeds: [dm] }); } catch { /* ignore */ }
        await interaction.reply({
          content: `✅ تم تحذير ${member} — السبب: ${reason}`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      case 'warnings': {
        const member = interaction.options.getMember('member') as GuildMember;
        const result = await dbClient.execute({
          sql: "SELECT reason, moderator_id, created_at FROM moderation_log WHERE action='warn' AND target_id=? ORDER BY created_at DESC LIMIT 25",
          args: [member.id],
        });
        const rows = result.rows.map((r) => ({
          reason: r.reason != null ? String(r.reason) : null,
          moderator_id: r.moderator_id != null ? String(r.moderator_id) : null,
          created_at: Number(r.created_at ?? 0),
        }));
        if (rows.length === 0) {
          await interaction.reply({ content: `✅ لا توجد تحذيرات لـ ${member}.`, flags: MessageFlags.Ephemeral });
          return true;
        }
        const embed = bladeEmbed(`⚠️ تحذيرات ${member.user.tag}`).setDescription(
          rows
            .map(
              (r, i) =>
                `**${i + 1}.** ${r.reason ?? 'بدون سبب'} — <@${r.moderator_id ?? '0'}> — ${discordTime(r.created_at, 'R')}`
            )
            .join('\n')
        );
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return true;
      }

      case 'clear-warnings': {
        const member = interaction.options.getMember('member') as GuildMember;
        const result = await dbClient.execute({
          sql: "DELETE FROM moderation_log WHERE action='warn' AND target_id=?",
          args: [member.id],
        });
        await interaction.reply({
          content: `✅ تم مسح ${result.rowsAffected} تحذير لـ ${member}.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      case 'lock': {
        const ch = (interaction.options.getChannel('channel', false) ?? interaction.channel) as TextChannel;
        await ch.permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: false });
        await interaction.reply({ content: `🔒 تم قفل ${ch}` });
        return true;
      }

      case 'unlock': {
        const ch = (interaction.options.getChannel('channel', false) ?? interaction.channel) as TextChannel;
        await ch.permissionOverwrites.edit(interaction.guild!.roles.everyone, { SendMessages: null });
        await interaction.reply({ content: `🔓 تم فتح ${ch}` });
        return true;
      }

      case 'hide': {
        const ch = (interaction.options.getChannel('channel', false) ?? interaction.channel) as TextChannel;
        await ch.permissionOverwrites.edit(interaction.guild!.roles.everyone, { ViewChannel: false });
        await interaction.reply({ content: `🙈 تم إخفاء ${ch}`, flags: MessageFlags.Ephemeral });
        return true;
      }

      case 'show': {
        const ch = (interaction.options.getChannel('channel', false) ?? interaction.channel) as TextChannel;
        await ch.permissionOverwrites.edit(interaction.guild!.roles.everyone, { ViewChannel: null });
        await interaction.reply({ content: `👁️ تم إظهار ${ch}`, flags: MessageFlags.Ephemeral });
        return true;
      }

      case 'announce': {
        const message = interaction.options.getString('message', true);
        const ch = (interaction.options.getChannel('channel', false) ?? interaction.channel) as TextChannel;
        const embed = bladeEmbed(`📢 إعلان من ${interaction.guild!.name}`).setDescription(message);
        await ch.send({ embeds: [embed] });
        await interaction.reply({ content: `✅ تم الإرسال إلى ${ch}`, flags: MessageFlags.Ephemeral });
        return true;
      }

      case 'say': {
        const message = interaction.options.getString('message', true);
        const ch = interaction.channel;
        if (!ch || !ch.isTextBased() || ch.isDMBased()) {
          await interaction.reply({ content: '❌ لا يمكن الإرسال هنا.', flags: MessageFlags.Ephemeral });
          return true;
        }
        await ch.send({ content: message, allowedMentions: { parse: [] } });
        await interaction.reply({ content: '✅ تم الإرسال.', flags: MessageFlags.Ephemeral });
        return true;
      }

      case 'role': {
        const sub = interaction.options.getSubcommand(true);
        const member = interaction.options.getMember('member') as GuildMember;
        const role = interaction.options.getRole('role', true);
        const me = interaction.guild!.members.me!;
        if (role.position >= me.roles.highest.position) {
          await interaction.reply({ content: '❌ رتبة الرول أعلى من رتبة البوت.', flags: MessageFlags.Ephemeral });
          return true;
        }
        if (sub === 'add') {
          await member.roles.add(role.id);
          await interaction.reply({ content: `✅ تم إضافة ${role} لـ ${member}.`, flags: MessageFlags.Ephemeral });
        } else {
          await member.roles.remove(role.id);
          await interaction.reply({ content: `✅ تم إزالة ${role} من ${member}.`, flags: MessageFlags.Ephemeral });
        }
        return true;
      }

      case 'welcome-test': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { generateWelcomeImage } = await import('./welcome.js');
        const member = await interaction.guild!.members.fetch(interaction.user.id);
        const attachment = await generateWelcomeImage(member);
        if (!attachment) {
          await interaction.editReply({ content: '❌ فشل إنشاء الصورة. تأكد من وجود ملفات assets.' });
          return true;
        }
        const embed = bladeEmbed(`🧪 ${config.botName} · معاينة الترحيب`)
          .setDescription(`معاينة صورة ترحيب ${member}.\nالإحداثيات: Name X=${839}, Y=${510}`)
          .setImage('attachment://welcome-generated.png');
        await interaction.editReply({ embeds: [embed], files: [attachment] });
        return true;
      }

      case 'movie-review': {
        const sub = interaction.options.getSubcommand(true);
        const { startMovieSession, closeMovieSession } = await import('./movieNight.js');
        const { getActiveMovieSession, getMovieStats, getMovieRecipients } = await import('./database.js');

        if (sub === 'start') {
          const movie = interaction.options.getString('movie', true).trim();
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const res = await startMovieSession(interaction.client, movie, interaction.user.id);
          if ('error' in res) {
            await interaction.editReply({ content: res.error });
          } else {
            await interaction.editReply({
              content:
                `✅ بدأت جلسة **${movie}**.\n` +
                `📨 أُرسل: **${res.sent}** / فشل: **${res.failed}** / الإجمالي: **${res.total}**\n` +
                `سيُنشأ Thread عند وصول أول تقييم.`,
            });
          }
          return true;
        }

        if (sub === 'close') {
          const s = await getActiveMovieSession();
          if (!s) {
            await interaction.reply({ content: '⚠️ لا توجد جلسة مفتوحة.', flags: MessageFlags.Ephemeral });
            return true;
          }
          await closeMovieSession(s.id);
          await interaction.reply({ content: `✅ تم إغلاق جلسة **${s.movie_name}**.`, flags: MessageFlags.Ephemeral });
          return true;
        }

        if (sub === 'status') {
          const s = await getActiveMovieSession();
          if (!s) {
            await interaction.reply({ content: '⚠️ لا توجد جلسة مفتوحة.', flags: MessageFlags.Ephemeral });
            return true;
          }
          const stats = await getMovieStats(s.id);
          const recipients = await getMovieRecipients(s.id);
          const embed = bladeEmbed(`🎬 Movie Night — ${s.movie_name}`).addFields(
            { name: 'الحالة', value: s.status, inline: true },
            { name: 'المستلمون', value: `${recipients.length}`, inline: true },
            { name: 'المقيّمون', value: `${stats.count}`, inline: true },
            {
              name: 'المتوسط',
              value: stats.count > 0 ? `${stats.average.toFixed(2)} / 5` : 'لا توجد تقييمات',
              inline: true,
            },
            { name: 'بدأت', value: discordTime(s.started_at, 'F'), inline: false }
          );
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          return true;
        }
        return true;
      }
    }
  } catch (err) {
    console.error(`[Blade X] ❌ خطأ في ${name}:`, err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
      await interaction.editReply({ content: '❌ حدث خطأ.' }).catch(() => {});
    }
  }

  return true;
}