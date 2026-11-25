// ============================================================
// Blade X — Among Us Manager · Logging & host notifications
// ============================================================

import {
  ChannelType,
  EmbedBuilder,
  TextChannel,
  type Client,
  type Guild,
} from 'discord.js';
import { config } from '../config.js';
import { getAmongUsSettings, logAmongUsEvent } from './database.js';
import type { AmongUsSession, AmongUsSettings } from './types.js';

const hostAlertCooldown = new Map<string, number>();
const HOST_ALERT_COOLDOWN_MS = 20_000;

export interface AmongUsEventInput {
  guildId: string;
  sessionId?: string | null;
  actorUserId?: string | null;
  action: string;
  targetUserId?: string | null;
  previousState?: string | null;
  newState?: string | null;
  /** Optional text sent to the configured log channel. */
  logText?: string;
  /** Optional short text sent to the host in the control channel. */
  notifyHostText?: string;
  notifyKey?: string;
  client?: Client;
  guild?: Guild | null;
  settings?: AmongUsSettings | null;
  session?: AmongUsSession | null;
}

async function resolveLogChannel(
  client: Client | undefined,
  guild: Guild | null | undefined,
  settings: AmongUsSettings | null | undefined,
): Promise<TextChannel | null> {
  if (!settings?.log_channel_id) return null;
  try {
    const targetGuild = guild ?? (client ? client.guilds.cache.get(settings.guild_id) : null);
    if (!targetGuild) return null;
    const channel =
      targetGuild.channels.cache.get(settings.log_channel_id) ??
      (await targetGuild.channels.fetch(settings.log_channel_id).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return channel as TextChannel;
  } catch {
    return null;
  }
}

async function sendHostNotice(
  client: Client | undefined,
  guild: Guild | null | undefined,
  settings: AmongUsSettings | null | undefined,
  session: AmongUsSession | null | undefined,
  text: string,
  key: string,
): Promise<void> {
  if (!client || !settings?.control_channel_id || !session) return;
  const cooldownKey = `${settings.guild_id}:${session.session_id}:${key}`;
  const now = Date.now();
  const last = hostAlertCooldown.get(cooldownKey) ?? 0;
  if (now - last < HOST_ALERT_COOLDOWN_MS) return;
  hostAlertCooldown.set(cooldownKey, now);

  try {
    const targetGuild = guild ?? client.guilds.cache.get(settings.guild_id);
    if (!targetGuild) return;
    const channel =
      targetGuild.channels.cache.get(settings.control_channel_id) ??
      (await targetGuild.channels.fetch(settings.control_channel_id).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) return;
    await (channel as TextChannel).send({
      content: `<@${session.host_user_id}> ${text}`,
      allowedMentions: { users: [session.host_user_id] },
    });
  } catch (e) {
    console.warn('[Blade X] ⚠️ Among Us host notice failed:', e);
  }
}

/** Persist an event and mirror it to the optional log channel. */
export async function recordEvent(input: AmongUsEventInput): Promise<void> {
  try {
    await logAmongUsEvent({
      guild_id: input.guildId,
      session_id: input.sessionId ?? null,
      actor_user_id: input.actorUserId ?? null,
      action: input.action,
      target_user_id: input.targetUserId ?? null,
      previous_state: input.previousState ?? null,
      new_state: input.newState ?? null,
    });
  } catch (e) {
    console.warn('[Blade X] ⚠️ Among Us event log failed:', e);
  }

  // Control-channel host pings are intentionally disabled: all status is
  // shown inside the single control panel. Audit rows and the configured
  // log-channel embed below are preserved.

  if (!input.client) return;
  const settings = input.settings ?? (await getAmongUsSettings(input.guildId).catch(() => null));
  const channel = await resolveLogChannel(input.client, input.guild, settings);
  if (!channel) return;

  const isError = input.action.toLowerCase().includes('error');
  const embed = new EmbedBuilder()
    .setColor(isError ? 0xed4245 : 0x5865f2)
    .setTitle(`🚀 ${config.botName} · Among Us Log`)
    .setDescription(input.logText ?? `**${input.action}**`)
    .addFields(
      { name: 'Action', value: `\`${input.action}\``, inline: true },
      { name: 'Actor', value: input.actorUserId ? `<@${input.actorUserId}>` : '—', inline: true },
      { name: 'Target', value: input.targetUserId ? `<@${input.targetUserId}>` : '—', inline: true },
    )
    .setTimestamp(new Date());

  if (input.sessionId) {
    embed.addFields({ name: 'Session', value: `\`${input.sessionId}\``, inline: false });
  }
  if (input.previousState || input.newState) {
    embed.addFields({
      name: 'State',
      value: `${input.previousState ?? '—'} → ${input.newState ?? '—'}`.slice(0, 1024),
      inline: false,
    });
  }

  try {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (e) {
    console.warn('[Blade X] ⚠️ Among Us log channel send failed:', e);
  }
}

export async function notifyHost(
  client: Client,
  guild: Guild,
  settings: AmongUsSettings,
  session: AmongUsSession,
  text: string,
  key: string,
): Promise<void> {
  await sendHostNotice(client, guild, settings, session, text, key);
}
