// ============================================================
// Blade X — Among Us Manager · Speaking Manager (optional layer)
// Types and defaults. This layer is independent of the core game.
// ============================================================

export type SpeakingStage = 'round_robin' | 'open_discussion' | 'ended';
export type SpeakingRequestKind = 'round_robin' | 'open' | 'quick';
export type SpeakingQuickPriority = 'after-current' | 'end';

export interface SpeakingSettings {
  guildId: string;
  /** Persisted feature toggle — never required for the core system. */
  enabled: boolean;
  roundRobinSeconds: number;
  openDiscussionSeconds: number;
  quickInterjectionSeconds: number;
  extensionSeconds: number;
  quickEnabled: boolean;
  mandatoryRoundRobin: boolean;
  quickPriority: SpeakingQuickPriority;
  updatedAt: number;
}

export interface SpeakingEntry {
  userId: string;
  kind: SpeakingRequestKind;
  requestedAt: number;
  requestedBy: string;
  prioritized?: boolean;
  prioritizedBy?: string;
}

export interface SpeakingState {
  sessionId: string;
  guildId: string;
  active: boolean;
  stage: SpeakingStage;
  paused: boolean;
  /** Remaining milliseconds when paused (source of truth is turnEndsAt). */
  remainingMs: number;
  current: SpeakingEntry | null;
  queue: SpeakingEntry[];
  /** Users who already had their single Round Robin turn. */
  roundRobinDone: string[];
  startedAt: number;
  turnStartedAt: number | null;
  /** Absolute epoch ms — all timing is computed from this persisted value. */
  turnEndsAt: number | null;
  lastAction: string | null;
  lastActor: string | null;
  error: string | null;
  updatedAt: number;
}

export interface SpeakingResult {
  ok: boolean;
  message: string;
  warnings?: string[];
}

export const DEFAULT_SPEAKING_SETTINGS: Omit<SpeakingSettings, 'guildId' | 'updatedAt'> = {
  enabled: false,
  roundRobinSeconds: 30,
  openDiscussionSeconds: 20,
  quickInterjectionSeconds: 10,
  extensionSeconds: 10,
  quickEnabled: true,
  mandatoryRoundRobin: true,
  quickPriority: 'after-current',
};

export const SPEAKING_DURATION_LIMITS = { min: 5, max: 300 } as const;

export type SpeakingDurationField =
  | 'roundRobinSeconds'
  | 'openDiscussionSeconds'
  | 'quickInterjectionSeconds'
  | 'extensionSeconds';

export const DURATION_FIELD_LABELS: Record<SpeakingDurationField, string> = {
  roundRobinSeconds: 'Round Robin Duration',
  openDiscussionSeconds: 'Open Discussion Duration',
  quickInterjectionSeconds: 'Quick Interjection Duration',
  extensionSeconds: 'Extension Duration',
};

/** Strict validation: integer seconds inside a sane range. */
export function parseDuration(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value)) return null;
  if (value < SPEAKING_DURATION_LIMITS.min || value > SPEAKING_DURATION_LIMITS.max) return null;
  return value;
}

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** FIFO order: earlier requests first; priority entries are moved to the front. */
export function sortQueue(entries: SpeakingEntry[]): SpeakingEntry[] {
  return [...entries].sort((a, b) => a.requestedAt - b.requestedAt);
}

export function durationForKind(settings: SpeakingSettings, kind: SpeakingRequestKind): number {
  switch (kind) {
    case 'round_robin':
      return settings.roundRobinSeconds;
    case 'quick':
      return settings.quickInterjectionSeconds;
    case 'open':
    default:
      return settings.openDiscussionSeconds;
  }
}
