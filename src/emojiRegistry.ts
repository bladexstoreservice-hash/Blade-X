import db from './database.js';
import { config } from './config.js';
import type { Client } from 'discord.js';

// ===== تهيئة الجداول =====
db.exec(`
  CREATE TABLE IF NOT EXISTS emoji_registry (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    default_value TEXT NOT NULL,
    description TEXT,
    updated_at INTEGER NOT NULL
  );

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

export function seedEmojiDefaults(): void {
  const now = Date.now();
  const insert = db.prepare(`
    INSERT INTO emoji_registry (key, value, default_value, description, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      default_value = excluded.default_value,
      description = excluded.description
  `);
  const tx = db.transaction(() => {
    for (const e of DEFAULT_EMOJIS) insert.run(e.key, e.value, e.value, e.description, now);
  });
  tx();
  console.log(`[Blade X] ✅ Seeded ${DEFAULT_EMOJIS.length} emojis in registry`);
}

interface EmojiRow {
  key: string;
  value: string;
  default_value: string;
  description: string | null;
  updated_at: number;
}

// ============================================================
// Core resolver: raw value → Discord-ready format
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

  // Unicode / plain text — as-is
  return trimmed;
}

// ============================================================
// Replacement Map (cached)
// ============================================================
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

let replacementsCache: ReplacementRow[] | null = null;
let replacementsCacheTime = 0;
const REPLACEMENTS_CACHE_MS = 30_000;

function loadReplacements(): ReplacementRow[] {
  const now = Date.now();
  if (replacementsCache && now - replacementsCacheTime < REPLACEMENTS_CACHE_MS) {
    return replacementsCache;
  }
  try {
    replacementsCache = db
      .prepare('SELECT * FROM emoji_replacements WHERE enabled = 1')
      .all() as ReplacementRow[];
    replacementsCacheTime = now;
    return replacementsCache;
  } catch {
    replacementsCache = [];
    replacementsCacheTime = now;
    return [];
  }
}

export function invalidateReplacementsCache(): void {
  replacementsCache = null;
  replacementsCacheTime = 0;
}

/**
 * Apply replacement map to any text containing emojis.
 */
export function applyEmojiReplacements(text: string, scope = 'global'): string {
  if (!text) return text;
  const reps = loadReplacements().filter((r) => r.scope === 'global' || r.scope === scope);
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

/**
 * Apply replacement map to a button's emoji value.
 */
export function applyReplacementToButtonEmoji(value: string, scope = 'global'): string {
  if (!value) return value;
  const reps = loadReplacements().filter((r) => r.scope === 'global' || r.scope === scope);
  if (reps.length === 0) return value;
  for (const r of reps) {
    if (r.original === value) {
      return resolveStoredEmojiValue(r.replacement) || r.replacement;
    }
  }
  return value;
}

// ============================================================
// Replacement CRUD
// ============================================================
export function listReplacements(): ReplacementRow[] {
  return db
    .prepare('SELECT * FROM emoji_replacements ORDER BY updated_at DESC')
    .all() as ReplacementRow[];
}

export function upsertReplacement(data: {
  original: string;
  replacement: string;
  scope?: string;
  enabled?: number;
  createdBy?: string;
}): number {
  const now = Date.now();
  const scope = data.scope ?? 'global';
  const existing = db
    .prepare('SELECT id FROM emoji_replacements WHERE original = ? AND scope = ?')
    .get(data.original, scope) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      'UPDATE emoji_replacements SET replacement = ?, enabled = ?, updated_at = ? WHERE id = ?',
    ).run(data.replacement, data.enabled ?? 1, now, existing.id);
    invalidateReplacementsCache();
    return existing.id;
  }

  const info = db
    .prepare(
      'INSERT INTO emoji_replacements (original, replacement, scope, enabled, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(data.original, data.replacement, scope, data.enabled ?? 1, data.createdBy ?? null, now, now);
  invalidateReplacementsCache();
  return Number(info.lastInsertRowid);
}

export function deleteReplacement(id: number): void {
  db.prepare('DELETE FROM emoji_replacements WHERE id = ?').run(id);
  invalidateReplacementsCache();
}

export function toggleReplacement(id: number, enabled: boolean): void {
  db.prepare('UPDATE emoji_replacements SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, Date.now(), id);
  invalidateReplacementsCache();
}

// ============================================================
// getEmoji — resolves stored value + applies replacements
// ============================================================
export function getEmoji(key: string, fallback = ''): string {
  const row = db
    .prepare('SELECT value FROM emoji_registry WHERE key = ?')
    .get(key) as { value: string } | undefined;

  let raw: string | null = null;

  if (row?.value) raw = row.value;

  if (!raw) {
    const def = DEFAULT_EMOJIS.find((e) => e.key === key);
    if (def?.value) raw = def.value;
  }

  if (!raw) return fallback;

  const resolved = resolveStoredEmojiValue(raw) || raw;
  return applyEmojiReplacements(resolved);
}

export function getAllEmojis(): EmojiRow[] {
  return db.prepare('SELECT * FROM emoji_registry ORDER BY key').all() as EmojiRow[];
}

export function getAllEmojisResolved(): Array<EmojiRow & { resolved: string }> {
  return getAllEmojis().map((r) => ({
    ...r,
    resolved: resolveStoredEmojiValue(r.value) || r.value,
  }));
}

export function getEmojiRow(key: string): EmojiRow | undefined {
  return db.prepare('SELECT * FROM emoji_registry WHERE key = ?').get(key) as EmojiRow | undefined;
}

export function setEmoji(key: string, value: string): void {
  db.prepare(`
    INSERT INTO emoji_registry (key, value, default_value, description, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(
    key,
    value,
    DEFAULT_EMOJIS.find((e) => e.key === key)?.value ?? value,
    DEFAULT_EMOJIS.find((e) => e.key === key)?.description ?? null,
    Date.now(),
  );
}

export function resetEmoji(key: string): void {
  const def = DEFAULT_EMOJIS.find((e) => e.key === key);
  if (!def) return;
  db.prepare('UPDATE emoji_registry SET value = ?, updated_at = ? WHERE key = ?')
    .run(def.value, Date.now(), key);
}

export function resetAllEmojis(): void {
  const now = Date.now();
  const stmt = db.prepare('UPDATE emoji_registry SET value = default_value, updated_at = ? WHERE key = ?');
  const tx = db.transaction(() => {
    for (const e of DEFAULT_EMOJIS) stmt.run(now, e.key);
  });
  tx();
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