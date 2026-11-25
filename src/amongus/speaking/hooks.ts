// ============================================================
// Blade X — Among Us Manager · Speaking Manager hook registry
//
// The core session/voice modules import ONLY this file. The Speaking
// Manager engine registers the real implementations at startup, so
// there is no circular dependency and no behaviour change when the
// optional layer is absent or disabled.
// ============================================================

import type { AmongUsPlayer, AmongUsPlayerStatus } from '../types.js';

export interface SpeakingHooks {
  /** null = core module keeps its own mute decision. */
  getMeetingMuteOverride: (sessionId: string, player: AmongUsPlayer) => Promise<boolean | null>;
  onPhaseChange: (sessionId: string, phase: string, actorId: string | null) => Promise<void>;
  onPlayerStatusChange: (
    sessionId: string,
    userId: string,
    status: AmongUsPlayerStatus,
    actorId: string | null,
  ) => Promise<void>;
  onVoicePresence: (sessionId: string, userId: string, connected: boolean) => Promise<void>;
  onExternalOverride: (sessionId: string, userId: string) => Promise<void>;
}

let registered: SpeakingHooks | null = null;

export function registerSpeakingHooks(hooks: SpeakingHooks): void {
  registered = hooks;
}

export async function getMeetingMuteOverride(
  sessionId: string,
  player: AmongUsPlayer,
): Promise<boolean | null> {
  if (!registered) return null;
  return registered.getMeetingMuteOverride(sessionId, player);
}

export async function notifySpeakingPhaseChange(
  sessionId: string,
  phase: string,
  actorId: string | null,
): Promise<void> {
  if (!registered) return;
  await registered.onPhaseChange(sessionId, phase, actorId);
}

export async function notifySpeakingPlayerStatusChange(
  sessionId: string,
  userId: string,
  status: AmongUsPlayerStatus,
  actorId: string | null,
): Promise<void> {
  if (!registered) return;
  await registered.onPlayerStatusChange(sessionId, userId, status, actorId);
}

export async function notifySpeakingVoicePresence(
  sessionId: string,
  userId: string,
  connected: boolean,
): Promise<void> {
  if (!registered) return;
  await registered.onVoicePresence(sessionId, userId, connected);
}

export async function notifySpeakingExternalOverride(
  sessionId: string,
  userId: string,
): Promise<void> {
  if (!registered) return;
  await registered.onExternalOverride(sessionId, userId);
}
