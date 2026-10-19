import {
  Client, Events, Guild, GuildBan, GuildMember, AuditLogEvent,
  EmbedBuilder, TextChannel, User,
} from 'discord.js';
import { config } from './config.js';
import { getSetting, logModerationEventFull } from './database.js';
import { getEmoji } from './emojiRegistry.js';
import { discordTime } from './utils.js';

// ===== Helpers =====
function getLogChannel(guild: Guild, key: string): TextChannel | null {
  const id = getSetting(key);
  if (!id) return null;
  const ch = guild.channels.cache.get(id);
  if (!ch || !ch.isTextBased() || ch.isDMBased()) return null;
  return ch as TextChannel;
}

async function resolveActorFromAudit(
  guild: Guild,
  action: AuditLogEvent,
  targetId: string,
  windowMs = 5000,
): Promise<{ actorId: string | null; confidence: 'high' | 'low' | 'unknown' }> {
  try {
    const logs = await guild.fetchAuditLogs({ type: action, limit: 5 });
    const cutoff = Date.now() - windowMs;
    for (const entry of logs.entries.values()) {
      if (entry.createdTimestamp < cutoff) continue;
      const target = entry.target as any;
      if (target?.id === targetId) {
        return { actorId: entry.executor?.id ?? null, confidence: 'high' };
      }
    }
    const first = logs.entries.first();
    if (first && first.createdTimestamp >= cutoff) {
      return { actorId: first.executor?.id ?? null, confidence: 'low' };
    }
  } catch { /* no perms */ }
  return { actorId: null, confidence: 'unknown' };
}

// ===== Reason formatter =====
export interface ReasonContext {
  source: 'manual' | 'antispam' | 'raid' | 'spam_trap' | 'external' | 'bot';
  manualReason?: string | null;
  metadata?: {
    violationType?: 'flood' | 'duplicate' | 'mentions' | 'invite' | 'link' | 'raid';
    detectedMessages?: number;
    windowMs?: number;
    deletedCount?: number;
    failedCount?: number;
    channelsCount?: number;
    spamSessionId?: number;
  };
}

const VIOLATION_LABELS: Record<string, { ar: string; en: string }> = {
  flood: { ar: 'إرسال عدد كبير من الرسائل خلال فترة قصيرة', en: 'Flood' },
  duplicate: { ar: 'تكرار الرسالة نفسها عدة مرات', en: 'Repeated Messages' },
  mentions: { ar: 'إرسال منشنات متكررة بصورة مزعجة', en: 'Mass Mentions' },
  invite: { ar: 'نشر دعوات Discord غير مسموح بها', en: 'Blocked Invites' },
  link: { ar: 'نشر روابط محظورة', en: 'Blocked Links' },
  raid: { ar: 'موجة دخول مشبوهة', en: 'Raid Detected' },
};

export function formatReason(ctx: ReasonContext): { main: string; details: string | null } {
  if (ctx.manualReason && ctx.manualReason.trim()) {
    return { main: ctx.manualReason.trim(), details: null };
  }

  // ✅ ضيّق النوع بحفظ القيمة في متغير محلي
  if (ctx.source === 'antispam' && ctx.metadata) {
    const meta = ctx.metadata;
    const vType = meta.violationType;
    if (vType) {
      const labels = VIOLATION_LABELS[vType];
      const label = labels?.ar ?? 'سلوك مزعج';
      const enLabel = labels?.en ?? 'Spam';

      const lines: string[] = [];
      if (meta.detectedMessages !== undefined) lines.push(`• عدد الرسائل المكتشفة: **${meta.detectedMessages}**`);
      if (meta.windowMs !== undefined) lines.push(`• الفترة الزمنية: **${Math.round(meta.windowMs / 1000)}** ثانية`);
      if (meta.deletedCount !== undefined) lines.push(`• تم حذف: **${meta.deletedCount}** رسالة`);
      if (meta.failedCount && meta.failedCount > 0) lines.push(`• فشل حذف: **${meta.failedCount}** رسالة`);
      if (meta.channelsCount && meta.channelsCount > 1) lines.push(`• عبر **${meta.channelsCount}** قنوات`);
      if (meta.spamSessionId) lines.push(`• رقم الجلسة: \`#${meta.spamSessionId}\``);

      return {
        main: `**[Anti-Spam]** ${label}\n*${enLabel}*`,
        details: lines.length > 0 ? lines.join('\n') : null,
      };
    }
  }

  if (ctx.source === 'raid') {
    const meta = ctx.metadata;
    const lines: string[] = [];
    if (meta?.detectedMessages) lines.push(`• عدد الأعضاء الذين دخلوا: **${meta.detectedMessages}**`);
    if (meta?.windowMs) lines.push(`• خلال: **${Math.round(meta.windowMs / 1000)}** ثانية`);
    return { main: '**[Anti-Raid]** موجة دخول مشبوهة', details: lines.join('\n') || null };
  }

  if (ctx.source === 'spam_trap') {
    return {
      main: '**Honeypot Triggered** — رسالة في قناة المصيدة',
      details: 'العضو أرسل رسالة في قناة مراقبة تستخدم لاكتشاف الحسابات المخترقة.',
    };
  }

  if (ctx.source === 'external') {
    return {
      main: 'تم تنفيذ العقوبة من خارج Blade X',
      details: 'تم اكتشاف الحدث من Audit Logs. راجع Discord Audit Log للتفاصيل الكاملة.',
    };
  }

  return { main: 'لم يُحدد سبب العقوبة', details: null };
}

// ===== Duration formatter =====
function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

// ===== Embed builder =====
interface LogBuildParams {
  title: string;
  color: number;
  targetDisplay: string;
  targetId: string;
  targetAvatar: string;
  actorDisplay: string;
  reason: { main: string; details: string | null };
  durationMs: number | null;
  sourceLabel: string;
  eventId?: string | null;
}

function buildModerationEmbed(p: LogBuildParams): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(p.color)
    .setTitle(p.title)
    .setAuthor({ name: p.targetDisplay, iconURL: p.targetAvatar })
    .setThumbnail(p.targetAvatar)
    .addFields(
      { name: '👤 المستهدف', value: `${p.targetDisplay} (\`${p.targetId}\`)`, inline: false },
      { name: '🛡️ المشرف', value: p.actorDisplay, inline: false },
      { name: '📝 السبب', value: p.reason.main, inline: false },
    );

  if (p.reason.details) {
    embed.addFields({ name: '🔎 تفاصيل إضافية', value: p.reason.details.slice(0, 1024), inline: false });
  }

  if (p.durationMs) {
    embed.addFields(
      { name: '⏱️ المدة', value: formatDuration(p.durationMs), inline: true },
      { name: '📅 ينتهي', value: discordTime(Date.now() + p.durationMs, 'F'), inline: true },
    );
  }

  embed.addFields(
    { name: '📍 المصدر', value: p.sourceLabel, inline: true },
    { name: '🕐 الوقت', value: discordTime(Date.now(), 'F'), inline: true },
  );

  if (p.eventId) {
    embed.addFields({ name: '🆔 الحدث', value: `\`${p.eventId}\``, inline: false });
  }

  embed.setFooter({ text: `${config.botName} · Moderation` }).setTimestamp();
  return embed;
}

// ===== Public logging APIs =====
export async function logBanAction(opts: {
  guild: Guild;
  target: User;
  actor: User | null;
  reason: string | null;
  durationMs: number | null;
  source: 'manual' | 'antispam' | 'external' | 'bot';
  reasonContext?: Partial<ReasonContext>;
  eventId?: string | null;
}): Promise<void> {
  const reason = formatReason({
    source: opts.source,
    manualReason: opts.reason,
    metadata: opts.reasonContext?.metadata,
  });

  const eventId = opts.eventId ?? `ban_${opts.target.id}_${Date.now()}`;
  try {
    logModerationEventFull({
      event_id: eventId,
      guild_id: opts.guild.id,
      action: 'ban',
      target_id: opts.target.id,
      moderator_id: opts.actor?.id ?? null,
      reason: opts.reason,
      extra_details: reason.details,
      duration_ms: opts.durationMs,
      source: opts.source,
      actor_confidence: opts.actor ? 'high' : 'unknown',
    });
  } catch (e) { console.error('[Blade X] logBanAction db error:', e); }

  const ch = getLogChannel(opts.guild, 'logs_ban_channel_id');
  if (!ch) return;

  const embed = buildModerationEmbed({
    title: `${getEmoji('log_moderation', '🔨')} Member Banned`,
    color: 0xed4245,
    targetDisplay: opts.target.tag,
    targetId: opts.target.id,
    targetAvatar: opts.target.displayAvatarURL(),
    actorDisplay: opts.actor ? `<@${opts.actor.id}> (\`${opts.actor.id}\`)` : '*غير معروف*',
    reason,
    durationMs: opts.durationMs,
    sourceLabel:
      opts.source === 'antispam' ? 'Anti-Spam' :
      opts.source === 'manual' ? 'Moderation Command' :
      opts.source === 'external' ? 'External' : 'Bot',
    eventId,
  });

  try { await ch.send({ embeds: [embed] }); }
  catch (e) { console.error('[Blade X] ❌ ban log:', e); }
}

export async function logTimeoutAction(opts: {
  guild: Guild;
  target: GuildMember;
  actor: User | null;
  reason: string | null;
  durationMs: number | null;
  source: 'manual' | 'antispam' | 'bot';
  reasonContext?: Partial<ReasonContext>;
  eventId?: string | null;
}): Promise<void> {
  const reason = formatReason({
    source: opts.source,
    manualReason: opts.reason,
    metadata: opts.reasonContext?.metadata,
  });

  const eventId = opts.eventId ?? `timeout_${opts.target.id}_${Date.now()}`;
  try {
    logModerationEventFull({
      event_id: eventId,
      guild_id: opts.guild.id,
      action: 'timeout',
      target_id: opts.target.id,
      moderator_id: opts.actor?.id ?? null,
      reason: opts.reason,
      extra_details: reason.details,
      duration_ms: opts.durationMs,
      source: opts.source,
      actor_confidence: opts.actor ? 'high' : 'unknown',
    });
  } catch (e) { console.error('[Blade X] logTimeoutAction db error:', e); }

  const ch = getLogChannel(opts.guild, 'logs_timeout_channel_id');
  if (!ch) return;

  const embed = buildModerationEmbed({
    title: `${getEmoji('warning', '⏱️')} Member Timed Out`,
    color: 0xf59e0b,
    targetDisplay: opts.target.user.tag,
    targetId: opts.target.id,
    targetAvatar: opts.target.user.displayAvatarURL(),
    actorDisplay: opts.actor ? `<@${opts.actor.id}>` : '*غير معروف*',
    reason,
    durationMs: opts.durationMs,
    sourceLabel: opts.source === 'antispam' ? 'Anti-Spam' : 'Moderation Command',
    eventId,
  });

  try { await ch.send({ embeds: [embed] }); }
  catch (e) { console.error('[Blade X] ❌ timeout log:', e); }
}

export async function logUnbanAction(guild: Guild, target: User, actor: User | null): Promise<void> {
  try {
    logModerationEventFull({
      event_id: null,
      guild_id: guild.id,
      action: 'unban',
      target_id: target.id,
      moderator_id: actor?.id ?? null,
      reason: null,
      extra_details: null,
      duration_ms: null,
      source: 'manual',
      actor_confidence: actor ? 'high' : 'unknown',
    });
  } catch (e) { console.error('[Blade X] logUnbanAction db error:', e); }

  const ch = getLogChannel(guild, 'logs_unban_channel_id');
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`${getEmoji('success', '🔓')} Member Unbanned`)
    .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: '👤 المستهدف', value: `${target} (\`${target.id}\`)`, inline: false },
      { name: '🛡️ المشرف', value: actor ? `<@${actor.id}>` : '*غير معروف*', inline: false },
      { name: '🕐 الوقت', value: discordTime(Date.now(), 'F'), inline: false },
    )
    .setFooter({ text: `${config.botName} · Unban` });

  try { await ch.send({ embeds: [embed] }); }
  catch (e) { console.error('[Blade X] ❌ unban log:', e); }
}

export async function logUntimeoutAction(guild: Guild, target: GuildMember, actor: User | null): Promise<void> {
  try {
    logModerationEventFull({
      event_id: null,
      guild_id: guild.id,
      action: 'untimeout',
      target_id: target.id,
      moderator_id: actor?.id ?? null,
      reason: null,
      extra_details: null,
      duration_ms: null,
      source: 'manual',
      actor_confidence: actor ? 'high' : 'unknown',
    });
  } catch (e) { console.error('[Blade X] logUntimeoutAction db error:', e); }

  const ch = getLogChannel(guild, 'logs_untimeout_channel_id');
  if (!ch) return;

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(`${getEmoji('success', '🔓')} Timeout Removed`)
    .setAuthor({ name: target.user.tag, iconURL: target.user.displayAvatarURL() })
    .setThumbnail(target.user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: '👤 المستهدف', value: `${target} (\`${target.id}\`)`, inline: false },
      { name: '🛡️ بواسطة', value: actor ? `<@${actor.id}>` : '*غير معروف*', inline: false },
      { name: '🕐 الوقت', value: discordTime(Date.now(), 'F'), inline: false },
    )
    .setFooter({ text: `${config.botName} · Timeout Removed` });

  try { await ch.send({ embeds: [embed] }); }
  catch (e) { console.error('[Blade X] ❌ untimeout log:', e); }
}

// ===== Event listeners =====
export function registerModerationLogs(client: Client): void {
  client.on(Events.GuildBanAdd, async (ban: GuildBan) => {
    try {
      const guild = ban.guild;
      const recentKey = getSetting('__ban_skip_' + ban.user.id);
      if (recentKey && Date.now() - Number(recentKey) < 3000) return;

      const audit = await resolveActorFromAudit(guild, AuditLogEvent.MemberBanAdd, ban.user.id);
      const isSelf = audit.actorId === client.user?.id;
      const actor = audit.actorId
        ? await client.users.fetch(audit.actorId).catch(() => null)
        : null;

      await logBanAction({
        guild,
        target: ban.user,
        actor,
        // ✅ ban.reason قد يكون undefined — نحوّله إلى null
        reason: ban.reason ?? null,
        durationMs: null,
        source: isSelf ? 'bot' : 'external',
      });
    } catch (e) { console.error('[Blade X] ❌ GuildBanAdd:', e); }
  });

  client.on(Events.GuildBanRemove, async (ban: GuildBan) => {
    try {
      const audit = await resolveActorFromAudit(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
      const actor = audit.actorId
        ? await client.users.fetch(audit.actorId).catch(() => null)
        : null;
      await logUnbanAction(ban.guild, ban.user, actor);
    } catch (e) { console.error('[Blade X] ❌ GuildBanRemove:', e); }
  });

  // ✅ oldMember قد يكون PartialGuildMember
  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      const wasTimedOut = !!oldMember.communicationDisabledUntilTimestamp;
      const isTimedOut = !!newMember.communicationDisabledUntilTimestamp;

      if (!wasTimedOut && isTimedOut) {
        const audit = await resolveActorFromAudit(
          newMember.guild,
          AuditLogEvent.MemberUpdate,
          newMember.id,
        );
        const actor = audit.actorId
          ? await client.users.fetch(audit.actorId).catch(() => null)
          : null;
        const durationMs = newMember.communicationDisabledUntilTimestamp
          ? newMember.communicationDisabledUntilTimestamp - Date.now()
          : null;
        const isSelf = audit.actorId === client.user?.id;

        await logTimeoutAction({
          guild: newMember.guild,
          target: newMember,
          actor,
          reason: null,
          durationMs,
          source: isSelf ? 'bot' : 'manual',
        });
      } else if (wasTimedOut && !isTimedOut) {
        const audit = await resolveActorFromAudit(
          newMember.guild,
          AuditLogEvent.MemberUpdate,
          newMember.id,
        );
        const actor = audit.actorId
          ? await client.users.fetch(audit.actorId).catch(() => null)
          : null;
        await logUntimeoutAction(newMember.guild, newMember, actor);
      }
    } catch (e) { console.error('[Blade X] ❌ GuildMemberUpdate:', e); }
  });

  console.log('[Blade X] ✅ Moderation Logs registered');
}