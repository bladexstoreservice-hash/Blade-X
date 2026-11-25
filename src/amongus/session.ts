// ============================================================
// Blade X — Among Us Manager · Session lifecycle
// ============================================================

import { randomUUID } from 'node:crypto';
import { PermissionFlagsBits, type Guild, type GuildMember, type VoiceChannel } from 'discord.js';
import * as db from './database.js';
import { recordEvent } from './logger.js';
import { applyPlayerMute, persistVoiceResult, restorePlayerMute } from './voice.js';
import {
  getMeetingMuteOverride,
  notifySpeakingPhaseChange,
  notifySpeakingPlayerStatusChange,
} from './speaking/hooks.js';
import type { AmongUsPlayer, AmongUsSession, AmongUsSettings } from './types.js';

export interface ActionResult {
  ok: boolean;
  message: string;
  warnings?: string[];
  session?: AmongUsSession | null;
}

// Serialise every mutating operation per guild. This prevents double-clicks
// and conflicting actions from racing each other.
const guildChains = new Map<string, Promise<unknown>>();

export function withGuildLock<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
  const previous = guildChains.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  guildChains.set(
    guildId,
    next.catch(() => undefined),
  );
  return next;
}

function generateSessionId(): string {
  return `aus_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

export async function fetchVoiceChannel(
  guild: Guild,
  channelId: string | null,
): Promise<VoiceChannel | null> {
  if (!channelId) return null;
  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel || !channel.isVoiceBased()) return null;
  return channel as VoiceChannel;
}

function botHasMutePermission(guild: Guild): boolean {
  const me = guild.members.me;
  return !!me && me.permissions.has(PermissionFlagsBits.MuteMembers);
}

async function fetchMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.fetch(userId).catch(() => null);
}

async function participantsInRoom(
  guild: Guild,
  settings: AmongUsSettings,
): Promise<GuildMember[]> {
  const voice = await fetchVoiceChannel(guild, settings.voice_channel_id);
  if (!voice) return [];
  return [...voice.members.values()].filter((m) => !m.user.bot);
}

// ============================================================
// Create session
// ============================================================
export async function createSession(
  guild: Guild,
  settings: AmongUsSettings,
  hostId: string,
  selectedUserIds: string[],
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const existing = await db.getActiveAmongUsSession(guild.id);
    if (existing) {
      return { ok: false, message: '❌ توجد جلسة نشطة بالفعل في هذا السيرفر. أنهِها أولًا.' };
    }

    const voice = await fetchVoiceChannel(guild, settings.voice_channel_id);
    if (!voice) {
      return { ok: false, message: '❌ الروم الصوتي الثابت غير موجود. راجع الإعدادات.' };
    }

    const selected = [...new Set(selectedUserIds)].slice(0, 100);
    const members: GuildMember[] = [];
    for (const id of selected) {
      const member = await fetchMember(guild, id);
      if (!member || member.user.bot) continue;
      if (member.voice.channelId !== voice.id) continue;
      members.push(member);
    }

    if (members.length === 0) {
      return { ok: false, message: '❌ لم يتم العثور على لاعبين مؤهلين داخل الروم الصوتي.' };
    }

    const sessionId = generateSessionId();
    const created = await db.createAmongUsSession({
      session_id: sessionId,
      guild_id: guild.id,
      host_user_id: hostId,
      voice_channel_id: voice.id,
      control_channel_id: settings.control_channel_id,
      control_message_id: settings.control_message_id,
    });

    if (!created) {
      return { ok: false, message: '❌ تعذر إنشاء الجلسة — قد تكون هناك جلسة نشطة أخرى.' };
    }

    try {
      for (const member of members) {
        const originalMute = member.voice.serverMute ? 1 : 0;
        await db.addAmongUsPlayer({
          session_id: sessionId,
          guild_id: guild.id,
          user_id: member.id,
          display_name: member.displayName,
          player_status: 'alive',
          is_connected: 1,
          original_server_mute: originalMute,
          bot_managed_mute: 0,
          external_override: 0,
          expected_server_mute: originalMute,
          restore_on_rejoin: 0,
        });
      }
    } catch (e: unknown) {
      await db.endAmongUsSession(sessionId).catch(() => undefined);
      return {
        ok: false,
        message: `❌ فشل حفظ اللاعبين: ${(e as { message?: string })?.message ?? 'خطأ غير معروف'}`,
      };
    }

    const session = await db.getAmongUsSession(sessionId);
    await recordEvent({
      guildId: guild.id,
      sessionId,
      actorUserId: hostId,
      action: 'session_created',
      newState: `players:${members.length}`,
      logText: `🆕 تم إنشاء جلسة Among Us بواسطة <@${hostId}> — ${members.length} لاعب.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message: `✅ تم إنشاء الجلسة — ${members.length} لاعب في **Waiting for Players**.`,
      session,
    };
  });
}

// ============================================================
// Phase application
// ============================================================
interface PhaseApplyResult {
  warnings: string[];
  muted: number;
  unmuted: number;
  skipped: number;
}

async function applyPhaseToPlayers(
  guild: Guild,
  settings: AmongUsSettings,
  session: AmongUsSession,
  phase: 'in_game' | 'meeting',
): Promise<PhaseApplyResult> {
  const result: PhaseApplyResult = { warnings: [], muted: 0, unmuted: 0, skipped: 0 };
  const players = await db.getAmongUsPlayers(session.session_id);
  const voiceChannelId = session.voice_channel_id ?? settings.voice_channel_id;

  for (const player of players) {
    if (player.player_status === 'pending' || !player.is_connected) {
      result.skipped++;
      continue;
    }
    if (phase !== 'in_game' && phase !== 'meeting') continue;

    const member = await fetchMember(guild, player.user_id);
    if (!member) {
      await db.updateAmongUsPlayer(session.session_id, player.user_id, { is_connected: 0 });
      result.skipped++;
      continue;
    }
    if (member.voice.channelId !== voiceChannelId) {
      await db.updateAmongUsPlayer(session.session_id, player.user_id, { is_connected: 0 });
      result.skipped++;
      continue;
    }

    // Optional Speaking Manager may override the meeting mute decision.
    // When absent/disabled the hook returns null and core behaviour is unchanged.
    const speakingMute = await getMeetingMuteOverride(session.session_id, player);
    const shouldMute = speakingMute ?? (phase === 'in_game' ? true : player.player_status === 'dead');
    const voiceResult = await applyPlayerMute(
      guild,
      member,
      player,
      shouldMute,
      voiceChannelId,
      `Among Us: ${phase}`,
    );
    await persistVoiceResult(session.session_id, player, voiceResult, shouldMute, result.warnings);
    if (voiceResult.action === 'muted') result.muted++;
    else if (voiceResult.action === 'unmuted') result.unmuted++;
    else result.skipped++;
  }

  return result;
}

async function applyPhaseToPlayer(
  guild: Guild,
  settings: AmongUsSettings,
  session: AmongUsSession,
  player: AmongUsPlayer,
): Promise<string[]> {
  const warnings: string[] = [];
  if (player.player_status === 'pending') return warnings;
  if (session.current_phase !== 'in_game' && session.current_phase !== 'meeting') return warnings;
  if (!player.is_connected) return warnings;

  const member = await fetchMember(guild, player.user_id);
  const voiceChannelId = session.voice_channel_id ?? settings.voice_channel_id;
  if (!member || member.voice.channelId !== voiceChannelId) {
    await db.updateAmongUsPlayer(session.session_id, player.user_id, { is_connected: 0 });
    return warnings;
  }

  const speakingMute = await getMeetingMuteOverride(session.session_id, player);
  const shouldMute =
    speakingMute ?? (session.current_phase === 'in_game' ? true : player.player_status === 'dead');
  const result = await applyPlayerMute(
    guild,
    member,
    player,
    shouldMute,
    voiceChannelId,
    `Among Us: ${session.current_phase}`,
  );
  await persistVoiceResult(session.session_id, player, result, shouldMute, warnings);
  return warnings;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'in_game':
      return 'In Game';
    case 'meeting':
      return 'Meeting';
    case 'round_ended':
      return 'Round Ended';
    case 'waiting':
      return 'Waiting for Players';
    case 'ended':
      return 'Session Ended';
    default:
      return phase;
  }
}

async function validateSession(sessionId: string, guildId: string): Promise<AmongUsSession | null> {
  const session = await db.getAmongUsSession(sessionId);
  if (!session || session.guild_id !== guildId || session.status !== 'active') return null;
  return session;
}

// ============================================================
// Start / meeting / resume
// ============================================================
export async function startGame(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    if (session.current_phase !== 'waiting' && session.current_phase !== 'round_ended') {
      return { ok: false, message: '❌ لا يمكن بدء الجولة في المرحلة الحالية.' };
    }
    if (!settings.voice_channel_id && !session.voice_channel_id) {
      return { ok: false, message: '❌ الروم الصوتي غير مضبوط.' };
    }
    const voice = await fetchVoiceChannel(
      guild,
      session.voice_channel_id ?? settings.voice_channel_id,
    );
    if (!voice) return { ok: false, message: '❌ الروم الصوتي الثابت غير موجود.' };
    if (!botHasMutePermission(guild)) {
      return { ok: false, message: '❌ البوت لا يملك صلاحية **Mute Members**.' };
    }

    const players = await db.getAmongUsPlayers(session.session_id);
    const eligible = players.filter((p) => p.player_status !== 'pending' && p.is_connected === 1);
    if (eligible.length === 0) {
      return { ok: false, message: '❌ لا يوجد لاعبون متصلون داخل الروم.' };
    }

    await db.setAmongUsSessionPhase(session.session_id, 'in_game', `Game started by <@${actorId}>`);
    await db.setAmongUsSessionRecovery(session.session_id, false);
    await notifySpeakingPhaseChange(session.session_id, 'in_game', actorId);
    const applied = await applyPhaseToPlayers(guild, settings, session, 'in_game');

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'game_started',
      newState: `muted:${applied.muted}, skipped:${applied.skipped}`,
      logText: `▶️ بدأ <@${actorId}> الجولة — كتم ${applied.muted} لاعبًا.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message:
        `▶️ تم بدء الجولة — **${phaseLabel('in_game')}**.\n` +
        `🔇 كتم: ${applied.muted} · ⏭️ متجاوز: ${applied.skipped}` +
        (applied.warnings.length > 0 ? `\n⚠️ ${applied.warnings.slice(0, 5).join('\n⚠️ ')}` : ''),
      warnings: applied.warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

export async function startMeeting(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    if (session.current_phase !== 'in_game') {
      return { ok: false, message: '❌ يمكن بدء الاجتماع أثناء الجولة فقط.' };
    }
    if (!botHasMutePermission(guild)) {
      return { ok: false, message: '❌ البوت لا يملك صلاحية **Mute Members**.' };
    }

    await db.setAmongUsSessionPhase(session.session_id, 'meeting', `Meeting started by <@${actorId}>`);
    // Initialise the optional layer BEFORE mics are applied so only the
    // correct state is written (no unmuting everyone then re-muting them).
    await notifySpeakingPhaseChange(session.session_id, 'meeting', actorId);
    const applied = await applyPhaseToPlayers(guild, settings, session, 'meeting');

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'meeting_started',
      newState: `unmuted:${applied.unmuted}, skipped:${applied.skipped}`,
      logText: `🚨 بدأ <@${actorId}> الاجتماع — فتح مايك ${applied.unmuted} لاعبًا حيًا.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message:
        `🚨 تم بدء الاجتماع — **${phaseLabel('meeting')}**.\n` +
        `🔊 فتح مايك: ${applied.unmuted} · ⏭️ متجاوز: ${applied.skipped}` +
        (applied.warnings.length > 0 ? `\n⚠️ ${applied.warnings.slice(0, 5).join('\n⚠️ ')}` : ''),
      warnings: applied.warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

export async function resumeGame(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    if (session.current_phase !== 'meeting') {
      return { ok: false, message: '❌ Resume Game متاح أثناء الاجتماع فقط.' };
    }
    if (!botHasMutePermission(guild)) {
      return { ok: false, message: '❌ البوت لا يملك صلاحية **Mute Members**.' };
    }

    await db.setAmongUsSessionPhase(session.session_id, 'in_game', `Game resumed by <@${actorId}>`);
    await notifySpeakingPhaseChange(session.session_id, 'in_game', actorId);
    const applied = await applyPhaseToPlayers(guild, settings, session, 'in_game');

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'game_resumed',
      newState: `muted:${applied.muted}, skipped:${applied.skipped}`,
      logText: `⏯️ استأنف <@${actorId}> الجولة — كتم ${applied.muted} لاعبًا.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message:
        `⏯️ تم استئناف الجولة — **${phaseLabel('in_game')}**.\n` +
        `🔇 كتم: ${applied.muted} · ⏭️ متجاوز: ${applied.skipped}` +
        (applied.warnings.length > 0 ? `\n⚠️ ${applied.warnings.slice(0, 5).join('\n⚠️ ')}` : ''),
      warnings: applied.warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

// ============================================================
// Restore / end
// ============================================================
async function restoreAllPlayers(
  guild: Guild,
  settings: AmongUsSettings,
  session: AmongUsSession,
  reason: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const players = await db.getAmongUsPlayers(session.session_id);
  const voiceChannelId = session.voice_channel_id ?? settings.voice_channel_id;

  for (const player of players) {
    if (player.player_status === 'pending') continue;

    const member = await fetchMember(guild, player.user_id);
    if (!member) {
      await db.updateAmongUsPlayer(session.session_id, player.user_id, {
        is_connected: 0,
        restore_on_rejoin: player.bot_managed_mute === 1 ? 1 : player.restore_on_rejoin,
      });
      continue;
    }

    // Keep connectivity accurate without blocking a safe restore.
    if (member.voice.channelId !== voiceChannelId) {
      await db.updateAmongUsPlayer(session.session_id, player.user_id, { is_connected: 0 });
    }

    // Not connected to any voice channel: retry when they rejoin.
    if (!member.voice.channelId) {
      if (player.bot_managed_mute === 1) {
        await db.updateAmongUsPlayer(session.session_id, player.user_id, { restore_on_rejoin: 1 });
      }
      continue;
    }

    const result = await restorePlayerMute(
      guild,
      member,
      player,
      voiceChannelId,
      reason,
    );

    if (result.ok && result.action === 'unmuted') {
      await db.updateAmongUsPlayer(session.session_id, player.user_id, {
        bot_managed_mute: 0,
        expected_server_mute: 0,
        restore_on_rejoin: 0,
      });
    } else if (result.reason === 'original-mute') {
      await db.updateAmongUsPlayer(session.session_id, player.user_id, {
        bot_managed_mute: 0,
        expected_server_mute: 1,
        restore_on_rejoin: 0,
      });
    } else if (
      result.reason === 'external-override' ||
      result.reason === 'not-bot-managed' ||
      result.reason === 'already-unmuted'
    ) {
      await db.updateAmongUsPlayer(session.session_id, player.user_id, {
        bot_managed_mute: 0,
        restore_on_rejoin: 0,
      });
    } else if (!result.ok) {
      warnings.push(
        `${player.display_name ?? `<@${player.user_id}>`}: تعذر استعادة المايك — ${
          result.error ?? result.reason ?? 'خطأ غير معروف'
        }`,
      );
      if (player.bot_managed_mute === 1) {
        await db.updateAmongUsPlayer(session.session_id, player.user_id, { restore_on_rejoin: 1 });
      }
    }
  }

  return warnings;
}

export async function endRound(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    if (session.current_phase !== 'in_game' && session.current_phase !== 'meeting') {
      return { ok: false, message: '❌ لا توجد جولة نشطة لإنهائها.' };
    }

    // Stop any optional speaking queue before mics are restored.
    await notifySpeakingPhaseChange(session.session_id, 'round_ended', actorId);
    const warnings = await restoreAllPlayers(guild, settings, session, 'Among Us: round ended');

    // Keep the participant list, but reset death markers for the next round.
    const players = await db.getAmongUsPlayers(session.session_id);
    for (const player of players) {
      if (player.player_status === 'dead') {
        await db.updateAmongUsPlayer(session.session_id, player.user_id, {
          player_status: 'alive',
        });
      }
    }

    await db.setAmongUsSessionPhase(
      session.session_id,
      'round_ended',
      `Round ended by <@${actorId}>`,
    );

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'round_ended',
      newState: 'round_ended',
      logText: `🏁 أنهى <@${actorId}> الجولة — تمت استعادة المايكات وإعادة تعيين حالات الموت.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message:
        '🏁 تم إنهاء الجولة — **Round Ended**.\n' +
        'تمت استعادة حالات المايك التي يديرها البوت، وبقيت قائمة المشاركين.' +
        (warnings.length > 0 ? `\n⚠️ ${warnings.slice(0, 5).join('\n⚠️ ')}` : ''),
      warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

export async function endSession(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };

    await notifySpeakingPhaseChange(session.session_id, 'ended', actorId);
    const warnings = await restoreAllPlayers(guild, settings, session, 'Among Us: session ended');
    await db.endAmongUsSession(session.session_id);

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'session_ended',
      newState: 'ended',
      logText: `⛔ أنهى <@${actorId}> جلسة Among Us.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message:
        '⛔ تم إنهاء الجلسة.\n' +
        'تمت استعادة المايكات التي غيّرها البوت فقط، مع احترام الكتم الأصلي والتعديلات الخارجية.' +
        (warnings.length > 0 ? `\n⚠️ ${warnings.slice(0, 5).join('\n⚠️ ')}` : ''),
      warnings,
      session: null,
    };
  });
}

// ============================================================
// Player actions
// ============================================================
export async function markPlayerDead(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  targetUserId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    const player = await db.getAmongUsPlayer(session.session_id, targetUserId);
    if (!player) return { ok: false, message: '❌ اللاعب غير موجود في الجلسة.' };
    if (player.player_status === 'pending') {
      return { ok: false, message: '❌ اللاعب Pending — اقبله كلاعب أولًا.' };
    }

    await db.updateAmongUsPlayer(session.session_id, player.user_id, { player_status: 'dead' });
    await notifySpeakingPlayerStatusChange(session.session_id, player.user_id, 'dead', actorId);
    const updated = await db.getAmongUsPlayer(session.session_id, player.user_id);
    const warnings = updated ? await applyPhaseToPlayer(guild, settings, session, updated) : [];

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'player_dead',
      targetUserId: player.user_id,
      previousState: player.player_status,
      newState: 'dead',
      logText: `💀 حدد <@${actorId}> ${player.display_name ?? `<@${player.user_id}>`} كلاعب ميت.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message: `💀 تم تحديد ${player.display_name ?? `<@${player.user_id}>`} كـ **Dead**.` +
        (warnings.length > 0 ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''),
      warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

export async function restorePlayerAlive(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  targetUserId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    const player = await db.getAmongUsPlayer(session.session_id, targetUserId);
    if (!player) return { ok: false, message: '❌ اللاعب غير موجود في الجلسة.' };
    if (player.player_status === 'pending') {
      return { ok: false, message: '❌ اللاعب Pending — اقبله كلاعب أولًا.' };
    }

    await db.updateAmongUsPlayer(session.session_id, player.user_id, { player_status: 'alive' });
    await notifySpeakingPlayerStatusChange(session.session_id, player.user_id, 'alive', actorId);
    const updated = await db.getAmongUsPlayer(session.session_id, player.user_id);
    const warnings = updated ? await applyPhaseToPlayer(guild, settings, session, updated) : [];

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'player_alive',
      targetUserId: player.user_id,
      previousState: player.player_status,
      newState: 'alive',
      logText: `🟢 أعاد <@${actorId}> ${player.display_name ?? `<@${player.user_id}>`} إلى حالة حي.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message: `🟢 تمت إعادة ${player.display_name ?? `<@${player.user_id}>`} إلى **Alive**.` +
        (warnings.length > 0 ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''),
      warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

export async function acceptPendingPlayer(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  targetUserId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    const player = await db.getAmongUsPlayer(session.session_id, targetUserId);
    if (!player) return { ok: false, message: '❌ اللاعب غير موجود في الجلسة.' };

    await db.updateAmongUsPlayer(session.session_id, player.user_id, {
      player_status: 'alive',
      is_connected: 1,
    });
    const updated = await db.getAmongUsPlayer(session.session_id, player.user_id);
    const warnings = updated ? await applyPhaseToPlayer(guild, settings, session, updated) : [];

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'pending_accepted',
      targetUserId: player.user_id,
      previousState: 'pending',
      newState: 'alive',
      logText: `✅ قبل <@${actorId}> ${player.display_name ?? `<@${player.user_id}>`} كلاعب في الجلسة.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message: `✅ تم قبول ${player.display_name ?? `<@${player.user_id}>`} كلاعب.` +
        (warnings.length > 0 ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''),
      warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

export async function removePendingPlayer(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  targetUserId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    const player = await db.getAmongUsPlayer(session.session_id, targetUserId);
    if (!player) return { ok: false, message: '❌ اللاعب غير موجود في الجلسة.' };
    if (player.player_status !== 'pending') {
      return { ok: false, message: '❌ هذا اللاعب مشارك بالفعل ولا يمكن حذفه من منتصف الجولة.' };
    }

    await db.deleteAmongUsPlayer(session.session_id, player.user_id);
    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'pending_removed',
      targetUserId: player.user_id,
      previousState: 'pending',
      newState: 'removed',
      logText: `🗑️ أزال <@${actorId}> اللاعب Pending ${player.display_name ?? `<@${player.user_id}>`}.`,
      client: guild.client,
      guild,
      settings,
    });

    return { ok: true, message: '🗑️ تم حذف اللاعب Pending.', session: await db.getAmongUsSession(session.session_id) };
  });
}

export async function restorePlayerControl(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  targetUserId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    const player = await db.getAmongUsPlayer(session.session_id, targetUserId);
    if (!player) return { ok: false, message: '❌ اللاعب غير موجود في الجلسة.' };

    await db.updateAmongUsPlayer(session.session_id, player.user_id, {
      external_override: 0,
      restore_on_rejoin: 0,
    });
    const updated = await db.getAmongUsPlayer(session.session_id, player.user_id);
    const warnings = updated ? await applyPhaseToPlayer(guild, settings, session, updated) : [];

    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'player_control_restored',
      targetUserId: player.user_id,
      previousState: 'external-override',
      newState: 'managed',
      logText: `🔄 أعاد <@${actorId}> ${player.display_name ?? `<@${player.user_id}>`} تحت إدارة النظام.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message: `🔄 تمت إعادة ${player.display_name ?? `<@${player.user_id}>`} تحت إدارة النظام.` +
        (warnings.length > 0 ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : ''),
      warnings,
      session: await db.getAmongUsSession(session.session_id),
    };
  });
}

// ============================================================
// Recovery / resync
// ============================================================
export async function resyncSession(
  guild: Guild,
  settings: AmongUsSettings,
  sessionId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    if (!botHasMutePermission(guild)) {
      return { ok: false, message: '❌ البوت لا يملك صلاحية **Mute Members**.' };
    }

    await db.setAmongUsSessionRecovery(session.session_id, false);
    const refreshed = await db.getAmongUsSession(session.session_id);
    if (!refreshed) return { ok: false, message: '❌ تعذر تحميل الجلسة.' };

    let applied: PhaseApplyResult = { warnings: [], muted: 0, unmuted: 0, skipped: 0 };
    if (refreshed.current_phase === 'in_game' || refreshed.current_phase === 'meeting') {
      applied = await applyPhaseToPlayers(guild, settings, refreshed, refreshed.current_phase);
    }

    await recordEvent({
      guildId: guild.id,
      sessionId: refreshed.session_id,
      actorUserId: actorId,
      action: 'recovery_resync',
      newState: `muted:${applied.muted}, unmuted:${applied.unmuted}, skipped:${applied.skipped}`,
      logText: `🔄 استأنف <@${actorId}> التحكم بعد Recovery — كتم ${applied.muted} / فتح ${applied.unmuted}.`,
      client: guild.client,
      guild,
      settings,
    });

    return {
      ok: true,
      message:
        '🔄 تم استئناف التحكم بعد Recovery.\n' +
        `🔇 كتم: ${applied.muted} · 🔊 فتح: ${applied.unmuted} · ⏭️ متجاوز: ${applied.skipped}` +
        (applied.warnings.length > 0 ? `\n⚠️ ${applied.warnings.slice(0, 5).join('\n⚠️ ')}` : ''),
      warnings: applied.warnings,
      session: await db.getAmongUsSession(refreshed.session_id),
    };
  });
}

// ============================================================
// Assistant hosts
// ============================================================
export async function addSessionHelper(
  guild: Guild,
  sessionId: string,
  targetUserId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    if (targetUserId === session.host_user_id) {
      return { ok: false, message: '❌ المضيف الأساسي لا يحتاج إلى أن يكون مساعدًا.' };
    }
    const member = await fetchMember(guild, targetUserId);
    if (!member || member.user.bot) return { ok: false, message: '❌ العضو غير موجود أو بوت.' };

    const helpers = await db.getAmongUsHelperIds(session.session_id);
    if (helpers.includes(targetUserId)) {
      return { ok: false, message: 'ℹ️ هذا العضو مساعد بالفعل.' };
    }
    if (helpers.length >= 10) {
      return { ok: false, message: '❌ الحد الأقصى للمضيفين المساعدين هو 10.' };
    }

    await db.addAmongUsHelper({
      session_id: session.session_id,
      guild_id: guild.id,
      user_id: targetUserId,
      added_by: actorId,
    });
    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'helper_added',
      targetUserId,
      newState: 'helper',
      logText: `🤝 أضاف <@${actorId}> <@${targetUserId}> كمضيف مساعد.`,
      client: guild.client,
      guild,
    });
    return { ok: true, message: `🤝 تم إضافة <@${targetUserId}> كمضيف مساعد.`, session };
  });
}

export async function removeSessionHelper(
  guild: Guild,
  sessionId: string,
  targetUserId: string,
  actorId: string,
): Promise<ActionResult> {
  return withGuildLock(guild.id, async () => {
    const session = await validateSession(sessionId, guild.id);
    if (!session) return { ok: false, message: '❌ الجلسة غير موجودة أو منتهية.' };
    await db.removeAmongUsHelper(session.session_id, targetUserId);
    await recordEvent({
      guildId: guild.id,
      sessionId: session.session_id,
      actorUserId: actorId,
      action: 'helper_removed',
      targetUserId,
      previousState: 'helper',
      newState: 'removed',
      logText: `➖ أزال <@${actorId}> <@${targetUserId}> من المضيفين المساعدين.`,
      client: guild.client,
      guild,
    });
    return { ok: true, message: `➖ تم إزالة <@${targetUserId}> من المضيفين المساعدين.`, session };
  });
}

// ============================================================
// Restore after restart
// ============================================================
export async function restoreSessionsAfterRestart(
  client: import('discord.js').Client,
): Promise<void> {
  const sessions = await db.listActiveAmongUsSessions();
  if (sessions.length === 0) return;

  for (const session of sessions) {
    try {
      const guild =
        client.guilds.cache.get(session.guild_id) ??
        (await client.guilds.fetch(session.guild_id).catch(() => null));
      if (!guild) continue;

      const settings = await db.getAmongUsSettings(session.guild_id);
      if (!settings) continue;

      const voice = await fetchVoiceChannel(guild, settings.voice_channel_id);
      if (!voice) {
        await db.setAmongUsSessionRecovery(session.session_id, true);
        continue;
      }

      const players = await db.getAmongUsPlayers(session.session_id);
      for (const player of players) {
        const member = await fetchMember(guild, player.user_id);
        const connected = !!member && member.voice.channelId === voice.id;
        if (connected !== (player.is_connected === 1)) {
          await db.updateAmongUsPlayer(session.session_id, player.user_id, {
            is_connected: connected ? 1 : 0,
          });
        }
      }

      await db.setAmongUsSessionRecovery(session.session_id, true);
      await db.setAmongUsSessionLastAction(
        session.session_id,
        'System recovery after restart — review mics',
      );

      const { renderPanelView } = await import('./navigation.js');
      await renderPanelView(client, session.guild_id);

      await recordEvent({
        guildId: session.guild_id,
        sessionId: session.session_id,
        action: 'session_recovered',
        newState: 'recovery_mode',
        logText: '🟠 تمت استعادة جلسة Among Us بعد إعادة تشغيل البوت. التحكم التلقائي متوقف حتى Resume Control.',
        client,
        guild,
        settings,
        session,
        notifyHostText:
          '🟠 تمت استعادة الجلسة بعد إعادة التشغيل. راجع المايكات ثم اضغط **Resume Control**.',
        notifyKey: 'restart-recovery',
      });
    } catch (e) {
      console.warn('[Blade X] ⚠️ Among Us session restore failed:', e);
    }
  }
}

/** Helper used by the create-session UI. */
export async function listEligibleMembers(
  guild: Guild,
  settings: AmongUsSettings,
): Promise<GuildMember[]> {
  return participantsInRoom(guild, settings);
}
