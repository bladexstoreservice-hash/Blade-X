import { EmbedBuilder, Guild, GuildMember, User } from 'discord.js';
import { config } from './config.js';

export const BLADE_COLOR = 0x2b2d31;

export function bladeEmbed(title?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(BLADE_COLOR).setFooter({ text: `${config.botName} · Server Management` });
  if (title) embed.setTitle(title);
  return embed;
}

export function discordTime(ms: number, style: 'F' | 'R' | 'D' | 'T' = 'F'): string {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

export function isValidSnowflake(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

export function isValidEmojiId(id: string): boolean {
  return /^\d{17,20}$/.test(id);
}

export function parseDuration(input: string): number | null {
  const match = input.trim().match(/^(\d+)\s*(m|h|d|w)$/i);
  if (!match) return null;
  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return value * multipliers[unit];
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} ثانية`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} دقيقة`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} ساعة`;
  return `${Math.round(ms / 86_400_000)} يوم`;
}

export function formatDurationEn(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} second(s)`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} minute(s)`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} hour(s)`;
  return `${Math.round(ms / 86_400_000)} day(s)`;
}

export function truncate(text: string, max = 1024): string {
  return text.length > max ? text.slice(0, max - 3) + '...' : text;
}

export function getDisplayName(member: GuildMember): string {
  return member.nickname ?? member.displayName ?? member.user.username;
}

export function accountAge(createdAt: number): number {
  return Date.now() - createdAt;
}

export function isNewAccount(createdAt: number, thresholdDays: number): boolean {
  return accountAge(createdAt) < thresholdDays * 86_400_000;
}

export async function safeDM(user: User, embed: EmbedBuilder): Promise<'sent' | 'failed'> {
  try {
    await user.send({ embeds: [embed] });
    return 'sent';
  } catch {
    return 'failed';
  }
}

export function buildAuditReason(reason: string | null): string {
  return reason && reason.trim().length > 0 ? reason : 'لم يتم تسجيل سبب.';
}

export function getModerationEmbed(
  action: string,
  target: User,
  moderator: User | null,
  reason: string | null,
  durationMs: number | null,
  guildName: string
): EmbedBuilder {
  const arMap: Record<string, string> = {
    Kick: 'طرد', kick: 'طرد',
    Ban: 'حظر', ban: 'حظر',
    Timeout: 'إسكات مؤقت', timeout: 'إسكات مؤقت',
    Warn: 'تحذير', warn: 'تحذير',
    antispam_warn: 'تحذير (مكافحة السبام)',
    antispam_timeout: 'إسكات مؤقت (مكافحة السبام)',
    antispam_kick: 'طرد (مكافحة السبام)',
    antispam_ban: 'حظر (مكافحة السبام)',
  };
  const enMap: Record<string, string> = {
    Kick: 'Kick', kick: 'Kick',
    Ban: 'Ban', ban: 'Ban',
    Timeout: 'Timeout', timeout: 'Timeout',
    Warn: 'Warning', warn: 'Warning',
    antispam_warn: 'Warning (Anti-Spam)',
    antispam_timeout: 'Timeout (Anti-Spam)',
    antispam_kick: 'Kick (Anti-Spam)',
    antispam_ban: 'Ban (Anti-Spam)',
  };

  const actionAr = arMap[action] ?? action;
  const actionEn = enMap[action] ?? action;
  const safeReason = reason?.trim() ? reason : null;
  const reasonAr = safeReason ?? 'لم يتم تسجيل سبب.';
  const reasonEn = safeReason ?? 'No reason provided.';

  const now = Date.now();
  const expiresAt = durationMs ? now + durationMs : null;

  const arPart =
    `**نوع العقوبة:** ${actionAr}\n` +
    `**السبب:** ${reasonAr}\n` +
    (durationMs ? `**المدة:** ${formatDuration(durationMs)}\n**تنتهي في:** ${discordTime(expiresAt!, 'F')}\n` : '') +
    `**التوقيت:** ${discordTime(now, 'F')}`;

  const enPart =
    `**Action:** ${actionEn}\n` +
    `**Reason:** ${reasonEn}\n` +
    (durationMs ? `**Duration:** ${formatDurationEn(durationMs)}\n**Ends at:** ${discordTime(expiresAt!, 'F')}\n` : '') +
    `**Issued at:** ${discordTime(now, 'F')}`;

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`⚔️ ${config.botName} · إشعار إداري`)
    .setDescription(
      `تم اتخاذ إجراء إداري بحقك في السيرفر **${guildName}**.\n\n` +
      arPart +
      `\n\n━━━━━━━━━━━━━━━━━━━━\n\n` +
      `An administrative action has been taken against you in **${guildName}**.\n\n` +
      enPart
    )
    .setTimestamp()
    .setFooter({ text: `${config.botName} · Moderation Notice` });
}