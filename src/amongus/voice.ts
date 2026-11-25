// ============================================================
// Blade X — Among Us Manager · Voice control
// Safety-first server-mute management with external override detection.
// ============================================================

import {
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
  type VoiceState,
} from 'discord.js';
import {
  addAmongUsPlayer,
  getActiveAmongUsSession,
  getAmongUsPendingRestores,
  getAmongUsPlayer,
  getAmongUsSettings,
  updateAmongUsPlayer,
} from './database.js';
import { notifyHost, recordEvent } from './logger.js';
import type { AmongUsPlayer, AmongUsSettings } from './types.js';
import { decideRestoreAction, decideVoiceAction } from './voiceLogic.js';

export interface VoiceActionResult {
  ok: boolean;
  action: 'muted' | 'unmuted' | 'unchanged';
  reason?: string;
  currentServerMute?: boolean;
  error?: string;
}

// Bot-initiated changes are recorded here so VoiceStateUpdate does not
// mistake the bot's own action for an external override.
const pendingChanges = new Map<string, { expected: boolean; expires: number }>();
const PENDING_TTL_MS = 15_000;

function pendingKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

export function markPendingVoiceChange(guildId: string, userId: string, expected: boolean): void {
  pendingChanges.set(pendingKey(guildId, userId), {
    expected,
    expires: Date.now() + PENDING_TTL_MS,
  });
}

export function consumePendingVoiceChange(
  guildId: string,
  userId: string,
  actual: boolean,
): boolean {
  const key = pendingKey(guildId, userId);
  const entry = pendingChanges.get(key);
  if (!entry) return false;
  pendingChanges.delete(key);
  if (entry.expires < Date.now()) return false;
  return entry.expected === actual;
}

function botCanMute(guild: Guild): boolean {
  const me = guild.members.me;
  return !!me && me.permissions.has(PermissionFlagsBits.MuteMembers);
}

/**
 * Apply the phase-required mute state to one participant.
 * Never touches members outside the fixed voice room.
 */
export async function applyPlayerMute(
  guild: Guild,
  member: GuildMember,
  player: AmongUsPlayer,
  shouldMute: boolean,
  voiceChannelId: string | null,
  reason: string,
): Promise<VoiceActionResult> {
  if (!voiceChannelId) {
    return { ok: false, action: 'unchanged', reason: 'no-voice-channel' };
  }
  if (member.voice.channelId !== voiceChannelId) {
    return {
      ok: false,
      action: 'unchanged',
      reason: 'not-in-room',
      currentServerMute: !!member.voice.serverMute,
    };
  }
  if (!botCanMute(guild)) {
    return {
      ok: false,
      action: 'unchanged',
      reason: 'missing-permission',
      currentServerMute: !!member.voice.serverMute,
    };
  }

  const current = !!member.voice.serverMute;
  const decision = decideVoiceAction({
    shouldMute,
    currentServerMute: current,
    originalServerMute: player.original_server_mute === 1,
    botManagedMute: player.bot_managed_mute === 1,
    externalOverride: player.external_override === 1,
  });

  if (decision.action === 'none') {
    return {
      ok: true,
      action: 'unchanged',
      reason: decision.reason,
      currentServerMute: current,
    };
  }

  markPendingVoiceChange(guild.id, member.id, decision.action === 'mute');
  try {
    await member.voice.setMute(decision.action === 'mute', reason);
    return {
      ok: true,
      action: decision.action === 'mute' ? 'muted' : 'unmuted',
      currentServerMute: decision.action === 'mute',
    };
  } catch (e: unknown) {
    pendingChanges.delete(pendingKey(guild.id, member.id));
    return {
      ok: false,
      action: 'unchanged',
      reason: 'discord-api-error',
      currentServerMute: current,
      error: (e as { message?: string })?.message ?? String(e),
    };
  }
}

/**
 * Restore a participant at the end of a round/session.
 * Only restores mutes the bot itself applied.
 *
 * A participant who moved to another voice channel is still restored: leaving
 * them server-muted outside the game room would be harmful. The decision
 * matrix still refuses originally-muted and externally-muted members.
 */
export async function restorePlayerMute(
  guild: Guild,
  member: GuildMember,
  player: AmongUsPlayer,
  voiceChannelId: string | null,
  reason: string,
): Promise<VoiceActionResult> {
  if (!voiceChannelId) {
    return { ok: false, action: 'unchanged', reason: 'no-voice-channel' };
  }
  if (!member.voice.channelId) {
    return {
      ok: false,
      action: 'unchanged',
      reason: 'not-in-room',
      currentServerMute: !!member.voice.serverMute,
    };
  }
  if (!botCanMute(guild)) {
    return {
      ok: false,
      action: 'unchanged',
      reason: 'missing-permission',
      currentServerMute: !!member.voice.serverMute,
    };
  }

  const current = !!member.voice.serverMute;
  const decision = decideRestoreAction({
    currentServerMute: current,
    originalServerMute: player.original_server_mute === 1,
    botManagedMute: player.bot_managed_mute === 1,
    externalOverride: player.external_override === 1,
  });

  if (decision.action === 'none') {
    return {
      ok: true,
      action: 'unchanged',
      reason: decision.reason,
      currentServerMute: current,
    };
  }

  markPendingVoiceChange(guild.id, member.id, false);
  try {
    await member.voice.setMute(false, reason);
    return { ok: true, action: 'unmuted', currentServerMute: false };
  } catch (e: unknown) {
    pendingChanges.delete(pendingKey(guild.id, member.id));
    return {
      ok: false,
      action: 'unchanged',
      reason: 'discord-api-error',
      currentServerMute: current,
      error: (e as { message?: string })?.message ?? String(e),
    };
  }
}

/** Persist the result of a voice action and collect host-facing warnings. */
export async function persistVoiceResult(
  sessionId: string,
  player: AmongUsPlayer,
  result: VoiceActionResult,
  requestedMute: boolean,
  warnings: string[],
): Promise<void> {
  const label = player.display_name ?? `<@${player.user_id}>`;

  if (result.ok && result.action === 'muted') {
    await updateAmongUsPlayer(sessionId, player.user_id, {
      bot_managed_mute: 1,
      expected_server_mute: 1,
      external_override: 0,
    });
    return;
  }

  if (result.ok && result.action === 'unmuted') {
    await updateAmongUsPlayer(sessionId, player.user_id, {
      bot_managed_mute: 0,
      expected_server_mute: 0,
    });
    return;
  }

  if (result.ok) {
    switch (result.reason) {
      case 'original-mute':
        await updateAmongUsPlayer(sessionId, player.user_id, {
          bot_managed_mute: 0,
          expected_server_mute: 1,
        });
        return;
      case 'already-muted':
        await updateAmongUsPlayer(sessionId, player.user_id, {
          expected_server_mute: 1,
        });
        return;
      case 'already-unmuted':
        await updateAmongUsPlayer(sessionId, player.user_id, {
          expected_server_mute: 0,
        });
        return;
      case 'external-mute':
      case 'external-unmute':
      case 'external-override':
      case 'not-bot-managed':
        await updateAmongUsPlayer(sessionId, player.user_id, {
          external_override: 1,
          expected_server_mute: result.currentServerMute ? 1 : 0,
        });
        warnings.push(`${label}: تم رصد تعديل مايك خارجي — لن يتدخل البوت.`);
        return;
      case 'not-in-room':
        await updateAmongUsPlayer(sessionId, player.user_id, { is_connected: 0 });
        return;
      case 'missing-permission':
        warnings.push(`${label}: البوت لا يملك صلاحية Mute Members.`);
        return;
      default:
        return;
    }
  }

  warnings.push(`${label}: فشل تعديل المايك — ${result.error ?? result.reason ?? 'خطأ غير معروف'}`);
  if (requestedMute && player.bot_managed_mute === 1) {
    // Keep the DB flag so a later restore/rejoin can retry safely.
    await updateAmongUsPlayer(sessionId, player.user_id, { expected_server_mute: 1 });
  }
}

async function restorePendingForUser(
  guild: Guild,
  member: GuildMember,
): Promise<void> {
  const rows = await getAmongUsPendingRestores(guild.id, member.id);
  for (const row of rows) {
    if (!row.session_voice_channel_id) continue;
    if (member.voice.channelId !== row.session_voice_channel_id) continue;
    const result = await restorePlayerMute(
      guild,
      member,
      row,
      row.session_voice_channel_id,
      'Among Us: restore mute after rejoin',
    );
    if (result.ok) {
      await updateAmongUsPlayer(row.session_id, row.user_id, {
        restore_on_rejoin: 0,
        bot_managed_mute: result.action === 'unmuted' ? 0 : row.bot_managed_mute,
        expected_server_mute: result.action === 'unmuted' ? 0 : row.expected_server_mute,
      });
    }
  }
}

async function applyPhaseToSinglePlayer(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  phase: string,
  player: AmongUsPlayer,
): Promise<string[]> {
  const warnings: string[] = [];
  if (player.player_status === 'pending' || !player.is_connected) return warnings;
  if (phase !== 'in_game' && phase !== 'meeting') return warnings;

  const member = await guild.members.fetch(player.user_id).catch(() => null);
  if (!member) {
    await updateAmongUsPlayer(sessionId, player.user_id, { is_connected: 0 });
    return warnings;
  }

  const shouldMute = phase === 'in_game' ? true : player.player_status === 'dead';
  const result = await applyPlayerMute(
    guild,
    member,
    player,
    shouldMute,
    settings.voice_channel_id,
    `Among Us: ${phase}`,
  );
  await persistVoiceResult(sessionId, player, result, shouldMute, warnings);
  return warnings;
}

/** VoiceStateUpdate entry point for Among Us Manager. */
export async function handleAmongUsVoiceState(
  client: Client,
  oldState: VoiceState,
  newState: VoiceState,
): Promise<void> {
  const guild = newState.guild;
  if (!guild) return;
  const member = newState.member ?? oldState.member;
  if (!member || member.user.bot) return;

  const settings = await getAmongUsSettings(guild.id);
  if (!settings || settings.setup_completed !== 1) return;

  const wasInRoom = !!settings.voice_channel_id && oldState.channelId === settings.voice_channel_id;
  const isInRoom = !!settings.voice_channel_id && newState.channelId === settings.voice_channel_id;

  // A player who left while the bot was managing their mute gets it restored
  // when they rejoin the fixed room (only after a round/session ended).
  if (!wasInRoom && isInRoom) {
    await restorePendingForUser(guild, member);
  }

  const session = await getActiveAmongUsSession(guild.id);
  if (!session) return;

  const participant = await getAmongUsPlayer(session.session_id, member.id);
  const serverMuteChanged = oldState.serverMute !== newState.serverMute;

  if (serverMuteChanged) {
    const expected = !!newState.serverMute;
    const isBotChange = consumePendingVoiceChange(guild.id, member.id, expected);
    if (!isBotChange && participant) {
      await updateAmongUsPlayer(session.session_id, member.id, {
        external_override: 1,
        expected_server_mute: expected ? 1 : 0,
      });
      await recordEvent({
        guildId: guild.id,
        sessionId: session.session_id,
        actorUserId: null,
        action: 'external_mute_override',
        targetUserId: member.id,
        previousState: oldState.serverMute ? 'server-muted' : 'server-unmuted',
        newState: newState.serverMute ? 'server-muted' : 'server-unmuted',
        logText: `⚠️ تعديل Server Mute خارجي على ${member} — تم احترامه وعدم التدخل.`,
        notifyHostText: `⚠️ تم رصد تعديل Server Mute خارجي على ${member}. لن يعيد البوت فرض حالته. راجع اللاعب من Manage Players.`,
        notifyKey: `override:${member.id}`,
        client,
        guild,
        settings,
        session,
      });
    }
  }

  if (participant) {
    if (!wasInRoom && isInRoom) {
      await updateAmongUsPlayer(session.session_id, member.id, { is_connected: 1 });
      if (participant.player_status === 'pending') {
        await recordEvent({
          guildId: guild.id,
          sessionId: session.session_id,
          action: 'pending_player_joined',
          targetUserId: member.id,
          newState: 'connected',
          client,
          guild,
          settings,
          session,
          notifyHostText: `🟡 ${member} دخل الروم أثناء الجلسة وهو Pending. أضفه من Manage Players إن أردت.`,
          notifyKey: `pending-join:${member.id}`,
        });
      } else {
        const warnings = await applyPhaseToSinglePlayer(
          guild,
          settings,
          session.session_id,
          session.current_phase,
          participant,
        );
        if (warnings.length > 0) {
          await recordEvent({
            guildId: guild.id,
            sessionId: session.session_id,
            action: 'voice_rejoin_warning',
            targetUserId: member.id,
            newState: warnings.join(' | ').slice(0, 1000),
            client,
            guild,
            settings,
            session,
          });
        }
      }
      return;
    }

    if (wasInRoom && !isInRoom) {
      await updateAmongUsPlayer(session.session_id, member.id, { is_connected: 0 });
      await recordEvent({
        guildId: guild.id,
        sessionId: session.session_id,
        action: 'participant_left_room',
        targetUserId: member.id,
        previousState: 'connected',
        newState: 'disconnected',
        logText: `🚪 ${member} غادر الروم الصوتي — تم الاحتفاظ بحالته.`,
        client,
        guild,
        settings,
        session,
      });
    }
    return;
  }

  // Non-participant joined the fixed room during a live round.
  if (!wasInRoom && isInRoom && (session.current_phase === 'in_game' || session.current_phase === 'meeting')) {
    const originalMute = member.voice.serverMute ? 1 : 0;
    await addAmongUsPlayer({
      session_id: session.session_id,
      guild_id: guild.id,
      user_id: member.id,
      display_name: member.displayName,
      player_status: 'pending',
      is_connected: 1,
      original_server_mute: originalMute,
      bot_managed_mute: 0,
      external_override: 0,
      expected_server_mute: originalMute,
      restore_on_rejoin: 0,
    });
    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      action: 'pending_player_added',
      targetUserId: member.id,
      newState: 'pending',
      logText: `🟡 ${member} دخل الروم أثناء جولة نشطة — أُضيف كـ Pending.`,
      client,
      guild,
      settings,
      session,
      notifyHostText: `🟡 ${member} دخل الروم أثناء الجولة وأصبح Pending. لم يتم كتمه تلقائيًا. أضفه من Manage Players.`,
      notifyKey: `pending-new:${member.id}`,
    });
  }
}
