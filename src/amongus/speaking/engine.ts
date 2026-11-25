// ============================================================
// Blade X — Among Us Manager · Speaking Manager engine
// Queue / phases / persisted timer / safe voice transitions.
// Every mic change goes through the EXISTING voice.ts safety layer.
// ============================================================

import type { Client, Guild, GuildMember } from 'discord.js';
import {
  getActiveAmongUsSession,
  getAmongUsPlayer,
  getAmongUsPlayers,
  getAmongUsSession,
  getAmongUsSettings,
  updateAmongUsPlayer,
} from '../database.js';
import { recordEvent } from '../logger.js';
import { renderPanelView } from '../navigation.js';
import { withGuildLock } from '../session.js';
import type { AmongUsPlayer, AmongUsSession } from '../types.js';
import { applyPlayerMute, persistVoiceResult, type VoiceActionResult } from '../voice.js';
import {
  deleteSpeakingState,
  getSpeakingSettings,
  getSpeakingState,
  listSpeakingStates,
  saveSpeakingSettings,
  saveSpeakingState,
  setSpeakingEnabled,
  setSpeakingQuickPriority,
  setSpeakingToggle,
} from './database.js';
import { registerSpeakingHooks } from './hooks.js';
import {
  durationForKind,
  formatClock,
  parseDuration,
  sortQueue,
  SPEAKING_DURATION_LIMITS,
  type SpeakingDurationField,
  type SpeakingEntry,
  type SpeakingQuickPriority,
  type SpeakingRequestKind,
  type SpeakingResult,
  type SpeakingSettings,
  type SpeakingState,
} from './types.js';

let clientRef: Client | null = null;

const tickers = new Map<string, { sessionId: string; handle: NodeJS.Timeout }>();
const tickLocks = new Set<string>();

function resolveGuild(guildId: string): Guild | null {
  return clientRef?.guilds.cache.get(guildId) ?? null;
}

function startTicker(guildId: string, sessionId: string): void {
  const existing = tickers.get(guildId);
  if (existing) {
    clearInterval(existing.handle);
    tickers.delete(guildId);
  }
  const handle = setInterval(() => {
    void tick(guildId, sessionId);
  }, 1000);
  handle.unref?.();
  tickers.set(guildId, { sessionId, handle });
}

function stopTicker(guildId: string): void {
  const existing = tickers.get(guildId);
  if (!existing) return;
  clearInterval(existing.handle);
  tickers.delete(guildId);
}

async function refreshPanel(sessionId: string): Promise<void> {
  if (!clientRef) return;
  const session = await getAmongUsSession(sessionId);
  if (!session) return;
  // Render whatever view is currently open in the single panel (main or a
  // sub-page) instead of forcing a separate dashboard edit/message.
  await renderPanelView(clientRef, session.guild_id).catch(() => undefined);
}

async function log(
  sessionId: string,
  action: string,
  actorId: string | null,
  extra: {
    targetId?: string | null;
    previous?: string | null;
    next?: string | null;
    logText?: string;
    notifyHostText?: string;
    notifyKey?: string;
  } = {},
): Promise<void> {
  const session = await getAmongUsSession(sessionId);
  if (!session) return;
  const guild = resolveGuild(session.guild_id);
  const settings = await getAmongUsSettings(session.guild_id);
  await recordEvent({
    guildId: session.guild_id,
    sessionId,
    actorUserId: actorId,
    action,
    targetUserId: extra.targetId ?? null,
    previousState: extra.previous ?? null,
    newState: extra.next ?? null,
    logText: extra.logText,
    notifyHostText: extra.notifyHostText,
    notifyKey: extra.notifyKey,
    client: clientRef ?? undefined,
    guild,
    settings,
    session,
  });
}

async function changeMute(
  sessionId: string,
  userId: string,
  shouldMute: boolean,
  reason: string,
  warnings: string[],
): Promise<VoiceActionResult> {
  const session = await getAmongUsSession(sessionId);
  const player = await getAmongUsPlayer(sessionId, userId);
  if (!session || !player) {
    warnings.push(`<@${userId}>: اللاعب غير موجود في الجلسة.`);
    return { ok: false, action: 'unchanged', reason: 'no-player' };
  }
  const guild = resolveGuild(session.guild_id);
  if (!guild) {
    warnings.push(`<@${userId}>: السيرفر غير متاح.`);
    return { ok: false, action: 'unchanged', reason: 'no-guild' };
  }
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot) {
    await updateAmongUsPlayer(sessionId, userId, { is_connected: 0 });
    warnings.push(`<@${userId}>: غير متصل — تم تجاوز دوره بأمان.`);
    return { ok: false, action: 'unchanged', reason: 'no-member' };
  }
  const settings = await getAmongUsSettings(session.guild_id);
  const result = await applyPlayerMute(
    guild,
    member,
    player,
    shouldMute,
    session.voice_channel_id ?? settings?.voice_channel_id ?? null,
    `Speaking Manager: ${reason}`,
  );
  await persistVoiceResult(sessionId, player, result, shouldMute, warnings);
  return result;
}

async function isEntryValid(sessionId: string, userId: string, session?: AmongUsSession): Promise<boolean> {
  const player = await getAmongUsPlayer(sessionId, userId);
  if (
    !player ||
    player.player_status !== 'alive' ||
    player.is_connected !== 1 ||
    player.external_override === 1
  ) {
    return false;
  }
  const currentSession = session ?? (await getAmongUsSession(sessionId));
  if (!currentSession || currentSession.current_phase !== 'meeting') return false;
  const guild = resolveGuild(currentSession.guild_id);
  if (!guild) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot) return false;
  const settings = await getAmongUsSettings(currentSession.guild_id);
  return member.voice.channelId === (currentSession.voice_channel_id ?? settings?.voice_channel_id ?? null);
}

async function allAliveHadRoundRobinTurn(sessionId: string, state: SpeakingState): Promise<boolean> {
  const players = await getAmongUsPlayers(sessionId);
  const alive = players
    .filter((p) => p.player_status === 'alive' && p.is_connected === 1)
    .map((p) => p.user_id);
  return alive.length > 0 && alive.every((id) => state.roundRobinDone.includes(id));
}

/** Core-session hook: never override the base rules while disabled. */
async function getMeetingMuteOverride(
  sessionId: string,
  player: AmongUsPlayer,
): Promise<boolean | null> {
  const settings = await getSpeakingSettings(player.guild_id);
  if (!settings.enabled) return null;
  const state = await getSpeakingState(sessionId);
  if (!state?.active) return null;
  if (player.player_status !== 'alive') return true;
  if (state.paused) return true;
  return state.current?.userId !== player.user_id;
}

export function registerSpeakingEngine(client: Client): void {
  clientRef = client;
  registerSpeakingHooks({
    getMeetingMuteOverride,
    onPhaseChange: handlePhaseChange,
    onPlayerStatusChange: handlePlayerStatusChange,
    onVoicePresence: handleVoicePresence,
    onExternalOverride: handleExternalOverride,
  });
}

function freshState(
  session: AmongUsSession,
  settings: SpeakingSettings,
  actorId: string | null,
): SpeakingState {
  const now = Date.now();
  return {
    sessionId: session.session_id,
    guildId: session.guild_id,
    active: true,
    stage: settings.mandatoryRoundRobin ? 'round_robin' : 'open_discussion',
    paused: false,
    remainingMs: 0,
    current: null,
    queue: [],
    roundRobinDone: [],
    startedAt: now,
    turnStartedAt: null,
    turnEndsAt: null,
    lastAction: `Speaking Manager started (${settings.mandatoryRoundRobin ? 'Round Robin' : 'Open Discussion'})`,
    lastActor: actorId,
    error: null,
    updatedAt: now,
  };
}

async function startSpeakingSession(
  sessionId: string,
  settings: SpeakingSettings,
  actorId: string | null,
  alreadyLocked = false,
): Promise<SpeakingResult> {
  const run = async (): Promise<SpeakingResult> => {
    const existing = await getSpeakingState(sessionId);
    if (existing?.active) return { ok: true, message: 'ℹ️ Speaking Manager Already active.' };
    const session = await getAmongUsSession(sessionId);
    if (!session || session.current_phase !== 'meeting') {
      return { ok: false, message: '❌ Speaking Manager يعمل أثناء الاجتماع فقط.' };
    }
    const state = freshState(session, settings, actorId);
    await saveSpeakingState(state);

    // Applies both when a meeting starts and when the feature is switched on
    // mid-meeting. applyPlayerMute is idempotent, so the core phase pass
    // that follows a normal Start Meeting performs no extra API changes.
    const warnings: string[] = [];
    const players = await getAmongUsPlayers(sessionId);
    for (const player of players) {
      if (player.player_status !== 'alive' || player.is_connected !== 1) continue;
      await changeMute(sessionId, player.user_id, true, 'speaking-start', warnings);
    }

    startTicker(session.guild_id, sessionId);
    await log(sessionId, 'speaking_started', actorId, {
      next: state.stage,
      logText: `🗣️ بدأ Speaking Manager بمرحلة ${state.stage}.`,
    });
    await refreshPanel(sessionId);
    return {
      ok: true,
      message: `🗣️ تم تفعيل Speaking Manager — ${state.stage === 'round_robin' ? 'Round Robin' : 'Open Discussion'}.`,
      warnings,
    };
  };
  return alreadyLocked ? run() : withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', run);
}

async function stopSpeakingSession(
  sessionId: string,
  reason: string,
  actorId: string | null,
  restoreFreeSpeech: boolean,
  alreadyLocked = false,
): Promise<SpeakingResult> {
  const guildId = (await getAmongUsSession(sessionId))?.guild_id ?? '';
  const run = async (): Promise<SpeakingResult> => {
    const state = await getSpeakingState(sessionId);
    const session = await getAmongUsSession(sessionId);
    if (!state || !session) return { ok: true, message: 'ℹ️ لا يوجد نظام كلام نشط.' };
    const warnings: string[] = [];

    // When returning to free speech the current speaker will be unmuted in
    // the loop below, so don't write an extra redundant mute first.
    if (state.current && !restoreFreeSpeech) {
      await changeMute(sessionId, state.current.userId, true, `stop:${reason}`, warnings);
    }
    await deleteSpeakingState(sessionId);
    stopTicker(session.guild_id);

    if (restoreFreeSpeech && session.current_phase === 'meeting') {
      const players = await getAmongUsPlayers(sessionId);
      for (const player of players) {
        if (player.player_status !== 'alive' || player.is_connected !== 1) continue;
        await changeMute(sessionId, player.user_id, false, `free-speech:${reason}`, warnings);
      }
    }

    await log(sessionId, 'speaking_stopped', actorId, {
      previous: state.stage,
      next: reason,
      logText: `🛑 تم إيقاف Speaking Manager (${reason}).`,
    });
    await refreshPanel(sessionId);
    return {
      ok: true,
      message: '🛑 تم إنهاء نظام الأدوار والعودة إلى الاجتماع العادي.',
      warnings,
    };
  };
  return alreadyLocked ? run() : withGuildLock(guildId, run);
}

/** Called by the core session module (already inside withGuildLock). */
async function handlePhaseChange(
  sessionId: string,
  phase: string,
  actorId: string | null,
): Promise<void> {
  const state = await getSpeakingState(sessionId);
  if (phase !== 'meeting' || !state?.active) {
    if (state) await stopSpeakingSession(sessionId, `phase-${phase}`, actorId, false, true);
    return;
  }
  const session = await getAmongUsSession(sessionId);
  if (!session) return;
  const settings = await getSpeakingSettings(session.guild_id);
  if (!settings.enabled) {
    await stopSpeakingSession(sessionId, 'feature-disabled', actorId, false, true);
    return;
  }
  await startSpeakingSession(sessionId, settings, actorId, true);
}

async function advanceTurn(
  sessionId: string,
  reason: string,
  actorId: string | null,
  alreadyLocked = false,
): Promise<SpeakingResult> {
  const run = async (): Promise<SpeakingResult> => {
    const state = await getSpeakingState(sessionId);
    const session = await getAmongUsSession(sessionId);
    if (!state?.active || !session) return { ok: false, message: '❌ لا يوجد نظام كلام نشط.' };
    const settings = await getSpeakingSettings(session.guild_id);
    const previous = state.current?.userId ?? null;
    const warnings: string[] = [];

    if (state.current) {
      const result = await changeMute(sessionId, state.current.userId, true, `turn-end:${reason}`, warnings);
      if (!result.ok && result.reason === 'discord-api-error') {
        // Never allow a second open mic: halt automatic transitions safely.
        state.paused = true;
        state.remainingMs = state.turnEndsAt ? Math.max(0, state.turnEndsAt - Date.now()) : 0;
        state.turnEndsAt = null;
        state.error = `تعذر كتم المتحدث الحالي — أوقف الانتقال التلقائي. ${result.error ?? ''}`.trim();
        state.lastAction = `Speaker mute failed (${reason})`;
        await saveSpeakingState(state);
        stopTicker(session.guild_id);
        await log(sessionId, 'speaking_voice_error', actorId, {
          targetId: state.current.userId,
          next: state.error,
          logText: `⚠️ ${state.error}`,
          notifyHostText: `⚠️ ${state.error} راجع المايك ثم اضغط Resume Discussion.`,
          notifyKey: 'voice-error',
        });
        await refreshPanel(sessionId);
        return { ok: false, message: state.error, warnings };
      }
    }

    // Round Robin ends as soon as every alive, connected player had one turn.
    if (
      state.stage === 'round_robin' &&
      settings.mandatoryRoundRobin &&
      (await allAliveHadRoundRobinTurn(sessionId, state))
    ) {
      state.stage = 'open_discussion';
      state.roundRobinDone = [];
      state.lastAction = 'Round Robin complete — Open Discussion';
      await log(sessionId, 'speaking_round_robin_complete', actorId, {
        next: 'open_discussion',
        logText: '🔄 انتهت مرحلة Round Robin — بدأت المداخلات المفتوحة.',
      });
    }

    // Drop stale requests without disturbing the order of the remaining ones.
    const kept: SpeakingEntry[] = [];
    for (const entry of state.queue) {
      if (await isEntryValid(sessionId, entry.userId, session)) kept.push(entry);
    }
    state.queue = sortQueue(kept);

    const next = state.queue.shift() ?? null;
    if (!next) {
      state.current = null;
      state.turnStartedAt = null;
      state.turnEndsAt = null;
      state.remainingMs = 0;
      state.paused = false;
      if (state.stage === 'round_robin') {
        state.stage = 'open_discussion';
        state.roundRobinDone = [];
        state.lastAction = 'Round Robin complete — Open Discussion';
        await log(sessionId, 'speaking_round_robin_complete', actorId, {
          next: 'open_discussion',
          logText: '🔄 انتهت مرحلة Round Robin — بدأت المداخلات المفتوحة.',
        });
      } else {
        state.lastAction = 'Queue empty';
      }
      await saveSpeakingState(state);
      stopTicker(session.guild_id);
      await refreshPanel(sessionId);
      return {
        ok: true,
        message: previous
          ? `⏰ انتهى دور <@${previous}> — قائمة الانتظار فارغة.`
          : 'ℹ️ قائمة الانتظار فارغة.',
        warnings,
      };
    }

    const seconds = durationForKind(settings, next.kind);
    state.current = next;
    state.turnStartedAt = Date.now();
    state.turnEndsAt = Date.now() + seconds * 1000;
    state.remainingMs = 0;
    state.paused = false;
    state.error = null;
    state.lastAction = `Turn started: ${next.kind} (${seconds}s)`;
    if (next.kind === 'round_robin' && !state.roundRobinDone.includes(next.userId)) {
      state.roundRobinDone.push(next.userId);
    }
    await saveSpeakingState(state);

    const unmute = await changeMute(sessionId, next.userId, false, `turn-start:${reason}`, warnings);
    if (!unmute.ok && unmute.reason === 'discord-api-error') {
      state.paused = true;
      state.remainingMs = seconds * 1000;
      state.turnEndsAt = null;
      state.error = `تعذر فتح مايك المتحدث التالي — أوقف الانتقال التلقائي. ${unmute.error ?? ''}`.trim();
      state.lastAction = `Next speaker unmute failed (${reason})`;
      await saveSpeakingState(state);
      stopTicker(session.guild_id);
      await log(sessionId, 'speaking_voice_error', actorId, {
        targetId: next.userId,
        next: state.error,
        logText: `⚠️ ${state.error}`,
        notifyHostText: `⚠️ ${state.error}`,
        notifyKey: 'voice-error',
      });
      await refreshPanel(sessionId);
      return { ok: false, message: state.error, warnings };
    }

    startTicker(session.guild_id, sessionId);
    await log(sessionId, 'speaking_turn_started', actorId, {
      targetId: next.userId,
      previous: previous,
      next: `${next.kind}:${seconds}s`,
      logText: `🎙️ دور <@${next.userId}> (${next.kind}) — ${seconds} ثانية.`,
      notifyHostText: `🎙️ المتحدث الحالي: <@${next.userId}> — ${formatClock(seconds * 1000)}.`,
      notifyKey: `turn:${next.userId}`,
    });
    await refreshPanel(sessionId);
    return {
      ok: true,
      message: `🎙️ المتحدث الحالي: <@${next.userId}> — ${formatClock(seconds * 1000)}.`,
      warnings,
    };
  };
  return alreadyLocked ? run() : withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', run);
}

async function tick(guildId: string, sessionId: string): Promise<void> {
  if (tickLocks.has(sessionId)) return;
  tickLocks.add(sessionId);
  try {
    const state = await getSpeakingState(sessionId);
    if (!state?.active || state.paused || !state.current || !state.turnEndsAt) {
      stopTicker(guildId);
      return;
    }
    const now = Date.now();
    if (now < state.turnEndsAt) return;
    if (!(await isEntryValid(sessionId, state.current.userId))) {
      await advanceTurn(sessionId, 'speaker-invalid', null);
      return;
    }
    await advanceTurn(sessionId, 'timeout', null);
  } catch (e) {
    console.warn('[Blade X] ⚠️ Speaking Manager tick failed:', e);
  } finally {
    tickLocks.delete(sessionId);
  }
}

async function requestSpeak(
  sessionId: string,
  userId: string,
  kind: SpeakingRequestKind,
  actorId: string,
): Promise<SpeakingResult> {
  return withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', async () => {
    const session = await getAmongUsSession(sessionId);
    if (!session || session.current_phase !== 'meeting') {
      return { ok: false, message: '❌ طلب الكلام متاح أثناء الاجتماع فقط.' };
    }
    const settings = await getSpeakingSettings(session.guild_id);
    if (!settings.enabled) {
      return { ok: false, message: 'ℹ️ Speaking Manager معطّل — يمكنك التحدث بحرية.' };
    }
    if (kind === 'quick' && !settings.quickEnabled) {
      return { ok: false, message: '❌ المداخلة السريعة معطّلة من الإعدادات.' };
    }
    const state = await getSpeakingState(sessionId);
    if (!state?.active) {
      return { ok: false, message: '❌ نظام الأدوار غير نشط في هذا الاجتماع.' };
    }
    if (state.paused) {
      return { ok: false, message: '⏸️ النقاش موقوف مؤقتًا — انتظر استئناف المضيف.' };
    }
    if (!(await isEntryValid(sessionId, userId, session))) {
      const player = await getAmongUsPlayer(sessionId, userId);
      if (!player || player.player_status !== 'alive') {
        return { ok: false, message: '❌ اللاعبون الأموات لا يستطيعون طلب الكلام.' };
      }
      if (player.external_override === 1) {
        return { ok: false, message: '❌ مايكك تحت تحكم خارجي — لا يمكن إدارة دورك.' };
      }
      return { ok: false, message: '❌ يجب أن تكون متصلًا بالروم الصوتي للجلسة.' };
    }
    if (state.current?.userId === userId) {
      return { ok: false, message: 'ℹ️ أنت المتحدث الحالي بالفعل.' };
    }
    if (state.queue.some((entry) => entry.userId === userId)) {
      return {
        ok: false,
        message: `ℹ️ طلبك مسجل بالفعل — ترتيبك: ${state.queue.findIndex((e) => e.userId === userId) + 1}.`,
      };
    }
    if (state.stage === 'round_robin' && kind !== 'quick') {
      if (state.roundRobinDone.includes(userId)) {
        return { ok: false, message: 'ℹ️ حصلت على دورك في Round Robin — انتظر المداخلات المفتوحة.' };
      }
      kind = 'round_robin';
    } else if (state.stage === 'open_discussion' && kind === 'round_robin') {
      kind = 'open';
    }

    const entry: SpeakingEntry = {
      userId,
      kind,
      requestedAt: Date.now(),
      requestedBy: actorId,
    };
    if (kind === 'quick' && settings.quickPriority === 'after-current') {
      // Priority: immediately after the current speaker (front of the queue).
      state.queue.unshift(entry);
    } else {
      state.queue = sortQueue([...state.queue, entry]);
    }
    await saveSpeakingState(state);
    await log(sessionId, 'speaking_request', actorId, {
      targetId: userId,
      next: kind,
      logText: `🙋 طلب <@${userId}> الكلام (${kind}).`,
    });

    if (!state.current) {
      const result = await advanceTurn(sessionId, 'request', actorId, true);
      return {
        ok: true,
        message: result.ok
          ? `✅ تم تسجيل طلبك — المتحدث التالي أنت.\n${result.message}`
          : result.message,
        warnings: result.warnings,
      };
    }
    await refreshPanel(sessionId);
    const position = state.queue.findIndex((e) => e.userId === userId) + 1;
    return {
      ok: true,
      message: `✅ تم تسجيل طلبك — ترتيبك: **${position}**${kind === 'quick' ? ' (مداخلة سريعة)' : ''}.`,
    };
  });
}

async function addTime(sessionId: string, actorId: string): Promise<SpeakingResult> {
  return withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', async () => {
    const state = await getSpeakingState(sessionId);
    const session = await getAmongUsSession(sessionId);
    if (!state?.active || !session) return { ok: false, message: '❌ لا يوجد نظام كلام نشط.' };
    if (!state.current) return { ok: false, message: '❌ لا يوجد متحدث حالي.' };
    const settings = await getSpeakingSettings(session.guild_id);
    const extra = settings.extensionSeconds * 1000;
    if (state.paused) state.remainingMs += extra;
    else if (state.turnEndsAt) state.turnEndsAt += extra;
    else return { ok: false, message: '❌ لا يمكن تمديد مؤقت غير نشط.' };
    state.lastAction = `Extended by ${settings.extensionSeconds}s`;
    state.lastActor = actorId;
    await saveSpeakingState(state);
    startTicker(session.guild_id, sessionId);
    await log(sessionId, 'speaking_extended', actorId, {
      targetId: state.current.userId,
      next: `+${settings.extensionSeconds}s`,
      logText: `⏱️ مدّد <@${actorId}> وقت <@${state.current.userId}> ${settings.extensionSeconds} ثانية.`,
    });
    await refreshPanel(sessionId);
    return { ok: true, message: `⏱️ تمت إضافة ${settings.extensionSeconds} ثانية للمتحدث الحالي.` };
  });
}

async function pauseDiscussion(sessionId: string, actorId: string): Promise<SpeakingResult> {
  return withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', async () => {
    const state = await getSpeakingState(sessionId);
    const session = await getAmongUsSession(sessionId);
    if (!state?.active || !session) return { ok: false, message: '❌ لا يوجد نظام كلام نشط.' };
    if (state.paused) return { ok: false, message: 'ℹ️ النقاش موقوف بالفعل.' };
    const warnings: string[] = [];
    if (state.current) {
      const result = await changeMute(sessionId, state.current.userId, true, 'pause', warnings);
      if (!result.ok && result.reason === 'discord-api-error') {
        return { ok: false, message: `❌ تعذر كتم المتحدث — لم يتم الإيقاف. ${result.error ?? ''}`, warnings };
      }
    }
    state.remainingMs = state.turnEndsAt ? Math.max(0, state.turnEndsAt - Date.now()) : state.remainingMs;
    state.turnEndsAt = null;
    state.paused = true;
    state.lastAction = 'Discussion paused';
    state.lastActor = actorId;
    await saveSpeakingState(state);
    stopTicker(session.guild_id);
    await log(sessionId, 'speaking_paused', actorId, {
      logText: '⏸️ أوقف <@' + actorId + '> النقاش.',
    });
    await refreshPanel(sessionId);
    return { ok: true, message: '⏸️ تم إيقاف النقاش مع الحفاظ على ترتيب الانتظار والوقت المتبقي.', warnings };
  });
}

async function resumeDiscussion(sessionId: string, actorId: string): Promise<SpeakingResult> {
  return withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', async () => {
    const state = await getSpeakingState(sessionId);
    const session = await getAmongUsSession(sessionId);
    if (!state?.active || !session) return { ok: false, message: '❌ لا يوجد نظام كلام نشط.' };
    if (!state.paused) return { ok: false, message: 'ℹ️ النقاش يعمل بالفعل.' };
    const warnings: string[] = [];
    if (state.current && (await isEntryValid(sessionId, state.current.userId, session))) {
      const result = await changeMute(sessionId, state.current.userId, false, 'resume', warnings);
      if (!result.ok && result.reason === 'discord-api-error') {
        return { ok: false, message: `❌ تعذر فتح مايك المتحدث. ${result.error ?? ''}`, warnings };
      }
    } else if (state.current) {
      state.current = null;
      return await advanceTurn(sessionId, 'resume-invalid', actorId, true);
    }
    state.paused = false;
    state.error = null;
    state.turnEndsAt = Date.now() + Math.max(1000, state.remainingMs);
    state.turnStartedAt = Date.now();
    state.lastAction = 'Discussion resumed';
    state.lastActor = actorId;
    await saveSpeakingState(state);
    startTicker(session.guild_id, sessionId);
    await log(sessionId, 'speaking_resumed', actorId, { logText: `▶️ استأنف <@${actorId}> النقاش.` });
    await refreshPanel(sessionId);
    return { ok: true, message: '▶️ تم استئناف النقاش بالترتيب والوقت المتبقي.', warnings };
  });
}

async function prioritizePlayer(
  sessionId: string,
  userId: string,
  actorId: string,
): Promise<SpeakingResult> {
  return withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', async () => {
    const state = await getSpeakingState(sessionId);
    if (!state?.active) return { ok: false, message: '❌ لا يوجد نظام كلام نشط.' };
    const index = state.queue.findIndex((entry) => entry.userId === userId);
    if (index < 0) return { ok: false, message: '❌ اللاعب ليس في قائمة الانتظار.' };
    const [entry] = state.queue.splice(index, 1);
    entry.prioritized = true;
    entry.prioritizedBy = actorId;
    state.queue.unshift(entry);
    state.lastAction = `Prioritized <@${userId}> by <@${actorId}>`;
    state.lastActor = actorId;
    await saveSpeakingState(state);
    await log(sessionId, 'speaking_prioritized', actorId, {
      targetId: userId,
      logText: `⬆️ قدّم <@${actorId}> اللاعب <@${userId}> في قائمة الكلام.`,
    });
    await refreshPanel(sessionId);
    return { ok: true, message: `⬆️ تم تقديم <@${userId}> في قائمة الانتظار.` };
  });
}

async function removeFromQueue(
  sessionId: string,
  userId: string,
  actorId: string,
): Promise<SpeakingResult> {
  return withGuildLock((await getAmongUsSession(sessionId))?.guild_id ?? '', async () => {
    const state = await getSpeakingState(sessionId);
    if (!state?.active) return { ok: false, message: '❌ لا يوجد نظام كلام نشط.' };
    if (state.current?.userId === userId) {
      const result = await advanceTurn(sessionId, 'removed-by-host', actorId, true);
      return {
        ok: result.ok,
        message: `🗑️ تمت إزالة <@${userId}> من المنصب الحالي.\n${result.message}`,
        warnings: result.warnings,
      };
    }
    const before = state.queue.length;
    state.queue = state.queue.filter((entry) => entry.userId !== userId);
    if (state.queue.length === before) return { ok: false, message: '❌ اللاعب ليس في قائمة الانتظار.' };
    state.lastAction = `Removed <@${userId}> from queue`;
    state.lastActor = actorId;
    await saveSpeakingState(state);
    await log(sessionId, 'speaking_removed', actorId, {
      targetId: userId,
      logText: `🗑️ أزال <@${actorId}> <@${userId}> من قائمة الكلام.`,
    });
    await refreshPanel(sessionId);
    return { ok: true, message: `🗑️ تم حذف <@${userId}> من قائمة الانتظار.` };
  });
}

async function handlePlayerStatusChange(
  sessionId: string,
  userId: string,
  status: string,
  actorId: string | null,
): Promise<void> {
  if (status === 'alive') return;
  const state = await getSpeakingState(sessionId);
  if (!state?.active) return;
  state.queue = state.queue.filter((entry) => entry.userId !== userId);
  await saveSpeakingState(state);
  if (state.current?.userId === userId) {
    // Caller (markPlayerDead) already holds the guild lock.
    await advanceTurn(sessionId, 'speaker-dead', actorId, true);
  } else {
    await refreshPanel(sessionId);
  }
  await log(sessionId, 'speaking_player_removed', actorId, {
    targetId: userId,
    next: status,
    logText: `💀 أُزيل <@${userId}> من قائمة الكلام (${status}).`,
  });
}

async function handleVoicePresence(
  sessionId: string,
  userId: string,
  connected: boolean,
): Promise<void> {
  const state = await getSpeakingState(sessionId);
  if (!state?.active) return;
  if (connected) {
    const inQueue = state.queue.some((entry) => entry.userId === userId);
    if (!inQueue && state.current?.userId !== userId) return;
    // A returning player keeps their place if it was preserved, otherwise
    // they may request a fresh turn. No mic is touched here.
    await refreshPanel(sessionId);
    return;
  }
  state.queue = state.queue.filter((entry) => entry.userId !== userId);
  await saveSpeakingState(state);
  if (state.current?.userId === userId) {
    await advanceTurn(sessionId, 'speaker-disconnected', null, false);
  } else {
    await refreshPanel(sessionId);
  }
  await log(sessionId, 'speaking_player_left', null, {
    targetId: userId,
    logText: `🚪 أُزيل <@${userId}> من قائمة الكلام لمغادرة الروم.`,
  });
}

async function handleExternalOverride(sessionId: string, userId: string): Promise<void> {
  const state = await getSpeakingState(sessionId);
  if (!state?.active || state.current?.userId !== userId) return;
  state.remainingMs = state.turnEndsAt ? Math.max(0, state.turnEndsAt - Date.now()) : state.remainingMs;
  state.turnEndsAt = null;
  state.paused = true;
  state.error = 'External voice override detected on the current speaker.';
  state.lastAction = 'Paused after external override';
  await saveSpeakingState(state);
  const session = await getAmongUsSession(sessionId);
  if (session) stopTicker(session.guild_id);
  await log(sessionId, 'speaking_external_override', null, {
    targetId: userId,
    logText: `⚠️ تعديل مايك خارجي على المتحدث الحالي <@${userId}> — تم إيقاف النظام مؤقتًا.`,
    notifyHostText: `⚠️ تعديل خارجي على مايك المتحدث <@${userId}>. أوقفنا النظام مؤقتًا — راجع ثم اضغط Resume Discussion.`,
    notifyKey: 'speaking-override',
  });
  await refreshPanel(sessionId);
}

/** Feature toggle. Works in-game (no voice changes) and mid-meeting (safe transition). */
export async function toggleSpeakingFeature(
  guildId: string,
  enabled: boolean,
  actorId: string,
): Promise<SpeakingResult> {
  const previous = await getSpeakingSettings(guildId);
  const settings = await setSpeakingEnabled(guildId, enabled);
  const warnings: string[] = [];
  const session = await getActiveAmongUsSession(guildId);
  let transition = '';

  if (session?.current_phase === 'meeting') {
    if (enabled) {
      const result = await startSpeakingSession(session.session_id, settings, actorId);
      transition = result.message;
    } else {
      const result = await stopSpeakingSession(session.session_id, 'feature-disabled', actorId, true);
      transition = result.message;
      warnings.push(...(result.warnings ?? []));
    }
  } else {
    // Never touch any mic outside a meeting.
    if (!enabled && session) {
      const state = await getSpeakingState(session.session_id);
      if (state?.active) {
        await stopSpeakingSession(session.session_id, 'feature-disabled', actorId, false);
      }
    }
    transition = enabled
      ? 'سيُطبق النظام تلقائيًا في الاجتماع القادم.'
      : 'لا توجد تغييرات على المايكات خارج الاجتماع.';
  }

  await log(session?.session_id ?? '', enabled ? 'speaking_enabled' : 'speaking_disabled', actorId, {
    previous: previous.enabled ? 'enabled' : 'disabled',
    next: enabled ? 'enabled' : 'disabled',
    logText: `${enabled ? '✅ فعّل' : '❌ عطّل'} <@${actorId}> Speaking Manager. ${transition}`,
  });
  if (session) await refreshPanel(session.session_id);
  return {
    ok: true,
    message: `${enabled ? '✅ تم تفعيل' : '❌ تم تعطيل'} Speaking Manager. ${transition}`,
    warnings,
  };
}

export async function setSpeakingDuration(
  guildId: string,
  field: SpeakingDurationField,
  raw: string,
  actorId: string,
): Promise<SpeakingResult> {
  const value = parseDuration(raw);
  if (value === null) {
    return {
      ok: false,
      message: `❌ القيمة غير صالحة — أدخل رقمًا صحيحًا بين ${SPEAKING_DURATION_LIMITS.min} و ${SPEAKING_DURATION_LIMITS.max} ثانية.`,
    };
  }
  const settings = await getSpeakingSettings(guildId);
  settings[field] = value;
  settings.updatedAt = Date.now();
  await saveSpeakingSettings(settings);
  const session = await getActiveAmongUsSession(guildId);
  await log(session?.session_id ?? '', 'speaking_setting_changed', actorId, {
    next: `${field}=${value}`,
    logText: `⚙️ غيّر <@${actorId}> ${field} إلى ${value} ثانية.`,
  });
  return { ok: true, message: `✅ تم حفظ ${field}: ${value} ثانية.` };
}

export async function setSpeakingToggleSetting(
  guildId: string,
  field: 'quickEnabled' | 'mandatoryRoundRobin',
  enabled: boolean,
  actorId: string,
): Promise<SpeakingResult> {
  await setSpeakingToggle(guildId, field, enabled);
  const session = await getActiveAmongUsSession(guildId);
  await log(session?.session_id ?? '', 'speaking_setting_changed', actorId, {
    next: `${field}=${enabled}`,
    logText: `⚙️ غيّر <@${actorId}> ${field} إلى ${enabled}.`,
  });
  return { ok: true, message: `✅ تم تحديث ${field}.` };
}

export async function setQuickPrioritySetting(
  guildId: string,
  priority: SpeakingQuickPriority,
  actorId: string,
): Promise<SpeakingResult> {
  await setSpeakingQuickPriority(guildId, priority);
  const session = await getActiveAmongUsSession(guildId);
  await log(session?.session_id ?? '', 'speaking_setting_changed', actorId, {
    next: `quickPriority=${priority}`,
    logText: `⚙️ غيّر <@${actorId}> أولوية المداخلة السريعة إلى ${priority}.`,
  });
  return { ok: true, message: `✅ تم تحديث أولوية المداخلة السريعة.` };
}

export async function requestToSpeak(
  sessionId: string,
  userId: string,
  kind: SpeakingRequestKind,
  actorId: string,
): Promise<SpeakingResult> {
  return requestSpeak(sessionId, userId, kind, actorId);
}

export async function skipCurrentSpeaker(sessionId: string, actorId: string): Promise<SpeakingResult> {
  const state = await getSpeakingState(sessionId);
  if (!state?.current) return { ok: false, message: '❌ لا يوجد متحدث حالي لتخطيه.' };
  return advanceTurn(sessionId, 'skipped', actorId);
}

export async function extendCurrentTurn(sessionId: string, actorId: string): Promise<SpeakingResult> {
  return addTime(sessionId, actorId);
}

export async function pauseSpeaking(sessionId: string, actorId: string): Promise<SpeakingResult> {
  return pauseDiscussion(sessionId, actorId);
}

export async function resumeSpeaking(sessionId: string, actorId: string): Promise<SpeakingResult> {
  return resumeDiscussion(sessionId, actorId);
}

export async function prioritizeSpeakingPlayer(
  sessionId: string,
  userId: string,
  actorId: string,
): Promise<SpeakingResult> {
  return prioritizePlayer(sessionId, userId, actorId);
}

export async function removeSpeakingPlayer(
  sessionId: string,
  userId: string,
  actorId: string,
): Promise<SpeakingResult> {
  return removeFromQueue(sessionId, userId, actorId);
}

export async function endSpeakingDiscussion(
  sessionId: string,
  actorId: string,
): Promise<SpeakingResult> {
  return stopSpeakingSession(sessionId, 'discussion-ended', actorId, true);
}

/** Core transition helper used by Session End / Round End. */
export async function cleanupSpeakingForSession(sessionId: string): Promise<void> {
  const state = await getSpeakingState(sessionId);
  if (!state) return;
  const session = await getAmongUsSession(sessionId);
  await stopSpeakingSession(sessionId, 'session-cleanup', null, false, true);
  if (session) stopTicker(session.guild_id);
}

// ============================================================
// Restart recovery — DB-backed; no blind unmuting.
// ============================================================
export async function restoreSpeakingAfterRestart(client: Client): Promise<void> {
  clientRef = client;
  const states = await listSpeakingStates();
  for (const state of states) {
    try {
      const session = await getAmongUsSession(state.sessionId);
      const activeSession = session?.status === 'active' ? session : await getActiveAmongUsSession(state.guildId);
      const target = session?.session_id === state.sessionId ? session : activeSession;
      const settings = await getSpeakingSettings(state.guildId);

      if (!target || target.current_phase !== 'meeting' || !settings.enabled || !state.active) {
        await deleteSpeakingState(state.sessionId);
        stopTicker(state.guildId);
        continue;
      }

      const currentValid =
        !!state.current && (await isEntryValid(state.sessionId, state.current.userId, target));
      const futureEnd = state.turnEndsAt && state.turnEndsAt > Date.now();
      const warnings: string[] = [];

      if (currentValid && futureEnd) {
        state.paused = false;
        state.error = null;
        await saveSpeakingState(state);
        await changeMute(state.sessionId, state.current!.userId, false, 'restart-restore', warnings);
        startTicker(state.guildId, state.sessionId);
      } else {
        // Cannot guarantee which mic belongs to whom: pause and mute everyone.
        state.paused = true;
        state.remainingMs = futureEnd ? state.turnEndsAt! - Date.now() : 0;
        state.turnEndsAt = null;
        state.error = 'Recovered after restart. Review mics and press Resume Discussion.';
        state.lastAction = 'Paused after restart recovery';
        await saveSpeakingState(state);
        const players = await getAmongUsPlayers(state.sessionId);
        for (const player of players) {
          if (player.player_status === 'alive' && player.is_connected === 1) {
            await changeMute(state.sessionId, player.user_id, true, 'restart-safe', warnings);
          }
        }
        startTicker(state.guildId, state.sessionId);
      }

      await log(state.sessionId, 'speaking_recovered', null, {
        previous: state.stage,
        next: state.paused ? 'paused' : 'resumed',
        logText: '🟠 تمت استعادة Speaking Manager بعد إعادة تشغيل البوت.',
        notifyHostText:
          '🟠 تمت استعادة Speaking Manager. راجع المايكات ثم اضغط **Resume Discussion** من لوحة Speaking Manager.',
        notifyKey: 'speaking-restart',
      });
      await refreshPanel(state.sessionId);
    } catch (e) {
      console.warn('[Blade X] ⚠️ Speaking Manager recovery failed:', e);
    }
  }
}

/** Exported for unit tests of the persisted-timer arithmetic. */
export function remainingFrom(endsAt: number | null, pausedMs: number, now = Date.now()): number {
  if (!endsAt) return Math.max(0, pausedMs);
  return Math.max(0, endsAt - now);
}
