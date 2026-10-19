import {
  Client, Events, VoiceState, Message, PartialMessage, Role,
  TextChannel, EmbedBuilder, Guild,
} from 'discord.js';
import { getSetting } from './database.js';
import { discordTime, truncate } from './utils.js';
import { T, C, render } from './texts.js';
import { config } from './config.js';

async function sendLog(guild: Guild, key: string, embed: EmbedBuilder): Promise<void> {
  const id = getSetting(key);
  if (!id) return;
  const ch = guild.channels.cache.get(id) as TextChannel | undefined;
  if (!ch) return;
  try { await ch.send({ embeds: [embed] }); } catch (e) { console.error(`[Blade X] ❌ log ${key}:`, e); }
}

export function registerLogEvents(client: Client): void {
  // ===== Join =====
  client.on(Events.GuildMemberAdd, async (member) => {
    const isNew = Date.now() - member.user.createdAt.getTime() < 7 * 86_400_000;
    const vars = {
      user: `${member}`, username: member.user.username,
      nickname: member.nickname ?? member.displayName,
      server: member.guild.name, memberCount: member.guild.memberCount,
      timestamp: discordTime(Date.now(), 'F'),
    };
    const embed = new EmbedBuilder()
      .setColor(C('color.logs.join'))
      .setTitle(render(T('text.logs.join.title'), vars))
      .setAuthor({ name: member.user.tag, iconURL: member.displayAvatarURL() })
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .setDescription(render(T('text.logs.join.description'), vars) + (isNew ? `\n\n⚠️ **حساب جديد** · New account` : ''))
      .addFields(
        { name: '👤 Username', value: `\`${member.user.username}\``, inline: true },
        { name: '🆔 User ID', value: `\`${member.id}\``, inline: true },
        { name: '🤖 Type', value: member.user.bot ? 'Bot' : 'Human', inline: true },
        { name: '📅 Account Created', value: discordTime(member.user.createdAt.getTime(), 'F'), inline: true },
        { name: '⏳ Account Age', value: discordTime(member.user.createdAt.getTime(), 'R'), inline: true },
        { name: '🕐 Joined At', value: discordTime(Date.now(), 'F'), inline: true }
      );
    if (member.roles.cache.size > 1) {
      const roles = member.roles.cache.filter(r => r.id !== member.guild.id).map(r => r.toString()).slice(0, 10).join(' ');
      embed.addFields({ name: '🎭 Roles', value: roles, inline: false });
    }
    await sendLog(member.guild, 'logs_join_channel_id', embed);
  });

  // ===== Leave =====
  client.on(Events.GuildMemberRemove, async (member) => {
    const vars = {
      user: `${member}`, username: member.user.tag,
      server: member.guild.name, timestamp: discordTime(Date.now(), 'F'),
    };
    const embed = new EmbedBuilder()
      .setColor(C('color.logs.leave'))
      .setTitle(render(T('text.logs.leave.title'), vars))
      .setAuthor({ name: member.user.tag, iconURL: member.displayAvatarURL() })
      .setThumbnail(member.displayAvatarURL({ size: 256 }))
      .setDescription(render(T('text.logs.leave.description'), vars))
      .addFields(
        { name: '🆔 User ID', value: `\`${member.id}\``, inline: true },
        { name: '🕐 Left At', value: discordTime(Date.now(), 'F'), inline: true },
        { name: '⏳ Account Age', value: discordTime(member.user.createdAt.getTime(), 'R'), inline: true }
      );
    if (member.joinedAt) embed.addFields({ name: '📆 Member For', value: discordTime(member.joinedAt.getTime(), 'R'), inline: true });
    await sendLog(member.guild, 'logs_leave_channel_id', embed);
  });

  // ===== Voice — الإصلاح الأساسي هنا =====
  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member) return;

    let title = ''; let description = ''; let color = C('color.logs.voice');
    const extraFields: { name: string; value: string; inline?: boolean }[] = [];

    if (!oldState.channel && newState.channel) {
      title = T('text.logs.voice.joined');
      // ⬅️ استخدام mention القناة `<#id>`
      description = `${newState.channel}`;
      extraFields.push({ name: '🔊 Channel', value: `${newState.channel}`, inline: true });
    } else if (oldState.channel && !newState.channel) {
      title = T('text.logs.voice.left');
      // ⬅️ الإصلاح: استخدام Mention بدل name
      description = `${oldState.channel}`;
      color = 0xed4245;
      extraFields.push({ name: '🔇 Left Channel', value: `${oldState.channel}`, inline: true });
    } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
      title = T('text.logs.voice.moved');
      description = `${oldState.channel} → ${newState.channel}`;
      extraFields.push(
        { name: '➡️ From', value: `${oldState.channel}`, inline: true },
        { name: '⬅️ To', value: `${newState.channel}`, inline: true },
      );
    } else if (oldState.selfMute !== newState.selfMute) {
      title = newState.selfMute ? '🔇 Self Muted' : '🔊 Self Unmuted';
      description = newState.selfMute ? 'كتم المايك' : 'ألغى كتم المايك';
    } else if (oldState.selfDeaf !== newState.selfDeaf) {
      title = newState.selfDeaf ? '🔇 Self Deafened' : '🔊 Self Undeafened';
      description = newState.selfDeaf ? 'صمّم الأذن' : 'ألغى تصدير الأذن';
    } else return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setAuthor({ name: member.user.tag, iconURL: member.displayAvatarURL() })
      .setThumbnail(member.displayAvatarURL({ size: 128 }))
      .setDescription(description)
      .addFields(
        { name: '👤 Member', value: `${member}`, inline: true },
        ...extraFields,
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: true }
      )
      .setFooter({ text: `${config.botName} · Voice Log` });

    await sendLog(member.guild, 'logs_voice_channel_id', embed);
  });

  // ===== Message edit =====
  client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
    if (!newMsg.guild || newMsg.author?.bot) return;
    const oldC = oldMsg.content ?? '(غير متوفر)';
    const newC = newMsg.content ?? '(غير متوفر)';
    if (oldC === newC) return;
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(`✏️ ${config.botName} · Message Edited`)
      .setAuthor({ name: newMsg.author?.tag ?? 'Unknown', iconURL: newMsg.author?.displayAvatarURL() })
      .addFields(
        { name: '👤 Author', value: `${newMsg.author}`, inline: true },
        { name: '📁 Channel', value: `${newMsg.channel}`, inline: true },
        { name: '📝 Old', value: truncate(oldC, 1020), inline: false },
        { name: '✨ New', value: truncate(newC, 1020), inline: false },
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false }
      );
    if (newMsg.url) embed.addFields({ name: '🔗', value: `[Jump](${newMsg.url})`, inline: false });
    await sendLog(newMsg.guild, 'logs_message_channel_id', embed);
  });

  // ===== Message delete =====
  client.on(Events.MessageDelete, async (msg) => {
    if (!msg.guild || msg.author?.bot) return;
    const c = msg.content ?? 'محتوى الرسالة غير متوفر.';
    const embed = new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle(`🗑️ ${config.botName} · Message Deleted`)
      .setAuthor({ name: msg.author?.tag ?? 'Unknown', iconURL: msg.author?.displayAvatarURL() })
      .addFields(
        { name: '👤 Author', value: msg.author ? `${msg.author}` : 'غير معروف', inline: true },
        { name: '📁 Channel', value: `${msg.channel}`, inline: true },
        { name: '📝 Content', value: truncate(c, 1020), inline: false },
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false }
      );
    await sendLog(msg.guild, 'logs_message_channel_id', embed);
  });

  // ===== Channel =====
  client.on(Events.ChannelCreate, async (ch) => {
    if (ch.isDMBased() || !ch.guild) return;
    const embed = new EmbedBuilder().setColor(0x57f287)
      .setTitle(`📁 ${config.botName} · Channel Created`)
      .addFields(
        { name: '📁 Channel', value: `${ch}`, inline: true },
        { name: '📌 Type', value: ch.type.toString(), inline: true },
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false }
      );
    await sendLog(ch.guild, 'logs_channel_channel_id', embed);
  });

  client.on(Events.ChannelDelete, async (ch) => {
    if (ch.isDMBased() || !ch.guild) return;
    const embed = new EmbedBuilder().setColor(0xed4245)
      .setTitle(`🗑️ ${config.botName} · Channel Deleted`)
      .addFields(
        { name: '📁 Channel', value: ch.name, inline: true },
        { name: '📌 Type', value: ch.type.toString(), inline: true },
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false }
      );
    await sendLog(ch.guild, 'logs_channel_channel_id', embed);
  });

  // ===== Role create/delete =====
  client.on(Events.GuildRoleCreate, async (role: Role) => {
    const embed = new EmbedBuilder().setColor(0x57f287)
      .setTitle(`🎭 ${config.botName} · Role Created`)
      .addFields(
        { name: '🎭 Role', value: role.name, inline: true },
        { name: '🆔 ID', value: role.id, inline: true },
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false }
      );
    await sendLog(role.guild, 'logs_role_channel_id', embed);
  });

  client.on(Events.GuildRoleDelete, async (role: Role) => {
    const embed = new EmbedBuilder().setColor(0xed4245)
      .setTitle(`🗑️ ${config.botName} · Role Deleted`)
      .addFields(
        { name: '🎭 Role', value: role.name, inline: true },
        { name: '🆔 ID', value: role.id, inline: true },
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false }
      );
    await sendLog(role.guild, 'logs_role_channel_id', embed);
  });

  // ===== Role Added / Removed =====
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));

    for (const [, role] of added) {
      if (role.id === newMember.guild.id) continue;
      const embed = new EmbedBuilder()
        .setColor(C('color.logs.role.added'))
        .setTitle(T('text.logs.role.added.title'))
        .setAuthor({ name: newMember.user.tag, iconURL: newMember.displayAvatarURL() })
        .setThumbnail(newMember.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: '👤 Member', value: `${newMember}`, inline: true },
          { name: '🎭 Role', value: role.toString(), inline: true },
          { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false },
          { name: '📌 Source', value: 'Self-Assignable Roles / Member Selection', inline: true }
        );
      await sendLog(newMember.guild, 'logs_role_added_channel_id', embed);
    }

    for (const [, role] of removed) {
      if (role.id === newMember.guild.id) continue;
      const embed = new EmbedBuilder()
        .setColor(C('color.logs.role.removed'))
        .setTitle(T('text.logs.role.removed.title'))
        .setAuthor({ name: newMember.user.tag, iconURL: newMember.displayAvatarURL() })
        .setThumbnail(newMember.displayAvatarURL({ size: 128 }))
        .addFields(
          { name: '👤 Member', value: `${newMember}`, inline: true },
          { name: '🎭 Role', value: role.toString(), inline: true },
          { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false },
          { name: '📌 Source', value: 'Member Selection / Admin Action', inline: true }
        );
      await sendLog(newMember.guild, 'logs_role_removed_channel_id', embed);
    }
  });

  // ===== Ban =====
  client.on(Events.GuildBanAdd, async (ban) => {
    const embed = new EmbedBuilder().setColor(0xed4245)
      .setTitle(`🔨 ${config.botName} · Member Banned`)
      .setAuthor({ name: ban.user.tag, iconURL: ban.user.displayAvatarURL() })
      .setThumbnail(ban.user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: '👤 Target', value: ban.user.tag, inline: true },
        { name: '🆔 ID', value: ban.user.id, inline: true },
        { name: '📝 Reason', value: ban.reason ?? 'غير متوفر', inline: false },
        { name: '🕐 Time', value: discordTime(Date.now(), 'F'), inline: false }
      );
    await sendLog(ban.guild, 'logs_moderation_channel_id', embed);
  });

  console.log('[Blade X] ✅ تم تسجيل أحداث اللوجز');
}