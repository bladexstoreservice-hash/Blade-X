// ============================================================
// Blade X — Among Us Manager · Speaking Manager storage
// Additive tables on the SAME Turso client. No existing table is
// changed, so the core Among Us schema stays untouched.
// ============================================================

import { dbClient } from '../../database.js';
import {
  DEFAULT_SPEAKING_SETTINGS,
  type SpeakingQuickPriority,
  type SpeakingSettings,
  type SpeakingState,
} from './types.js';

export const SPEAKING_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS amongus_speaking_settings (
    guild_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    round_robin_seconds INTEGER NOT NULL DEFAULT 30,
    open_discussion_seconds INTEGER NOT NULL DEFAULT 20,
    quick_interjection_seconds INTEGER NOT NULL DEFAULT 10,
    extension_seconds INTEGER NOT NULL DEFAULT 10,
    quick_enabled INTEGER NOT NULL DEFAULT 1,
    mandatory_round_robin INTEGER NOT NULL DEFAULT 1,
    quick_priority TEXT NOT NULL DEFAULT 'after-current',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS amongus_speaking_state (
    session_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amongus_speaking_state_guild
    ON amongus_speaking_state(guild_id, updated_at)`,
];

export async function initSpeakingDatabase(): Promise<void> {
  for (const sql of SPEAKING_SCHEMA) {
    try {
      await dbClient.execute(sql);
    } catch (e) {
      console.error('[Blade X] ❌ Speaking Manager schema error:', e);
    }
  }
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function mapSettings(row: Record<string, unknown>): SpeakingSettings {
  const priority = String(row.quick_priority ?? 'after-current');
  return {
    guildId: String(row.guild_id),
    enabled: num(row.enabled, 0) === 1,
    roundRobinSeconds: num(row.round_robin_seconds, DEFAULT_SPEAKING_SETTINGS.roundRobinSeconds),
    openDiscussionSeconds: num(row.open_discussion_seconds, DEFAULT_SPEAKING_SETTINGS.openDiscussionSeconds),
    quickInterjectionSeconds: num(row.quick_interjection_seconds, DEFAULT_SPEAKING_SETTINGS.quickInterjectionSeconds),
    extensionSeconds: num(row.extension_seconds, DEFAULT_SPEAKING_SETTINGS.extensionSeconds),
    quickEnabled: num(row.quick_enabled, 1) === 1,
    mandatoryRoundRobin: num(row.mandatory_round_robin, 1) === 1,
    quickPriority: priority === 'end' ? 'end' : 'after-current',
    updatedAt: num(row.updated_at, Date.now()),
  };
}

/** Missing rows mean "feature installed with defaults", never enabled. */
export async function getSpeakingSettings(guildId: string): Promise<SpeakingSettings> {
  const res = await dbClient.execute({
    sql: 'SELECT * FROM amongus_speaking_settings WHERE guild_id = ?',
    args: [guildId],
  });
  if (res.rows.length === 0) {
    return {
      guildId,
      ...DEFAULT_SPEAKING_SETTINGS,
      updatedAt: 0,
    };
  }
  return mapSettings(res.rows[0] as unknown as Record<string, unknown>);
}

export async function saveSpeakingSettings(settings: SpeakingSettings): Promise<void> {
  const now = Date.now();
  await dbClient.execute({
    sql: `INSERT INTO amongus_speaking_settings
      (guild_id, enabled, round_robin_seconds, open_discussion_seconds,
       quick_interjection_seconds, extension_seconds, quick_enabled,
       mandatory_round_robin, quick_priority, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        enabled = excluded.enabled,
        round_robin_seconds = excluded.round_robin_seconds,
        open_discussion_seconds = excluded.open_discussion_seconds,
        quick_interjection_seconds = excluded.quick_interjection_seconds,
        extension_seconds = excluded.extension_seconds,
        quick_enabled = excluded.quick_enabled,
        mandatory_round_robin = excluded.mandatory_round_robin,
        quick_priority = excluded.quick_priority,
        updated_at = excluded.updated_at`,
    args: [
      settings.guildId,
      settings.enabled ? 1 : 0,
      settings.roundRobinSeconds,
      settings.openDiscussionSeconds,
      settings.quickInterjectionSeconds,
      settings.extensionSeconds,
      settings.quickEnabled ? 1 : 0,
      settings.mandatoryRoundRobin ? 1 : 0,
      settings.quickPriority === 'end' ? 'end' : 'after-current',
      now,
    ],
  });
}

export async function setSpeakingEnabled(guildId: string, enabled: boolean): Promise<SpeakingSettings> {
  const settings = await getSpeakingSettings(guildId);
  settings.enabled = enabled;
  settings.updatedAt = Date.now();
  await saveSpeakingSettings(settings);
  return settings;
}

export async function setSpeakingToggle(
  guildId: string,
  field: 'quickEnabled' | 'mandatoryRoundRobin',
  enabled: boolean,
): Promise<SpeakingSettings> {
  const settings = await getSpeakingSettings(guildId);
  settings[field] = enabled;
  settings.updatedAt = Date.now();
  await saveSpeakingSettings(settings);
  return settings;
}

export async function setSpeakingQuickPriority(
  guildId: string,
  priority: SpeakingQuickPriority,
): Promise<SpeakingSettings> {
  const settings = await getSpeakingSettings(guildId);
  settings.quickPriority = priority === 'end' ? 'end' : 'after-current';
  settings.updatedAt = Date.now();
  await saveSpeakingSettings(settings);
  return settings;
}

function parseState(data: string): SpeakingState | null {
  try {
    const parsed = JSON.parse(data) as SpeakingState;
    if (!parsed || typeof parsed !== 'object' || !parsed.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getSpeakingState(sessionId: string): Promise<SpeakingState | null> {
  const res = await dbClient.execute({
    sql: 'SELECT data FROM amongus_speaking_state WHERE session_id = ?',
    args: [sessionId],
  });
  if (res.rows.length === 0) return null;
  return parseState(String(res.rows[0].data ?? ''));
}

export async function saveSpeakingState(state: SpeakingState): Promise<void> {
  const now = Date.now();
  state.updatedAt = now;
  await dbClient.execute({
    sql: `INSERT INTO amongus_speaking_state (session_id, guild_id, data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        guild_id = excluded.guild_id,
        data = excluded.data,
        updated_at = excluded.updated_at`,
    args: [state.sessionId, state.guildId, JSON.stringify(state), now],
  });
}

export async function deleteSpeakingState(sessionId: string): Promise<void> {
  await dbClient.execute({
    sql: 'DELETE FROM amongus_speaking_state WHERE session_id = ?',
    args: [sessionId],
  });
}

export async function listSpeakingStates(): Promise<SpeakingState[]> {
  const res = await dbClient.execute({
    sql: 'SELECT data FROM amongus_speaking_state ORDER BY updated_at',
  });
  const out: SpeakingState[] = [];
  for (const row of res.rows) {
    const state = parseState(String(row.data ?? ''));
    if (state) out.push(state);
  }
  return out;
}
