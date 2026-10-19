// ============================================================
// Blade X — Emoji Registry (v5 — Turso)
// ============================================================
import { dbClient } from './database.js';
import { config } from './config.js';
import type { Client } from 'discord.js';

// ============================================================
// Client ref for Custom Emoji ID resolution
// ============================================================
let emojiClientRef: Client | null = null;

export function setEmojiClient(client: Client): void {
  emojiClientRef = client;
}

// ============================================================
// Defaults
// ============================================================
export interface EmojiDefault {
  key: string;
  value: string;
  description: string;
}

export const DEFAULT_EMOJIS: EmojiDefault[] = [
  { key: 'success', value: '✅', description: 'نجاح عام' },
  { key: 'error', value: '❌', description: 'فشل عام' },
  { key: 'warning', value: '⚠️', description: 'تحذير عام' },
  { key: 'info', value: 'ℹ️', description: 'معلومة' },
  { key: 'loading', value: '⏳', description: 'تحميل' },
  { key: 'welcome', value: '👋', description: 'زر الترحيب' },
  { key: 'rules', value: '📜', description: 'زر القوانين' },
  { key: 'roles', value: '🎭', description: 'زر الرولات' },
  { key: 'community', value: '💬', description: 'زر الروم الإضافي' },
  { key: 'log_join', value: '👋', description: 'Join Log' },
  { key: 'log_leave', value: '🚪', description: 'Leave Log' },
  { key: 'log_voice', value: '🎙️', description: 'Voice Log' },
  { key: 'log_message', value: '💬', description: 'Message Log' },
  { key: 'log_channel', value: '📁', description: 'Channel Log' },
  { key: 'log_role', value: '🎭', description: 'Role Log' },
  { key: 'log_moderation', value: '🔨', description: 'Moderation Log' },
  { key: 'log_security', value: '🛡️', description: 'Security Log' },
  { key: 'role_add', value: '✅', description: 'إضافة رول' },
  { key: 'role_remove', value: '➖', description: 'إزالة رول' },
  { key: 'movie', value: '🎬', description: 'Movie Night عام' },
  { key: 'movie_thread', value: '💬', description: 'Thread المراجعات' },
  { key: 'review_star_filled', value: `<:star_filled:${config.customEmojis.starFilled}>`, description: 'نجمة ممتلئة' },
  { key: 'review_star_empty', value: `<:star_empty:${config.customEmojis.starEmpty}>`, description: 'نجمة فارغة' },
  { key: 'voice_join', value: '🎙️', description: 'دخول روم صوتي' },
  { key: 'voice_leave', value: '🔇', description: 'مغادرة روم صوتي' },
  { key: 'voice_move', value: '🔀', description: 'تنقل بين الرومات' },
];

// ============================================================
// Caches (loaded via initEmojiRegistry)
// ============================================================
interface EmojiRow {
  key: string;
  value: string;
  default_value: string;
  description: string | null;
  updated_at: number;
}

interface ReplacementRow {
  id: number;
  original: string;
  replacement: string;
  scope: string;
  enabled: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

let emojisCache: Map<string, EmojiRow> | null = null;
let replacementsCache: ReplacementRow[] | null = null;
let warnedNotInit = false;

function warnNotInit(): void {
  if (!warnedNotInit) {
    console.warn('[Blade X] ⚠️ EmojiRegistry not initialized — call initEmojiRegistry() after initDatabase()');
    warnedNotInit = true;
  }
}

// ============================================================
// Init
// ============================================================
export async function initEmojiRegistry(): Promise<void> {
  // 1. Create emoji_replacements table (idempotent)
  await dbClient.executeMultiple(`
    CREATE TABLE IF NOT EXISTS emoji_replacements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original TEXT NOT NULL,
      replacement TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'global',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(original, scope)
    );
    CREATE INDEX IF NOT EXISTS idx_emoji_repl_original ON emoji_replacements(original);
    CREATE INDEX IF NOT EXISTS idx_emoji_repl_enabled ON emoji_replacements(enabled);
  `);

  // 2. Load emojis cache
  const emojiRows = await dbClient.execute('SELECT key, value, default_value, description, updated_at FROM emoji_registry');
  emojisCache = new Map();
  for (const row of emojiRows.rows) {
    emojisCache.set(String(row.key), {
      key: String(row.key),
      value: String(row.value ?? ''),
      default_value: String(row.default_value ?? ''),
      description: row.description != null ? String(row.description) : null,
      updated_at: Number(row.updated_at ?? 0),
    });
  }

  // 3. Load replacements cache
  const reps = await dbClient.execute('SELECT * FROM emoji_replacements WHERE enabled = 1');
  replacementsCache = reps.rows.map((r) => ({
    id: Number(r.id),
    original: String(r.original),
    replacement: String(r.replacement),
    scope: String(r.scope),
    enabled: Number(r.enabled),
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  }));

  console.log(`[Blade X] ✅ Emoji Registry loaded: ${emojisCache.size} emojis, ${replacementsCache.length} replacements`);
}

// ============================================================
// Seed defaults (call once after initDatabase, before initEmojiRegistry)
// ============================================================
export async function seedEmojiDefaults(): Promise<void> {
  const now = Date.now();
  const stmts = DEFAULT_EMOJIS.map((e) => ({
    sql: `INSERT INTO emoji_registry (key, value, default_value, description, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        default_value = excluded.default_value,
        description = excluded.description`,
    args: [e.key, e.value, e.value, e.description, now],
  }));
  await dbClient.batch(stmts, 'write');
  console.log(`[Blade X] ✅ Seeded ${DEFAULT_EMOJIS.length} emojis in registry`);
}

// ============================================================
// Core resolver
// ============================================================
export function resolveStoredEmojiValue(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Full form — as-is
  if (/^<a?:\w+:\d{17,20}>$/.test(trimmed)) return trimmed;

  // Raw snowflake → resolve via guild cache
  if (/^\d{17,20}$/.test(trimmed)) {
    const guild = emojiClientRef?.guilds.cache.get(config.guildId);
    const emoji = guild?.emojis.cache.get(trimmed);
    if (emoji) {
      return `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>`;
    }
    return '';
  }

  return trimmed;
}

// ============================================================
// Replacement application (sync — reads from cache)
// ============================================================
export function applyEmojiReplacements(text: string, scope = 'global'): string {
  if (!text) return text;
  if (!replacementsCache || replacementsCache.length === 0) return text;
  const reps = replacementsCache.filter((r) => r.scope === 'global' || r.scope === scope);
  if (reps.length === 0) return text;

  let out = text;
  const sorted = [...reps].sort((a, b) => b.original.length - a.original.length);

  for (const r of sorted) {
    if (!r.original) continue;
    const finalRepl = resolveStoredEmojiValue(r.replacement) || r.replacement;
    out = out.split(r.original).join(finalRepl);
  }

  return out;
}

export function applyReplacementToButtonEmoji(value: string, scope = 'global'): string {
  if (!value) return value;
  if (!replacementsCache || replacementsCache.length === 0) return value;
  const reps = replacementsCache.filter((r) => r.scope === 'global' || r.scope === scope);
  if (reps.length === 0) return value;
  for (const r of reps) {
    if (r.original === value) {
      return resolveStoredEmojiValue(r.replacement) || r.replacement;
    }
  }
  return value;
}

// ============================================================
// Replacement CRUD (async)
// ============================================================
export async function listReplacements(): Promise<ReplacementRow[]> {
  const r = await dbClient.execute('SELECT * FROM emoji_replacements ORDER BY updated_at DESC');
  return r.rows.map((row) => ({
    id: Number(row.id),
    original: String(row.original),
    replacement: String(row.replacement),
    scope: String(row.scope),
    enabled: Number(row.enabled),
    created_by: row.created_by != null ? String(row.created_by) : null,
    created_at: Number(row.created_at),
    updated_at: Number(row.updated_at),
  }));
}

export async function upsertReplacement(data: {
  original: string;
  replacement: string;
  scope?: string;
  enabled?: number;
  createdBy?: string;
}): Promise<number> {
  const now = Date.now();
  const scope = data.scope ?? 'global';
  const existing = await dbClient.execute({
    sql: 'SELECT id FROM emoji_replacements WHERE original = ? AND scope = ?',
    args: [data.original, scope],
  });

  let id: number;
  if (existing.rows.length > 0) {
    id = Number(existing.rows[0].id);
    await dbClient.execute({
      sql: 'UPDATE emoji_replacements SET replacement = ?, enabled = ?, updated_at = ? WHERE id = ?',
      args: [data.replacement, data.enabled ?? 1, now, id],
    });
  } else {
    const r = await dbClient.execute({
      sql: 'INSERT INTO emoji_replacements (original, replacement, scope, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [data.original, data.replacement, scope, data.enabled ?? 1, data.createdBy ?? null, now, now],
    });
    id = Number(r.lastInsertRowid ?? 0);
  }

  await refreshReplacementsCache();
  return id;
}

export async function deleteReplacement(id: number): Promise<void> {
  await dbClient.execute({ sql: 'DELETE FROM emoji_replacements WHERE id = ?', args: [id] });
  await refreshReplacementsCache();
}

export async function toggleReplacement(id: number, enabled: boolean): Promise<void> {
  await dbClient.execute({
    sql: 'UPDATE emoji_replacements SET enabled = ?, updated_at = ? WHERE id = ?',
    args: [enabled ? 1 : 0, Date.now(), id],
  });
  await refreshReplacementsCache();
}

async function refreshReplacementsCache(): Promise<void> {
  const reps = await dbClient.execute('SELECT * FROM emoji_replacements WHERE enabled = 1');
  replacementsCache = reps.rows.map((r) => ({
    id: Number(r.id),
    original: String(r.original),
    replacement: String(r.replacement),
    scope: String(r.scope),
    enabled: Number(r.enabled),
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at: Number(r.created_at),
    updated_at: Number(r.updated_at),
  }));
}

export function invalidateReplacementsCache(): void {
  // Kept for backward compat — no-op after init; refreshReplacementsCache() is async
  // Callers should await upsertReplacement/deleteReplacement/toggleReplacement directly
}

// ============================================================
// getEmoji — sync read from cache
// ============================================================
export function getEmoji(key: string, fallback = ''): string {
  if (!emojisCache) {
    warnNotInit();
  }

  let raw: string | null = null;
  const row = emojisCache?.get(key);
  if (row?.value) raw = row.value;

  if (!raw) {
    const def = DEFAULT_EMOJIS.find((e) => e.key === key);
    if (def?.value) raw = def.value;
  }

  if (!raw) return fallback;

  const resolved = resolveStoredEmojiValue(raw) || raw;
  return applyEmojiReplacements(resolved);
}

// ============================================================
// CRUD
// ============================================================
export function getAllEmojis(): EmojiRow[] {
  if (!emojisCache) return [];
  return [...emojisCache.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function getAllEmojisResolved(): Array<EmojiRow & { resolved: string }> {
  return getAllEmojis().map((r) => ({
    ...r,
    resolved: resolveStoredEmojiValue(r.value) || r.value,
  }));
}

export function getEmojiRow(key: string): EmojiRow | undefined {
  return emojisCache?.get(key);
}

export async function setEmoji(key: string, value: string): Promise<void> {
  const now = Date.now();
  const defaultEntry = DEFAULT_EMOJIS.find((e) => e.key === key);
  await dbClient.execute({
    sql: `INSERT INTO emoji_registry (key, value, default_value, description, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, defaultEntry?.value ?? value, defaultEntry?.description ?? null, now],
  });

  if (!emojisCache) emojisCache = new Map();
  emojisCache.set(key, {
    key,
    value,
    default_value: defaultEntry?.value ?? value,
    description: defaultEntry?.description ?? null,
    updated_at: now,
  });
}

export async function resetEmoji(key: string): Promise<void> {
  const def = DEFAULT_EMOJIS.find((e) => e.key === key);
  if (!def) return;
  const now = Date.now();
  await dbClient.execute({
    sql: 'UPDATE emoji_registry SET value = ?, updated_at = ? WHERE key = ?',
    args: [def.value, now, key],
  });
  const row = emojisCache?.get(key);
  if (row) {
    row.value = def.value;
    row.updated_at = now;
  }
}

export async function resetAllEmojis(): Promise<void> {
  const now = Date.now();
  const stmts = DEFAULT_EMOJIS.map((e) => ({
    sql: 'UPDATE emoji_registry SET value = default_value, updated_at = ? WHERE key = ?',
    args: [now, e.key],
  }));
  await dbClient.batch(stmts, 'write');
  if (emojisCache) {
    for (const e of DEFAULT_EMOJIS) {
      const row = emojisCache.get(e.key);
      if (row) {
        row.value = row.default_value;
        row.updated_at = now;
      }
    }
  }
}

// ============================================================
// Validation
// ============================================================
export function isValidEmojiFormat(value: string): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^<a?:\w+:\d{17,20}>$/.test(trimmed)) return true;
  if (/^\d{17,20}$/.test(trimmed)) return true;
  if (trimmed.length >= 1 && trimmed.length <= 20) return true;
  return false;
}

export function validateEmojiInput(value: string): { valid: boolean; reason?: string } {
  const raw = (value ?? '').trim();
  if (!raw) return { valid: true };
  if (/^<a?:\w+:\d{17,20}>$/.test(raw)) return { valid: true };

  if (/^\d{17,20}$/.test(raw)) {
    const guild = emojiClientRef?.guilds.cache.get(config.guildId);
    if (!guild) return { valid: true };
    const emoji = guild.emojis.cache.get(raw);
    if (emoji) return { valid: true };
    return { valid: false, reason: `Emoji ID ${raw} غير موجود في كاش السيرفر` };
  }

  if (raw.length >= 1 && raw.length <= 20) return { valid: true };
  return { valid: false, reason: 'تنسيق الإيموجي غير صالح' };
}

export function starStringFromRegistry(rating: number): string {
  const filled = getEmoji('review_star_filled', '⭐');
  const empty = getEmoji('review_star_empty', '☆');
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return filled.repeat(n) + empty.repeat(5 - n);
}