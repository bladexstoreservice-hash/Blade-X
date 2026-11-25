// ============================================================
// Blade X — Among Us Manager · Database layer
// Uses the SAME Turso client exported by src/database.ts.
// Schema is additive + idempotent (CREATE ... IF NOT EXISTS).
// ============================================================

import { dbClient } from '../database.js';
import { initSpeakingDatabase } from './speaking/database.js';
import type {
  AmongUsEventRow,
  AmongUsHelperRow,
  AmongUsPhase,
  AmongUsPlayer,
  AmongUsPlayerStatus,
  AmongUsSession,
  AmongUsSessionStatus,
  AmongUsSettings,
} from './types.js';

export const AMONGUS_SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS amongus_settings (
    guild_id TEXT PRIMARY KEY,
    voice_channel_id TEXT,
    control_channel_id TEXT,
    control_message_id TEXT,
    host_role_ids TEXT NOT NULL DEFAULT '[]',
    helper_role_ids TEXT NOT NULL DEFAULT '[]',
    log_channel_id TEXT,
    setup_completed INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS amongus_sessions (
    session_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    host_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    current_phase TEXT NOT NULL DEFAULT 'waiting',
    voice_channel_id TEXT,
    control_channel_id TEXT,
    control_message_id TEXT,
    last_action TEXT,
    recovery_mode INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    ended_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS amongus_players (
    session_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    display_name TEXT,
    player_status TEXT NOT NULL DEFAULT 'alive',
    is_connected INTEGER NOT NULL DEFAULT 1,
    original_server_mute INTEGER NOT NULL DEFAULT 0,
    bot_managed_mute INTEGER NOT NULL DEFAULT 0,
    external_override INTEGER NOT NULL DEFAULT 0,
    expected_server_mute INTEGER NOT NULL DEFAULT 0,
    restore_on_rejoin INTEGER NOT NULL DEFAULT 0,
    last_updated INTEGER NOT NULL,
    PRIMARY KEY (session_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS amongus_session_helpers (
    session_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_by TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS amongus_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    guild_id TEXT NOT NULL,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    target_user_id TEXT,
    previous_state TEXT,
    new_state TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_amongus_sessions_guild ON amongus_sessions(guild_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_amongus_players_guild ON amongus_players(guild_id, user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_amongus_players_session ON amongus_players(session_id)`,
  `CREATE INDEX IF NOT EXISTS idx_amongus_events_guild ON amongus_events(guild_id, created_at)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_amongus_one_active_session ON amongus_sessions(guild_id) WHERE status = 'active'`,
];

/** Columns added after the first release — safe to re-run. */
const AMONGUS_OPTIONAL_MIGRATIONS: string[] = [
  `ALTER TABLE amongus_sessions ADD COLUMN recovery_mode INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE amongus_players ADD COLUMN restore_on_rejoin INTEGER NOT NULL DEFAULT 0`,
];

export async function initAmongUsDatabase(): Promise<void> {
  for (const sql of AMONGUS_SCHEMA) {
    try {
      await dbClient.execute(sql);
    } catch (e) {
      console.error('[Blade X] ❌ Among Us schema error:', e);
    }
  }
  for (const sql of AMONGUS_OPTIONAL_MIGRATIONS) {
    try {
      await dbClient.execute(sql);
    } catch {
      // Column already exists — expected on every normal startup.
    }
  }
  // Optional Speaking Manager — additive tables only; core schema untouched.
  await initSpeakingDatabase();
  console.log('[Blade X] ✅ Among Us Manager database ready.');
}

// ============================================================
// Mapping helpers
// ============================================================
function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function nullableString(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function mapSettings(row: Record<string, unknown>): AmongUsSettings {
  return {
    guild_id: String(row.guild_id),
    voice_channel_id: nullableString(row.voice_channel_id),
    control_channel_id: nullableString(row.control_channel_id),
    control_message_id: nullableString(row.control_message_id),
    host_role_ids: String(row.host_role_ids ?? '[]'),
    helper_role_ids: String(row.helper_role_ids ?? '[]'),
    log_channel_id: nullableString(row.log_channel_id),
    setup_completed: num(row.setup_completed),
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
  };
}

function mapSession(row: Record<string, unknown>): AmongUsSession {
  return {
    session_id: String(row.session_id),
    guild_id: String(row.guild_id),
    host_user_id: String(row.host_user_id),
    status: String(row.status) as AmongUsSessionStatus,
    current_phase: String(row.current_phase) as AmongUsPhase,
    voice_channel_id: nullableString(row.voice_channel_id),
    control_channel_id: nullableString(row.control_channel_id),
    control_message_id: nullableString(row.control_message_id),
    last_action: nullableString(row.last_action),
    recovery_mode: num(row.recovery_mode),
    created_at: num(row.created_at),
    updated_at: num(row.updated_at),
    ended_at: row.ended_at === null || row.ended_at === undefined ? null : num(row.ended_at),
  };
}

function mapPlayer(row: Record<string, unknown>): AmongUsPlayer {
  return {
    session_id: String(row.session_id),
    guild_id: String(row.guild_id),
    user_id: String(row.user_id),
    display_name: nullableString(row.display_name),
    player_status: String(row.player_status) as AmongUsPlayerStatus,
    is_connected: num(row.is_connected),
    original_server_mute: num(row.original_server_mute),
    bot_managed_mute: num(row.bot_managed_mute),
    external_override: num(row.external_override),
    expected_server_mute: num(row.expected_server_mute),
    restore_on_rejoin: num(row.restore_on_rejoin),
    last_updated: num(row.last_updated),
  };
}

// ============================================================
// Settings
// ============================================================
export async function getAmongUsSettings(guildId: string): Promise<AmongUsSettings | null> {
  const res = await dbClient.execute({
    sql: 'SELECT * FROM amongus_settings WHERE guild_id = ?',
    args: [guildId],
  });
  if (res.rows.length === 0) return null;
  return mapSettings(res.rows[0] as unknown as Record<string, unknown>);
}

export async function upsertAmongUsSettings(input: {
  guild_id: string;
  voice_channel_id: string | null;
  control_channel_id: string | null;
  control_message_id: string | null;
  host_role_ids: string[];
  helper_role_ids: string[];
  log_channel_id: string | null;
  setup_completed: number;
}): Promise<void> {
  const now = Date.now();
  await dbClient.execute({
    sql: `INSERT INTO amongus_settings
      (guild_id, voice_channel_id, control_channel_id, control_message_id, host_role_ids, helper_role_ids, log_channel_id, setup_completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET
        voice_channel_id = excluded.voice_channel_id,
        control_channel_id = excluded.control_channel_id,
        control_message_id = excluded.control_message_id,
        host_role_ids = excluded.host_role_ids,
        helper_role_ids = excluded.helper_role_ids,
        log_channel_id = excluded.log_channel_id,
        setup_completed = excluded.setup_completed,
        updated_at = excluded.updated_at`,
    args: [
      input.guild_id,
      input.voice_channel_id,
      input.control_channel_id,
      input.control_message_id,
      JSON.stringify(input.host_role_ids),
      JSON.stringify(input.helper_role_ids),
      input.log_channel_id,
      input.setup_completed,
      now,
      now,
    ],
  });
}

export async function setAmongUsSetupCompleted(guildId: string, completed: boolean): Promise<void> {
  await dbClient.execute({
    sql: 'UPDATE amongus_settings SET setup_completed = ?, updated_at = ? WHERE guild_id = ?',
    args: [completed ? 1 : 0, Date.now(), guildId],
  });
}

export async function setAmongUsControlMessage(
  guildId: string,
  channelId: string | null,
  messageId: string | null,
): Promise<void> {
  await dbClient.execute({
    sql: 'UPDATE amongus_settings SET control_channel_id = ?, control_message_id = ?, updated_at = ? WHERE guild_id = ?',
    args: [channelId, messageId, Date.now(), guildId],
  });
}

export async function setAmongUsChannels(
  guildId: string,
  patch: { voice_channel_id?: string | null; control_channel_id?: string | null; log_channel_id?: string | null },
): Promise<void> {
  const current = await getAmongUsSettings(guildId);
  if (!current) return;
  await dbClient.execute({
    sql: 'UPDATE amongus_settings SET voice_channel_id = ?, control_channel_id = ?, log_channel_id = ?, updated_at = ? WHERE guild_id = ?',
    args: [
      patch.voice_channel_id !== undefined ? patch.voice_channel_id : current.voice_channel_id,
      patch.control_channel_id !== undefined ? patch.control_channel_id : current.control_channel_id,
      patch.log_channel_id !== undefined ? patch.log_channel_id : current.log_channel_id,
      Date.now(),
      guildId,
    ],
  });
}

export async function setAmongUsRoles(
  guildId: string,
  patch: { host_role_ids?: string[]; helper_role_ids?: string[] },
): Promise<void> {
  const current = await getAmongUsSettings(guildId);
  if (!current) return;
  const hostRoles = patch.host_role_ids ?? safeJsonArray(current.host_role_ids);
  const helperRoles = patch.helper_role_ids ?? safeJsonArray(current.helper_role_ids);
  await dbClient.execute({
    sql: 'UPDATE amongus_settings SET host_role_ids = ?, helper_role_ids = ?, updated_at = ? WHERE guild_id = ?',
    args: [JSON.stringify(hostRoles), JSON.stringify(helperRoles), Date.now(), guildId],
  });
}

export function safeJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ============================================================
// Sessions
// ============================================================
export async function createAmongUsSession(data: {
  session_id: string;
  guild_id: string;
  host_user_id: string;
  voice_channel_id: string | null;
  control_channel_id: string | null;
  control_message_id: string | null;
}): Promise<boolean> {
  const now = Date.now();
  try {
    await dbClient.execute({
      sql: `INSERT INTO amongus_sessions
        (session_id, guild_id, host_user_id, status, current_phase, voice_channel_id, control_channel_id, control_message_id, last_action, recovery_mode, created_at, updated_at, ended_at)
        VALUES (?, ?, ?, 'active', 'waiting', ?, ?, ?, ?, 0, ?, ?, NULL)`,
      args: [
        data.session_id,
        data.guild_id,
        data.host_user_id,
        data.voice_channel_id,
        data.control_channel_id,
        data.control_message_id,
        'Session created',
        now,
        now,
      ],
    });
    return true;
  } catch (e: unknown) {
    const message = String((e as { message?: string })?.message ?? e).toLowerCase();
    if (message.includes('unique') || message.includes('constraint')) return false;
    throw e;
  }
}

export async function getAmongUsSession(sessionId: string): Promise<AmongUsSession | null> {
  const res = await dbClient.execute({
    sql: 'SELECT * FROM amongus_sessions WHERE session_id = ?',
    args: [sessionId],
  });
  if (res.rows.length === 0) return null;
  return mapSession(res.rows[0] as unknown as Record<string, unknown>);
}

export async function getActiveAmongUsSession(guildId: string): Promise<AmongUsSession | null> {
  const res = await dbClient.execute({
    sql: "SELECT * FROM amongus_sessions WHERE guild_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    args: [guildId],
  });
  if (res.rows.length === 0) return null;
  return mapSession(res.rows[0] as unknown as Record<string, unknown>);
}

export async function listActiveAmongUsSessions(): Promise<AmongUsSession[]> {
  const res = await dbClient.execute({
    sql: "SELECT * FROM amongus_sessions WHERE status = 'active' ORDER BY created_at ASC",
  });
  return res.rows.map((row) => mapSession(row as unknown as Record<string, unknown>));
}

export async function setAmongUsSessionPhase(
  sessionId: string,
  phase: AmongUsPhase,
  lastAction: string | null,
): Promise<void> {
  await dbClient.execute({
    sql: 'UPDATE amongus_sessions SET current_phase = ?, last_action = ?, updated_at = ? WHERE session_id = ?',
    args: [phase, lastAction, Date.now(), sessionId],
  });
}

export async function setAmongUsSessionLastAction(sessionId: string, lastAction: string): Promise<void> {
  await dbClient.execute({
    sql: 'UPDATE amongus_sessions SET last_action = ?, updated_at = ? WHERE session_id = ?',
    args: [lastAction, Date.now(), sessionId],
  });
}

export async function setAmongUsSessionRecovery(sessionId: string, enabled: boolean): Promise<void> {
  await dbClient.execute({
    sql: 'UPDATE amongus_sessions SET recovery_mode = ?, updated_at = ? WHERE session_id = ?',
    args: [enabled ? 1 : 0, Date.now(), sessionId],
  });
}

export async function setAmongUsSessionPanelRefs(
  sessionId: string,
  channelId: string | null,
  messageId: string | null,
): Promise<void> {
  await dbClient.execute({
    sql: 'UPDATE amongus_sessions SET control_channel_id = ?, control_message_id = ?, updated_at = ? WHERE session_id = ?',
    args: [channelId, messageId, Date.now(), sessionId],
  });
}

export async function endAmongUsSession(sessionId: string): Promise<void> {
  const now = Date.now();
  await dbClient.execute({
    sql: "UPDATE amongus_sessions SET status = 'ended', current_phase = 'ended', ended_at = ?, updated_at = ? WHERE session_id = ?",
    args: [now, now, sessionId],
  });
}

// ============================================================
// Players
// ============================================================
export async function addAmongUsPlayer(data: {
  session_id: string;
  guild_id: string;
  user_id: string;
  display_name: string | null;
  player_status?: AmongUsPlayerStatus;
  is_connected?: number;
  original_server_mute?: number;
  bot_managed_mute?: number;
  external_override?: number;
  expected_server_mute?: number;
  restore_on_rejoin?: number;
}): Promise<void> {
  const now = Date.now();
  await dbClient.execute({
    sql: `INSERT OR REPLACE INTO amongus_players
      (session_id, guild_id, user_id, display_name, player_status, is_connected, original_server_mute, bot_managed_mute, external_override, expected_server_mute, restore_on_rejoin, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.session_id,
      data.guild_id,
      data.user_id,
      data.display_name,
      data.player_status ?? 'alive',
      data.is_connected ?? 1,
      data.original_server_mute ?? 0,
      data.bot_managed_mute ?? 0,
      data.external_override ?? 0,
      data.expected_server_mute ?? data.original_server_mute ?? 0,
      data.restore_on_rejoin ?? 0,
      now,
    ],
  });
}

export async function getAmongUsPlayers(sessionId: string): Promise<AmongUsPlayer[]> {
  const res = await dbClient.execute({
    sql: 'SELECT * FROM amongus_players WHERE session_id = ? ORDER BY player_status ASC, display_name ASC, user_id ASC',
    args: [sessionId],
  });
  return res.rows.map((row) => mapPlayer(row as unknown as Record<string, unknown>));
}

export async function getAmongUsPlayer(sessionId: string, userId: string): Promise<AmongUsPlayer | null> {
  const res = await dbClient.execute({
    sql: 'SELECT * FROM amongus_players WHERE session_id = ? AND user_id = ?',
    args: [sessionId, userId],
  });
  if (res.rows.length === 0) return null;
  return mapPlayer(res.rows[0] as unknown as Record<string, unknown>);
}

export async function updateAmongUsPlayer(
  sessionId: string,
  userId: string,
  patch: Partial<AmongUsPlayer>,
): Promise<void> {
  const current = await getAmongUsPlayer(sessionId, userId);
  if (!current) return;
  const next = { ...current, ...patch, last_updated: patch.last_updated ?? Date.now() };
  await dbClient.execute({
    sql: `UPDATE amongus_players SET
      display_name = ?, player_status = ?, is_connected = ?, original_server_mute = ?,
      bot_managed_mute = ?, external_override = ?, expected_server_mute = ?,
      restore_on_rejoin = ?, last_updated = ?
      WHERE session_id = ? AND user_id = ?`,
    args: [
      next.display_name,
      next.player_status,
      next.is_connected,
      next.original_server_mute,
      next.bot_managed_mute,
      next.external_override,
      next.expected_server_mute,
      next.restore_on_rejoin,
      next.last_updated,
      sessionId,
      userId,
    ],
  });
}

export async function deleteAmongUsPlayer(sessionId: string, userId: string): Promise<void> {
  await dbClient.execute({
    sql: 'DELETE FROM amongus_players WHERE session_id = ? AND user_id = ?',
    args: [sessionId, userId],
  });
}

export interface AmongUsPendingRestoreRow extends AmongUsPlayer {
  session_voice_channel_id: string | null;
}

export async function getAmongUsPendingRestores(
  guildId: string,
  userId: string,
): Promise<AmongUsPendingRestoreRow[]> {
  const res = await dbClient.execute({
    sql: `SELECT p.*, s.voice_channel_id AS session_voice_channel_id
      FROM amongus_players p
      JOIN amongus_sessions s ON s.session_id = p.session_id
      WHERE p.guild_id = ? AND p.user_id = ? AND p.restore_on_rejoin = 1 AND p.bot_managed_mute = 1`,
    args: [guildId, userId],
  });
  return res.rows.map((row) => {
    const raw = row as unknown as Record<string, unknown>;
    return { ...mapPlayer(raw), session_voice_channel_id: nullableString(raw.session_voice_channel_id) };
  });
}

// ============================================================
// Session helpers (assistant hosts)
// ============================================================
export async function addAmongUsHelper(data: {
  session_id: string;
  guild_id: string;
  user_id: string;
  added_by: string;
}): Promise<void> {
  await dbClient.execute({
    sql: `INSERT OR IGNORE INTO amongus_session_helpers (session_id, guild_id, user_id, added_by, created_at)
      VALUES (?, ?, ?, ?, ?)`,
    args: [data.session_id, data.guild_id, data.user_id, data.added_by, Date.now()],
  });
}

export async function removeAmongUsHelper(sessionId: string, userId: string): Promise<void> {
  await dbClient.execute({
    sql: 'DELETE FROM amongus_session_helpers WHERE session_id = ? AND user_id = ?',
    args: [sessionId, userId],
  });
}

export async function getAmongUsHelperIds(sessionId: string): Promise<string[]> {
  const res = await dbClient.execute({
    sql: 'SELECT user_id FROM amongus_session_helpers WHERE session_id = ? ORDER BY created_at ASC',
    args: [sessionId],
  });
  return res.rows.map((row) => String(row.user_id));
}

export async function getAmongUsHelperRows(sessionId: string): Promise<AmongUsHelperRow[]> {
  const res = await dbClient.execute({
    sql: 'SELECT * FROM amongus_session_helpers WHERE session_id = ? ORDER BY created_at ASC',
    args: [sessionId],
  });
  return res.rows.map((row) => {
    const raw = row as unknown as Record<string, unknown>;
    return {
      session_id: String(raw.session_id),
      guild_id: String(raw.guild_id),
      user_id: String(raw.user_id),
      added_by: nullableString(raw.added_by),
      created_at: num(raw.created_at),
    };
  });
}

// ============================================================
// Events / audit log
// ============================================================
export async function logAmongUsEvent(data: {
  guild_id: string;
  session_id?: string | null;
  actor_user_id?: string | null;
  action: string;
  target_user_id?: string | null;
  previous_state?: string | null;
  new_state?: string | null;
}): Promise<void> {
  await dbClient.execute({
    sql: `INSERT INTO amongus_events
      (session_id, guild_id, actor_user_id, action, target_user_id, previous_state, new_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      data.session_id ?? null,
      data.guild_id,
      data.actor_user_id ?? null,
      data.action,
      data.target_user_id ?? null,
      data.previous_state ?? null,
      data.new_state ?? null,
      Date.now(),
    ],
  });
}

export async function getRecentAmongUsEvents(guildId: string, limit = 20): Promise<AmongUsEventRow[]> {
  const res = await dbClient.execute({
    sql: 'SELECT * FROM amongus_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?',
    args: [guildId, limit],
  });
  return res.rows.map((row) => {
    const raw = row as unknown as Record<string, unknown>;
    return {
      id: num(raw.id),
      session_id: nullableString(raw.session_id),
      guild_id: String(raw.guild_id),
      actor_user_id: nullableString(raw.actor_user_id),
      action: String(raw.action),
      target_user_id: nullableString(raw.target_user_id),
      previous_state: nullableString(raw.previous_state),
      new_state: nullableString(raw.new_state),
      created_at: num(raw.created_at),
    };
  });
}
