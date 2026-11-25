// ============================================================
// Blade X — Among Us Manager · Voice decision logic
// Pure functions (no Discord/DB imports) so they can be tested safely.
// ============================================================

export interface VoiceDecisionInput {
  shouldMute: boolean;
  currentServerMute: boolean;
  originalServerMute: boolean;
  botManagedMute: boolean;
  externalOverride: boolean;
}

export type VoiceDecisionAction = 'mute' | 'unmute' | 'none';

export interface VoiceDecision {
  action: VoiceDecisionAction;
  reason?: string;
  /** The change looks external and should be flagged as an override. */
  markExternal?: boolean;
}

/**
 * Decide whether the bot is allowed to change a participant's server mute.
 *
 * Rules:
 *  - Never unmute someone who was muted before the session.
 *  - Never fight an external supervisor: external overrides are respected.
 *  - Only unmute mutes the bot itself applied.
 */
export function decideVoiceAction(input: VoiceDecisionInput): VoiceDecision {
  const {
    shouldMute,
    currentServerMute,
    originalServerMute,
    botManagedMute,
    externalOverride,
  } = input;

  if (shouldMute) {
    if (externalOverride) {
      return { action: 'none', reason: 'external-override' };
    }
    if (originalServerMute) {
      if (currentServerMute) return { action: 'none', reason: 'original-mute' };
      return { action: 'none', reason: 'external-unmute', markExternal: true };
    }
    if (currentServerMute) {
      if (botManagedMute) return { action: 'none', reason: 'already-muted' };
      return { action: 'none', reason: 'external-mute', markExternal: true };
    }
    return { action: 'mute' };
  }

  // Requested state: unmuted (meeting / restore).
  if (originalServerMute) {
    return { action: 'none', reason: 'original-mute' };
  }
  if (externalOverride) {
    return { action: 'none', reason: 'external-override' };
  }
  if (!currentServerMute) {
    return { action: 'none', reason: 'already-unmuted' };
  }
  if (!botManagedMute) {
    return { action: 'none', reason: 'external-mute', markExternal: true };
  }
  return { action: 'unmute' };
}

export interface RestoreDecisionInput {
  currentServerMute: boolean;
  originalServerMute: boolean;
  botManagedMute: boolean;
  externalOverride: boolean;
}

/** Decide how to safely restore a player when a round/session ends. */
export function decideRestoreAction(input: RestoreDecisionInput): VoiceDecision {
  const { currentServerMute, originalServerMute, botManagedMute, externalOverride } = input;

  if (!botManagedMute) return { action: 'none', reason: 'not-bot-managed' };
  if (externalOverride) return { action: 'none', reason: 'external-override' };
  if (originalServerMute) return { action: 'none', reason: 'original-mute' };
  if (!currentServerMute) return { action: 'none', reason: 'already-unmuted' };
  return { action: 'unmute' };
}
