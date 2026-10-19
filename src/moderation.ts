// ============================================================
// Blade X — Moderation Commands (v5 — Turso)
// ============================================================
import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  GuildMember,
  TextChannel,
  MessageFlags,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Events,
  Client,
  VoiceChannel,
} from 'discord.js';
import { logModeration, logActivity, getActiveTemporaryPunishments } from './database.js';
import { parseDuration, formatDuration, safeDM, getModerationEmbed } from './utils.js';
import { logBanAction, logTimeoutAction, logUnbanAction, logUntimeoutAction } from './moderationLogs.js';
import { config } from './config.js';

function logWarn(op: string, ctx: Record<string, unknown> = {}, err?: unknown): void {
  const ctxStr = Object.entries(ctx)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${String(v).slice(0, 150)}`)
    .join(' ');
  console.warn(`[Blade X][moderation] [${op}] ${ctxStr}`.trim(), err ?? '');
}

// ============================================================
// Commands
// ============================================================
export const moderationCommands = [
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('طرد عضو من السيرفر')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('member').setDescription('العضو المراد طرده').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('سبب الطرد').setRequired(false)),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('حظر عضو من السيرفر')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('member').setDescription('العضو المراد حظره').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('سبب الحظر').setRequired(false))
    .addStringOption(o => o.setName('duration').setDescription('مدة الحظر مثل 1h أو 7d').setRequired(false)),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('فك الحظر عن مستخدم')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o => o.setName('user_id').setDescription('معرف المستخدم').setRequired(true)),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('إسكات عضو مؤقتًا')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('duration').setDescription('المدة مثل 10m أو 1h').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('السبب').setRequired(false)),

  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('إزالة الإسكات عن عضو')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('member').setDescription('العضو').setRequired(true)),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('حذف عدد من الرسائل')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('count').setDescription('عدد الرسائل (1-100)').setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('تغيير الوضع البطيء للقناة')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o => o.setName('seconds').setDescription('عدد الثواني (0-21600)').setRequired(true).setMinValue(0).setMaxValue(21600)),

  new SlashCommandBuilder()
    .setName('move-all')
    .setDescription('نقل جميع الأعضاء من قناة صوتية إلى أخرى')
    .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
    .addChannelOption(o =>
      o.setName('source')
        .setDescription('القناة الصوتية المصدر')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true))
    .addChannelOption(o =>
      o.setName('destination')
        .setDescription('القناة الصوتية الوجهة')
        .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
        .setRequired(true)),
].map(cmd => cmd.toJSON());

// ============================================================
// Move-All session storage
// ============================================================
interface MoveAllSession {
  ownerId: string;
  sourceId: string;
  destId: string;
  memberIds: string[];
  createdAt: number;
}
const moveAllSessions = new Map<string, MoveAllSession>();

setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [id, s] of moveAllSessions) {
    if (s.createdAt < cutoff) moveAllSessions.delete(id);
  }
}, 60_000);

// ============================================================
// Move-All button handler
// ============================================================
export function registerModerationButtons(client: Client): void {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) return;
    const id = interaction.customId;
    if (!id.startsWith('moveall:')) return;

    const parts = id.split(':');
    const action = parts[1];
    const sessionId = parts[2];
    const session = moveAllSessions.get(sessionId);

    if (!session) {
      await interaction.reply({ content: '⚠️ انتهت صلاحية الجلسة. أعد تشغيل الأمر.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
    if (session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: '❌ هذا التأكيد ليس لك.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (action === 'cancel') {
      moveAllSessions.delete(sessionId);
      await interaction.update({ content: '❌ تم إلغاء العملية.', embeds: [], components: [] }).catch(() => {});
      return;
    }

    if (action === 'confirm') {
      moveAllSessions.delete(sessionId);
      try {
        await interaction.update({ content: '⏳ جارٍ النقل...', embeds: [], components: [] });
      } catch { /* ignore */ }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.editReply({ content: '❌ السيرفر غير متاح.' });
        return;
      }

      const me = guild.members.me;
      if (!me) {
        await interaction.editReply({ content: '❌ البوت غير موجود.' });
        return;
      }

      if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) {
        await interaction.editReply({ content: '❌ البوت لم يعد يملك صلاحية **Move Members**.' });
        return;
      }

      const dest = guild.channels.cache.get(session.destId);
      if (!dest || !dest.isVoiceBased()) {
        await interaction.editReply({ content: '❌ قناة الوجهة غير متاحة.' });
        return;
      }

      let success = 0;
      let skippedNotInSource = 0;
      let skippedFetchFail = 0;
      let otherFailed = 0;

      for (const memberId of session.memberIds) {
        try {
          const member = await guild.members.fetch(memberId).catch(() => null);
          if (!member) { skippedFetchFail++; continue; }
          if (!member.voice.channel || member.voice.channel.id !== session.sourceId) {
            skippedNotInSource++;
            continue;
          }
          await member.voice.setChannel(dest as VoiceChannel, 'Move All');
          success++;
        } catch (err) {
          logWarn('move_all_member_failed', { memberId, err: (err as Error)?.message });
          otherFailed++;
        }
        await new Promise(r => setTimeout(r, 120));
      }

      const total = session.memberIds.length;
      const lines = [`✅ **تم نقل:** ${success} / ${total}`];
      if (skippedNotInSource > 0) lines.push(`⏭️ **غادروا المصدر:** ${skippedNotInSource}`);
      if (skippedFetchFail > 0) lines.push(`❓ **تعذّر جلبهم:** ${skippedFetchFail}`);
      if (otherFailed > 0) lines.push(`⚠️ **فشل نقلهم:** ${otherFailed}`);

      await interaction.editReply({ content: lines.join('\n') });
      await logActivity('move_all', interaction.user.id, `moved ${success}/${total} from ${session.sourceId} to ${session.destId}`);
      return;
    }
  });
}

// ============================================================
// Hierarchy check
// ============================================================
async function checkHierarchy(interaction: ChatInputCommandInteraction, target: GuildMember): Promise<string | null> {
  const me = interaction.guild?.members.me;
  if (!me) return 'البوت غير موجود في السيرفر.';
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) return 'ليس لديك صلاحية.';
  if (target.id === interaction.guild?.ownerId) return 'لا يمكنك معاقبة مالك السيرفر.';
  if (target.id === me.id) return 'لا يمكنك معاقبة البوت.';
  if (target.roles.highest.position >= me.roles.highest.position) return 'رتبة العضو أعلى من رتبة البوت.';
  return null;
}

// ============================================================
// Command handler
// ============================================================
export async function handleModerationCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const { commandName } = interaction;
  if (!['kick', 'ban', 'unban', 'timeout', 'untimeout', 'purge', 'slowmode', 'move-all'].includes(commandName)) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    switch (commandName) {
      case 'kick': {
        const member = interaction.options.getMember('member') as GuildMember;
        const reason = interaction.options.getString('reason');
        const err = await checkHierarchy(interaction, member);
        if (err) { await interaction.editReply({ content: `❌ ${err}` }); return true; }

        const dmEmbed = getModerationEmbed('Kick', member.user, interaction.user, reason, null, interaction.guild!.name);
        const dmStatus = await safeDM(member.user, dmEmbed);

        await member.kick(reason ?? undefined);
        await logModeration('kick', member.id, interaction.user.id, reason, null, dmStatus);
        await logActivity('kick', member.id, `طُرد بواسطة ${interaction.user.tag}`);
        await interaction.editReply({ content: `✅ تم طرد ${member.user.tag}.` });
        return true;
      }

      case 'ban': {
        const member = interaction.options.getMember('member') as GuildMember | null;
        const userId = interaction.options.getUser('member')?.id;
        const reason = interaction.options.getString('reason');
        const durationStr = interaction.options.getString('duration');
        if (!userId) { await interaction.editReply({ content: '❌ لم يتم تحديد العضو.' }); return true; }

        const targetUser = await interaction.client.users.fetch(userId).catch(() => null);
        if (!targetUser) { await interaction.editReply({ content: '❌ لم يتم العثور على المستخدم.' }); return true; }

        if (member) {
          const err = await checkHierarchy(interaction, member);
          if (err) { await interaction.editReply({ content: `❌ ${err}` }); return true; }
        }

        let durationMs: number | null = null;
        if (durationStr) {
          durationMs = parseDuration(durationStr);
          if (!durationMs) {
            await interaction.editReply({ content: '❌ صيغة المدة غير صحيحة. استخدم مثل 10m, 1h, 7d.' });
            return true;
          }
        }

        const dmEmbed = getModerationEmbed('Ban', targetUser, interaction.user, reason, durationMs, interaction.guild!.name);
        const dmStatus = await safeDM(targetUser, dmEmbed);

        await interaction.guild!.bans.create(userId, { reason: reason ?? undefined, deleteMessageSeconds: 0 });
        await logModeration('ban', userId, interaction.user.id, reason, durationMs, dmStatus);
        await logActivity('ban', userId, `محظور بواسطة ${interaction.user.tag}`);

        await logBanAction({
          guild: interaction.guild!,
          target: targetUser,
          actor: interaction.user,
          reason: reason ?? null,
          durationMs,
          source: 'manual',
        });

        await interaction.editReply({
          content: `✅ تم حظر ${targetUser.tag}${durationMs ? ` لمدة ${formatDuration(durationMs)}` : ''}.`,
        });
        return true;
      }

      case 'unban': {
        const userId = interaction.options.getString('user_id', true);
        try {
          const banInfo = await interaction.guild!.bans.fetch(userId).catch(() => null);
          await interaction.guild!.bans.remove(userId);
          await logModeration('unban', userId, interaction.user.id, null, null, 'n/a');
          await logActivity('unban', userId, `فُك الحظر بواسطة ${interaction.user.tag}`);
          if (banInfo) await logUnbanAction(interaction.guild!, banInfo.user, interaction.user);
          await interaction.editReply({ content: `✅ تم فك الحظر عن ${userId}.` });
        } catch {
          await interaction.editReply({ content: '❌ المستخدم غير محظور أو حدث خطأ.' });
        }
        return true;
      }

      case 'timeout': {
        const member = interaction.options.getMember('member') as GuildMember;
        const durationStr = interaction.options.getString('duration', true);
        const reason = interaction.options.getString('reason');
        const err = await checkHierarchy(interaction, member);
        if (err) { await interaction.editReply({ content: `❌ ${err}` }); return true; }

        const durationMs = parseDuration(durationStr);
        if (!durationMs || durationMs > 28 * 86_400_000) {
          await interaction.editReply({ content: '❌ المدة غير صحيحة. الحد الأقصى 28 يومًا.' });
          return true;
        }

        const dmEmbed = getModerationEmbed('Timeout', member.user, interaction.user, reason, durationMs, interaction.guild!.name);
        const dmStatus = await safeDM(member.user, dmEmbed);

        await member.timeout(durationMs, reason ?? undefined);
        await logModeration('timeout', member.id, interaction.user.id, reason, durationMs, dmStatus);
        await logActivity('timeout', member.id, `إسكات بواسطة ${interaction.user.tag}`);

        await logTimeoutAction({
          guild: interaction.guild!,
          target: member,
          actor: interaction.user,
          reason: reason ?? null,
          durationMs,
          source: 'manual',
        });

        await interaction.editReply({ content: `✅ تم إسكات ${member.user.tag} لمدة ${formatDuration(durationMs)}.` });
        return true;
      }

      case 'untimeout': {
        const member = interaction.options.getMember('member') as GuildMember;
        await member.timeout(null);
        await logModeration('untimeout', member.id, interaction.user.id, null, null, 'n/a');
        await logUntimeoutAction(interaction.guild!, member, interaction.user);
        await interaction.editReply({ content: `✅ تم إزالة الإسكات عن ${member.user.tag}.` });
        return true;
      }

      case 'purge': {
        const count = interaction.options.getInteger('count', true);
        const channel = interaction.channel as TextChannel;
        const deleted = await channel.bulkDelete(count, true);
        await interaction.editReply({ content: `✅ تم حذف ${deleted.size} رسالة.` });
        return true;
      }

      case 'slowmode': {
        const seconds = interaction.options.getInteger('seconds', true);
        const channel = interaction.channel as TextChannel;
        await channel.setRateLimitPerUser(seconds);
        await interaction.editReply({ content: `✅ تم تغيير الوضع البطيء إلى ${seconds} ثانية.` });
        return true;
      }

      case 'move-all': {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.MoveMembers)) {
          await interaction.editReply({ content: '❌ تحتاج صلاحية **Move Members** لتنفيذ هذا الأمر.' });
          return true;
        }

        const src = interaction.options.getChannel('source', true);
        const dst = interaction.options.getChannel('destination', true);

        if (src.id === dst.id) {
          await interaction.editReply({ content: '❌ قناة المصدر والوجهة متطابقتان.' });
          return true;
        }

        const guild = interaction.guild!;
        const source = guild.channels.cache.get(src.id) as VoiceChannel | undefined;
        const dest = guild.channels.cache.get(dst.id) as VoiceChannel | undefined;

        if (!source || !dest) {
          await interaction.editReply({ content: '❌ إحدى القنوات غير موجودة.' });
          return true;
        }
        if (!source.isVoiceBased() || !dest.isVoiceBased()) {
          await interaction.editReply({ content: '❌ يجب اختيار قنوات صوتية.' });
          return true;
        }

        const me = guild.members.me;
        if (!me) {
          await interaction.editReply({ content: '❌ البوت غير موجود في السيرفر.' });
          return true;
        }

        if (!me.permissions.has(PermissionFlagsBits.MoveMembers)) {
          await interaction.editReply({ content: '❌ البوت لا يملك صلاحية **Move Members** — لا يمكنه النقل.' });
          return true;
        }
        if (!me.permissions.has(PermissionFlagsBits.ViewChannel)) {
          await interaction.editReply({ content: '❌ البوت لا يملك صلاحية **View Channels**.' });
          return true;
        }

        const srcPerms = source.permissionsFor(me);
        const dstPerms = dest.permissionsFor(me);
        if (!srcPerms?.has(PermissionFlagsBits.ViewChannel) || !dstPerms?.has(PermissionFlagsBits.ViewChannel)) {
          await interaction.editReply({ content: '❌ البوت لا يستطيع رؤية إحدى القناتين.' });
          return true;
        }
        if (!srcPerms.has(PermissionFlagsBits.Connect)) {
          await interaction.editReply({ content: '❌ البوت لا يستطيع الاتصال بقناة المصدر.' });
          return true;
        }
        if (!dstPerms.has(PermissionFlagsBits.Connect)) {
          await interaction.editReply({ content: '❌ البوت لا يستطيع الاتصال بقناة الوجهة.' });
          return true;
        }

        const members = [...source.members.values()].filter(m => !m.user.bot);
        if (members.length === 0) {
          await interaction.editReply({ content: `⚠️ لا يوجد أعضاء في ${source}.` });
          return true;
        }

        const sessionId = Math.random().toString(36).slice(2, 10);
        moveAllSessions.set(sessionId, {
          ownerId: interaction.user.id,
          sourceId: source.id,
          destId: dest.id,
          memberIds: members.map(m => m.id),
          createdAt: Date.now(),
        });

        const embed = new EmbedBuilder()
          .setColor(0xf59e0b)
          .setTitle('🔀 تأكيد النقل الجماعي')
          .setDescription(
            `**المصدر:** ${source}\n` +
            `**الوجهة:** ${dest}\n` +
            `**عدد الأعضاء المستهدفين:** ${members.length}\n\n` +
            `هل تريد المتابعة؟`
          )
          .setFooter({ text: `${config.botName} · Move All` });

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`moveall:cancel:${sessionId}`).setLabel('إلغاء').setStyle(ButtonStyle.Secondary).setEmoji('❌'),
          new ButtonBuilder().setCustomId(`moveall:confirm:${sessionId}`).setLabel('تأكيد النقل').setStyle(ButtonStyle.Danger).setEmoji('🔀'),
        );

        await interaction.editReply({ embeds: [embed], components: [row] });
        return true;
      }
    }
  } catch (err) {
    console.error(`[Blade X] ❌ خطأ في أمر ${commandName}:`, err);
    await interaction.editReply({ content: '❌ حدث خطأ أثناء تنفيذ الأمر.' }).catch(() => {});
  }
  return true;
}

// ===== Punishment checker =====
export function startPunishmentChecker(client: import('discord.js').Client): void {
  setInterval(async () => {
    try {
      const active = await getActiveTemporaryPunishments();
      const now = Date.now();
      for (const p of active) {
        if (p.expires_at <= now) {
          const guild = client.guilds.cache.get(config.guildId);
          if (!guild) continue;
          if (p.action === 'ban') {
            await guild.bans.remove(p.target_id, 'انتهت مدة الحظر المؤقت').catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error('[Blade X] ❌ خطأ في فحص العقوبات المؤقتة:', err);
    }
  }, 60_000);
}