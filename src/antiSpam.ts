// ============================================================
// Blade X — Anti-Spam (v5 — Turso)
// ============================================================
import {
  Client, Events, Message, TextChannel, PermissionFlagsBits, Guild,
} from 'discord.js';
import {
  getSettingJSON, logModeration, logActivity,
  createSpamSession, addSpamSessionMessage, updateSpamSession,
} from './database.js';
import { bladeEmbed, discordTime, safeDM, getModerationEmbed } from './utils.js';
import { config } from './config.js';
import { logBanAction, logTimeoutAction } from './moderationLogs.js';

interface SpamConfig {
  enabled: boolean;
  maxMessages: number;
  intervalMs: number;
  maxDuplicates: number;
  maxMentions: number;
  checkLinks: boolean;
  checkInvites: boolean;
  punishment: 'warn' | 'timeout' | 'kick' | 'ban' | 'none';
  timeoutMs: number;
  excludedChannels: string[];
  excludedRoles: string[];
  sendDM: boolean;
  logChannelId: string | null;
  deleteMessages: boolean;
  maxDeleteCount: number;
  trackSessions: boolean;
}

const defaultSpamConfig: SpamConfig = {
  enabled: false,
  maxMessages: 8,
  intervalMs: 7_000,
  maxDuplicates: 4,
  maxMentions: 5,
  checkLinks: false,
  checkInvites: true,
  punishment: 'timeout',
  timeoutMs: 600_000,
  excludedChannels: [],
  excludedRoles: [],
  sendDM: true,
  logChannelId: null,
  deleteMessages: true,
  maxDeleteCount: 50,
  trackSessions: true,
};

interface TrackedMessage {
  id: string;
  channelId: string;
  content: string;
  timestamp: number;
}
interface UserTrack {
  timestamps: number[];
  contents: string[];
  messages: TrackedMessage[];
}

const userMessages = new Map<string, UserTrack>();
const punishedRecently = new Set<string>();

function cleanup(): void {
  const cutoff = Date.now() - 120_000;
  for (const [key, data] of userMessages) {
    data.timestamps = data.timestamps.filter(t => t > cutoff);
    data.contents = data.contents.slice(-data.timestamps.length);
    data.messages = data.messages.filter(m => m.timestamp > cutoff);
    if (data.timestamps.length === 0) userMessages.delete(key);
  }
}
setInterval(cleanup, 30_000);

// ===== حذف كل رسائل جلسة السبام =====
async function deleteSessionMessages(
  guild: Guild,
  sessionId: number,
  messages: TrackedMessage[],
  maxPerRun: number,
): Promise<{ deleted: number; failed: number; perChannel: Map<string, { deleted: number; failed: number }> }> {
  const perChannel = new Map<string, { deleted: number; failed: number }>();
  let totalDeleted = 0;
  let totalFailed = 0;

  const byChannel = new Map<string, TrackedMessage[]>();
  for (const m of messages.slice(0, maxPerRun)) {
    if (!byChannel.has(m.channelId)) byChannel.set(m.channelId, []);
    byChannel.get(m.channelId)!.push(m);
  }

  const me = guild.members.me;
  if (!me) return { deleted: 0, failed: messages.length, perChannel };

  for (const [channelId, msgs] of byChannel) {
    let chDeleted = 0;
    let chFailed = 0;
    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) {
      chFailed = msgs.length;
      totalFailed += chFailed;
      perChannel.set(channelId, { deleted: 0, failed: chFailed });
      for (const m of msgs) {
        await addSpamSessionMessage(sessionId, m.id, channelId, m.timestamp);
      }
      continue;
    }

    const textChannel = channel as TextChannel;
    const perms = textChannel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
      chFailed = msgs.length;
      totalFailed += chFailed;
      perChannel.set(channelId, { deleted: 0, failed: chFailed });
      for (const m of msgs) {
        await addSpamSessionMessage(sessionId, m.id, channelId, m.timestamp);
      }
      continue;
    }

    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recent: string[] = [];
    const old: string[] = [];
    for (const m of msgs) {
      if (m.timestamp > twoWeeksAgo) recent.push(m.id);
      else old.push(m.id);
    }

    while (recent.length > 0) {
      const batch = recent.splice(0, 100);
      if (batch.length === 1) {
        try { await textChannel.messages.delete(batch[0]); chDeleted++; }
        catch { chFailed++; }
      } else {
        try {
          const res = await textChannel.bulkDelete(batch, true);
          chDeleted += res.size;
        } catch {
          for (const id of batch) {
            try { await textChannel.messages.delete(id); chDeleted++; }
            catch { chFailed++; }
          }
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }

    for (const id of old) {
      try { await textChannel.messages.delete(id); chDeleted++; }
      catch { chFailed++; }
      await new Promise(r => setTimeout(r, 200));
    }

    totalDeleted += chDeleted;
    totalFailed += chFailed;
    perChannel.set(channelId, { deleted: chDeleted, failed: chFailed });

    for (const m of msgs) {
      await addSpamSessionMessage(sessionId, m.id, channelId, m.timestamp);
    }
  }

  return { deleted: totalDeleted, failed: totalFailed, perChannel };
}

export function registerAntiSpam(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    if (!message.guild || message.author.bot || !message.member) return;

    const cfg = getSettingJSON<SpamConfig>('antispam_config', defaultSpamConfig);
    if (!cfg.enabled) return;
    if (cfg.excludedChannels.includes(message.channelId)) return;
    if (cfg.excludedRoles.some(r => message.member!.roles.cache.has(r))) return;
    if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

    const userId = message.author.id;
    if (punishedRecently.has(userId)) return;

    const now = Date.now();
    let data = userMessages.get(userId);
    if (!data) { data = { timestamps: [], contents: [], messages: [] }; userMessages.set(userId, data); }

    data.timestamps.push(now);
    data.contents.push(message.content.slice(0, 200));
    data.messages.push({
      id: message.id,
      channelId: message.channelId,
      content: message.content.slice(0, 200),
      timestamp: now,
    });

    const recent = data.timestamps.filter(t => now - t <= cfg.intervalMs);
    const recentContents = data.contents.slice(-recent.length);

    let violation: string | null = null;
    let violationType: 'flood' | 'duplicate' | 'mentions' | 'invite' | 'link' = 'flood';

    if (recent.length > cfg.maxMessages) {
      violation = `تجاوز حد الرسائل (${recent.length} خلال ${Math.round(cfg.intervalMs / 1000)}ث)`;
      violationType = 'flood';
    } else if (cfg.maxDuplicates > 1) {
      const freq = new Map<string, number>();
      for (const c of recentContents) freq.set(c, (freq.get(c) ?? 0) + 1);
      const maxDup = Math.max(...freq.values());
      if (maxDup >= cfg.maxDuplicates) {
        violation = `تكرار الرسائل (${maxDup} مرات)`;
        violationType = 'duplicate';
      }
    }

    if (!violation && cfg.maxMentions > 0) {
      const mentionCount = message.mentions.users.size + message.mentions.roles.size;
      if (mentionCount > cfg.maxMentions) {
        violation = `إفراط في Mentions (${mentionCount})`;
        violationType = 'mentions';
      }
    }

    if (!violation && cfg.checkInvites) {
      if (/discord\.(gg|com\/invite)\//i.test(message.content)) {
        violation = 'نشر دعوة Discord';
        violationType = 'invite';
      }
    }
    if (!violation && cfg.checkLinks) {
      if (/https?:\/\/\S+/i.test(message.content)) {
        violation = 'نشر رابط';
        violationType = 'link';
      }
    }

    if (!violation) return;

    punishedRecently.add(userId);
    setTimeout(() => punishedRecently.delete(userId), 30_000);

    const member = message.member;
    const guild = message.guild;

    // ===== جمع رسائل الجلسة =====
    const sessionMessages = data.messages.filter(m => now - m.timestamp <= cfg.intervalMs);
    const uniqueChannels = new Set(sessionMessages.map(m => m.channelId));
    const windowStart = sessionMessages[0]?.timestamp ?? now;

    // ===== إنشاء Spam Session =====
    let sessionId: number | null = null;
    if (cfg.trackSessions) {
      sessionId = await createSpamSession({
        guild_id: guild.id,
        user_id: userId,
        violation_type: violationType,
        detected_at: now,
        window_start: windowStart,
        window_ms: cfg.intervalMs,
        message_count: sessionMessages.length,
        channels: [...uniqueChannels],
        punishment: cfg.punishment,
        details: violation,
      });
    }

    // ===== حذف الرسائل =====
    let deleteResult = { deleted: 0, failed: 0 };
    if (cfg.deleteMessages && sessionId) {
      try {
        const res = await deleteSessionMessages(guild, sessionId, sessionMessages, cfg.maxDeleteCount);
        deleteResult = { deleted: res.deleted, failed: res.failed };
      } catch (e) {
        console.error('[Blade X] ❌ spam delete error:', e);
      }
    }

    // ===== DM =====
    let dmStatus: 'sent' | 'failed' | 'n/a' = 'n/a';
    const punishmentValue = cfg.punishment;
    if (cfg.sendDM && punishmentValue !== 'none') {
      const dmEmbed = getModerationEmbed(
        punishmentValue.toUpperCase(),
        member.user,
        null,
        violation,
        cfg.timeoutMs,
        guild.name,
      );
      dmStatus = await safeDM(member.user, dmEmbed);
    }

    // ===== تنفيذ العقوبة =====
    let punishmentApplied: string = 'none';
    try {
      switch (punishmentValue) {
        case 'warn': {
          const ch = message.channel;
          if (ch.isTextBased() && !ch.isDMBased() && 'send' in ch) {
            await ch.send({ content: `⚠️ ${member} تم تحذيرك: ${violation}` }).catch(() => {});
          }
          punishmentApplied = 'warn';
          break;
        }
        case 'timeout':
          if (member.moderatable) {
            await member.timeout(cfg.timeoutMs, `Anti-Spam: ${violation}`);
            punishmentApplied = 'timeout';
            await logTimeoutAction({
              guild,
              target: member,
              actor: null,
              reason: null,
              durationMs: cfg.timeoutMs,
              source: 'antispam',
              reasonContext: {
                metadata: {
                  violationType,
                  detectedMessages: sessionMessages.length,
                  windowMs: cfg.intervalMs,
                  deletedCount: deleteResult.deleted,
                  failedCount: deleteResult.failed,
                  channelsCount: uniqueChannels.size,
                  spamSessionId: sessionId ?? undefined,
                },
              },
            });
          }
          break;
        case 'kick':
          if (member.kickable) {
            await member.kick(`Anti-Spam: ${violation}`);
            punishmentApplied = 'kick';
          }
          break;
        case 'ban':
          if (member.bannable) {
            await guild.bans.create(member.id, { reason: `Anti-Spam: ${violation}` });
            punishmentApplied = 'ban';
            await logBanAction({
              guild,
              target: member.user,
              actor: null,
              reason: null,
              durationMs: null,
              source: 'antispam',
              reasonContext: {
                metadata: {
                  violationType,
                  detectedMessages: sessionMessages.length,
                  windowMs: cfg.intervalMs,
                  deletedCount: deleteResult.deleted,
                  failedCount: deleteResult.failed,
                  channelsCount: uniqueChannels.size,
                  spamSessionId: sessionId ?? undefined,
                },
              },
            });
          }
          break;
        case 'none':
        default:
          punishmentApplied = 'none';
          break;
      }
    } catch (e) {
      console.error('[Blade X] ❌ Anti-Spam punishment failed:', e);
    }

    // ===== تحديث الجلسة =====
    if (sessionId) {
      const status = deleteResult.failed === 0
        ? 'completed'
        : deleteResult.deleted > 0
          ? 'partial'
          : 'failed';
      await updateSpamSession(sessionId, {
        deleted_count: deleteResult.deleted,
        failed_count: deleteResult.failed,
        status,
        punishment: punishmentApplied,
        punished_at: Date.now(),
      });
    }

    await logModeration(`antispam_${punishmentValue}`, member.id, null, violation, cfg.timeoutMs, dmStatus);
    await logActivity('antispam', member.id, `${violationType}: ${violation} | حُذف ${deleteResult.deleted}/${sessionMessages.length}`);

    // ===== Log =====
    if (cfg.logChannelId) {
      const logCh = guild.channels.cache.get(cfg.logChannelId);
      if (logCh?.isTextBased() && !logCh.isDMBased()) {
        const embed = bladeEmbed(`🛡️ ${config.botName} · Anti-Spam`)
          .setColor(0xed4245)
          .addFields(
            { name: '👤 المخالف', value: `${member} (\`${member.id}\`)`, inline: false },
            { name: '⚠️ المخالفة', value: violation, inline: false },
            { name: '📁 القنوات', value: uniqueChannels.size > 1 ? `${uniqueChannels.size} قنوات` : `<#${message.channelId}>`, inline: true },
            { name: '📊 الرسائل', value: `تم اكتشاف: **${sessionMessages.length}**\nمحذوفة: **${deleteResult.deleted}**\nفشل: **${deleteResult.failed}**`, inline: false },
            { name: '🔨 العقوبة', value: punishmentApplied, inline: true },
            { name: '📧 DM', value: dmStatus, inline: true },
            { name: '🕐 الوقت', value: discordTime(now, 'F'), inline: false },
          );
        if (sessionId) embed.addFields({ name: '🆔 الجلسة', value: `#${sessionId}`, inline: true });
        await (logCh as TextChannel).send({ embeds: [embed] }).catch(() => {});
      }
    }
  });

  console.log('[Blade X] ✅ Anti-Spam (with full session delete) registered');
}