import { createClient, type Client } from '@libsql/client';
import 'dotenv/config';

// ✅ Definite assignment — سيُعيَّن في initDatabase قبل أي استخدام
let client!: Client;
let settingsCache = new Map<string, string>();

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^(libsql|https?|wss?|file):/.test(t)) return t;
  return `libsql://${t}`;
}

export async function initDatabase(): Promise<void> {
  const rawUrl = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!rawUrl) {
    console.error('[Blade X] ❌ TURSO_DATABASE_URL غير موجود في .env');
    process.exit(1);
  }
  if (!authToken) {
    console.error('[Blade X] ❌ TURSO_AUTH_TOKEN غير موجود في .env');
    process.exit(1);
  }

  client = createClient({
    url: normalizeUrl(rawUrl),
    authToken,
  });

  console.log('[Blade X] 🔄 الاتصال بقاعدة بيانات Turso...');

  try {
    await client.execute('SELECT 1');
  } catch (e) {
    console.error('[Blade X] ❌ فشل الاتصال بـ Turso. تأكد من الرابط والتوكن (TURSO_AUTH_TOKEN).');
    process.exit(1);
  }

  const schemaQueries = [
    `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS welcome_phrases (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS welcome_buttons (button_id TEXT PRIMARY KEY, label TEXT NOT NULL, emoji_id TEXT, url TEXT, style TEXT DEFAULT 'Primary', enabled INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS self_roles (id INTEGER PRIMARY KEY AUTOINCREMENT, role_id TEXT NOT NULL UNIQUE, emoji_id TEXT, label TEXT NOT NULL, description TEXT, sort_order INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS moderation_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target_id TEXT NOT NULL, moderator_id TEXT, reason TEXT, duration_ms INTEGER, expires_at INTEGER, dm_status TEXT, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, user_id TEXT, details TEXT, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS member_history (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, event_type TEXT NOT NULL, account_created_at INTEGER, joined_at INTEGER, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS movie_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, movie_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', voice_channel_id TEXT, reviews_channel_id TEXT, thread_id TEXT, summary_message_id TEXT, created_by TEXT, started_at INTEGER NOT NULL, closed_at INTEGER, separator_sent INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS movie_recipients (session_id INTEGER NOT NULL, user_id TEXT NOT NULL, dm_status TEXT DEFAULT 'pending', dm_message_id TEXT, PRIMARY KEY (session_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS movie_ratings (session_id INTEGER NOT NULL, user_id TEXT NOT NULL, rating INTEGER NOT NULL, comment TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, dm_message_id TEXT, dm_channel_id TEXT, comment_posted INTEGER DEFAULT 0, review_message_id TEXT, PRIMARY KEY (session_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS movie_drafts (user_id TEXT NOT NULL, session_id INTEGER NOT NULL, rating INTEGER DEFAULT 0, comment TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, session_id))`,
    `CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS emoji_registry (key TEXT PRIMARY KEY, value TEXT NOT NULL, default_value TEXT NOT NULL, description TEXT, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS mb_drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, payload TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS mb_history (id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL, message_id TEXT, payload TEXT NOT NULL, sent_by TEXT, sent_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS spam_trap_log (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT, content TEXT, punishment TEXT NOT NULL, duration_ms INTEGER, success INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS media_channels (channel_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1, title_format TEXT DEFAULT '{user}', author_emoji TEXT DEFAULT '', color TEXT DEFAULT '#f59e0b', footer_from_label TEXT DEFAULT 'Pumpkins from', footer_others_label TEXT DEFAULT 'and {n} others', reaction_emoji TEXT DEFAULT '🎃', comment_emoji TEXT DEFAULT '💬', delete_emoji TEXT DEFAULT '🗑️', viewall_emoji TEXT DEFAULT '👥', button_view_all_label TEXT DEFAULT 'View All', button_open_post_label TEXT DEFAULT 'افتح المنشور', thread_auto_create INTEGER DEFAULT 0, thread_name_format TEXT DEFAULT 'Comments · {user}', allow_admin_edit INTEGER DEFAULT 1, allow_admin_delete INTEGER DEFAULT 1, admin_role_ids TEXT DEFAULT '[]', ignore_bots INTEGER DEFAULT 1, share_emoji TEXT DEFAULT '📤', share_title TEXT DEFAULT 'مشاركة المنشور', share_hint TEXT DEFAULT 'اختر المستلمين ثم اضغط تأكيد.', share_note TEXT DEFAULT 'ملاحظة: وصول المستلم للرابط يعتمد على صلاحيات Discord في القناة.', share_select_placeholder TEXT DEFAULT 'اختر مستلمًا أو أكثر...', share_confirm_label TEXT DEFAULT 'تأكيد الإرسال', share_cancel_label TEXT DEFAULT 'إلغاء', share_title_emoji TEXT DEFAULT '📤', share_confirm_emoji TEXT DEFAULT '✅', share_cancel_emoji TEXT DEFAULT '❌', share_color TEXT DEFAULT '#f59e0b', share_dm_title TEXT DEFAULT '📤 تمت مشاركة منشور معك', share_success_msg TEXT DEFAULT '✅ تم الإرسال', share_partial_msg TEXT DEFAULT '⚠️ تعذّر إرسال رسالة خاصة إلى بعض المستلمين', share_none_msg TEXT DEFAULT '⚠️ لم تختر مستلمين', button_open_post_emoji TEXT DEFAULT '🎃', viewall_prev_label TEXT DEFAULT '', viewall_prev_emoji TEXT DEFAULT '◀️', viewall_next_label TEXT DEFAULT '', viewall_next_emoji TEXT DEFAULT '▶️', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS media_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, source_channel_id TEXT NOT NULL, source_message_id TEXT NOT NULL UNIQUE, source_author_id TEXT NOT NULL, display_message_id TEXT NOT NULL, display_channel_id TEXT NOT NULL, thread_id TEXT, media_url TEXT, media_type TEXT, content_snapshot TEXT, created_at INTEGER NOT NULL, separator_channel_id TEXT, separator_message_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS media_files (id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL, file_name TEXT NOT NULL, file_path TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, storage_source TEXT DEFAULT 'disk', archive_channel_id TEXT, archive_message_id TEXT, archive_attachment_id TEXT, archive_url TEXT)`,
    `CREATE TABLE IF NOT EXISTS media_reactions (post_id INTEGER NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, number INTEGER NOT NULL, user_id TEXT NOT NULL, channel_id TEXT NOT NULL, subject TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, closed_at INTEGER, closed_by TEXT, transcript_sent INTEGER DEFAULT 0, close_status TEXT, close_error TEXT)`,
    `CREATE TABLE IF NOT EXISTS suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, message_id TEXT NOT NULL, channel_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT)`,
    `CREATE TABLE IF NOT EXISTS suggestion_votes (suggestion_id INTEGER NOT NULL, user_id TEXT NOT NULL, vote INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (suggestion_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS moderation_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE, guild_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL, moderator_id TEXT, reason TEXT, extra_details TEXT, duration_ms INTEGER, source TEXT DEFAULT 'bot', actor_confidence TEXT DEFAULT 'high', created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS nuke_events (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, event_type TEXT NOT NULL, executor_id TEXT, target_id TEXT, details TEXT, severity TEXT DEFAULT 'medium', action_taken TEXT, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS spam_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, violation_type TEXT NOT NULL, detected_at INTEGER NOT NULL, window_start INTEGER NOT NULL, window_ms INTEGER NOT NULL, message_count INTEGER NOT NULL, channels_json TEXT NOT NULL, punishment TEXT, punished_at INTEGER, deleted_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', details TEXT, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS spam_session_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL, message_id TEXT NOT NULL, channel_id TEXT NOT NULL, timestamp INTEGER NOT NULL, deleted INTEGER DEFAULT 0, delete_error TEXT)`,
    `CREATE TABLE IF NOT EXISTS componentsv2_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, panel_type TEXT NOT NULL, channel_id TEXT NOT NULL, message_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, backup_json TEXT, converted_at INTEGER, created_at INTEGER NOT NULL, UNIQUE(message_id))`
  ];

  for (const query of schemaQueries) {
    try { await client.execute(query); }
    catch (e) { console.error('[Blade X] ❌ فشل في إنشاء جدول:', e); }
  }

  await loadSettingsCache();
  console.log('[Blade X] ✅ تم الاتصال بقاعدة بيانات Turso بنجاح!');
}

export async function loadSettingsCache(): Promise<void> {
  const res = await client.execute('SELECT key, value FROM settings');
  settingsCache.clear();
  for (const row of res.rows) {
    settingsCache.set(row.key as string, row.value as string);
  }
}

export async function refreshSettingsCache(): Promise<void> {
  await loadSettingsCache();
}

// ===== Settings =====
export function getSetting(key: string): string | null {
  return settingsCache.get(key) ?? null;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    args: [key, value],
  });
  settingsCache.set(key, value);
}
export async function deleteSetting(key: string): Promise<void> {
  await client.execute({ sql: 'DELETE FROM settings WHERE key = ?', args: [key] });
  settingsCache.delete(key);
}
export function getAllSettings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of settingsCache) out[k] = v;
  return out;
}
export function getSettingNumber(key: string, fallback: number): number {
  const raw = getSetting(key);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
export function getSettingJSON<T>(key: string, fallback: T): T {
  const raw = getSetting(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
export async function setSettingJSON(key: string, value: unknown): Promise<void> {
  await setSetting(key, JSON.stringify(value));
}

// ===== Welcome phrases =====
export async function getWelcomePhrases(): Promise<string[]> {
  const res = await client.execute('SELECT text FROM welcome_phrases ORDER BY id');
  return res.rows.map(r => r.text as string);
}
export async function getWelcomePhrasesDetailed(): Promise<{ id: number; text: string }[]> {
  const res = await client.execute('SELECT id, text FROM welcome_phrases ORDER BY id');
  return res.rows.map(r => ({ id: Number(r.id), text: r.text as string }));
}
export async function addWelcomePhrase(text: string): Promise<void> {
  await client.execute({ sql: 'INSERT INTO welcome_phrases (text) VALUES (?)', args: [text] });
}
export async function replaceWelcomePhrase(id: number, text: string): Promise<void> {
  await client.execute({ sql: 'UPDATE welcome_phrases SET text = ? WHERE id = ?', args: [text, id] });
}
export async function deleteWelcomePhrase(id: number): Promise<void> {
  await client.execute({ sql: 'DELETE FROM welcome_phrases WHERE id = ?', args: [id] });
}

// ===== Welcome buttons =====
export interface WelcomeButton { button_id: string; label: string; emoji_id: string | null; url: string | null; style: string; enabled: number; }
export async function getWelcomeButtons(): Promise<WelcomeButton[]> {
  const res = await client.execute('SELECT * FROM welcome_buttons ORDER BY rowid');
  return res.rows as unknown as WelcomeButton[];
}
export async function upsertWelcomeButton(btn: WelcomeButton): Promise<void> {
  await client.execute({
    sql: `INSERT INTO welcome_buttons (button_id, label, emoji_id, url, style, enabled) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(button_id) DO UPDATE SET label = excluded.label, emoji_id = excluded.emoji_id, url = excluded.url, style = excluded.style, enabled = excluded.enabled`,
    args: [btn.button_id, btn.label, btn.emoji_id, btn.url, btn.style, btn.enabled],
  });
}

// ===== Self roles =====
export interface SelfRoleRow { id: number; role_id: string; emoji_id: string | null; label: string; description: string | null; sort_order: number; enabled: number; }
export async function getSelfRoles(): Promise<SelfRoleRow[]> {
  const res = await client.execute('SELECT * FROM self_roles ORDER BY sort_order, id');
  return res.rows as unknown as SelfRoleRow[];
}
export async function getSelfRoleById(id: number): Promise<SelfRoleRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM self_roles WHERE id = ?', args: [id] });
  return res.rows[0] as unknown as SelfRoleRow | undefined;
}
export async function addSelfRole(roleId: string, label: string, emojiId: string | null, description: string | null): Promise<void> {
  await client.execute({ sql: 'INSERT INTO self_roles (role_id, label, emoji_id, description) VALUES (?, ?, ?, ?)', args: [roleId, label, emojiId, description] });
}
export async function removeSelfRole(id: number): Promise<void> {
  await client.execute({ sql: 'DELETE FROM self_roles WHERE id = ?', args: [id] });
}
export async function updateSelfRole(id: number, patch: Partial<SelfRoleRow>): Promise<void> {
  const c = await getSelfRoleById(id);
  if (!c) return;
  await client.execute({
    sql: `UPDATE self_roles SET role_id=?, emoji_id=?, label=?, description=?, sort_order=?, enabled=? WHERE id=?`,
    args: [
      patch.role_id ?? c.role_id, patch.emoji_id ?? c.emoji_id, patch.label ?? c.label,
      patch.description ?? c.description, patch.sort_order ?? c.sort_order, patch.enabled ?? c.enabled, id
    ],
  });
}

// ===== Moderation =====
export async function logModeration(action: string, targetId: string, moderatorId: string | null, reason: string | null, durationMs: number | null, dmStatus: string | null): Promise<void> {
  const now = Date.now();
  const expiresAt = durationMs ? now + durationMs : null;
  await client.execute({
    sql: `INSERT INTO moderation_log (action, target_id, moderator_id, reason, duration_ms, expires_at, dm_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [action, targetId, moderatorId, reason, durationMs, expiresAt, dmStatus, now],
  });
}
export async function getActiveTemporaryPunishments(): Promise<{ action: string; target_id: string; expires_at: number }[]> {
  const res = await client.execute({
    sql: 'SELECT action, target_id, expires_at FROM moderation_log WHERE expires_at IS NOT NULL AND expires_at > ? AND action IN (?, ?)',
    args: [Date.now(), 'ban', 'timeout'],
  });
  return res.rows as unknown as any[];
}
export async function getModerationLog(limit = 100): Promise<any[]> {
  const res = await client.execute({ sql: 'SELECT * FROM moderation_log ORDER BY created_at DESC LIMIT ?', args: [limit] });
  return res.rows as unknown as any[];
}

// ===== Activity log =====
export async function logActivity(eventType: string, userId: string | null, details: string | null): Promise<void> {
  await client.execute({ sql: 'INSERT INTO activity_log (event_type, user_id, details, created_at) VALUES (?, ?, ?, ?)', args: [eventType, userId, details, Date.now()] });
}
export async function getRecentActivity(limit = 50): Promise<any[]> {
  const res = await client.execute({ sql: 'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?', args: [limit] });
  return res.rows as unknown as any[];
}
export async function logMemberHistory(userId: string, eventType: string, accountCreatedAt: number | null, joinedAt: number | null): Promise<void> {
  await client.execute({ sql: 'INSERT INTO member_history (user_id, event_type, account_created_at, joined_at, created_at) VALUES (?, ?, ?, ?, ?)', args: [userId, eventType, accountCreatedAt, joinedAt, Date.now()] });
}

// ===== Movie Night =====
export interface MovieSession { id: number; movie_name: string; status: string; voice_channel_id: string | null; reviews_channel_id: string | null; thread_id: string | null; summary_message_id: string | null; created_by: string | null; started_at: number; closed_at: number | null; separator_sent?: number; }
export async function createMovieSession(movieName: string, voiceChannelId: string | null, reviewsChannelId: string | null, createdBy: string): Promise<number> {
  const res = await client.execute({ sql: `INSERT INTO movie_sessions (movie_name, status, voice_channel_id, reviews_channel_id, created_by, started_at) VALUES (?, 'open', ?, ?, ?, ?)`, args: [movieName, voiceChannelId, reviewsChannelId, createdBy, Date.now()] });
  return Number(res.lastInsertRowid);
}
export async function getMovieSession(id: number): Promise<MovieSession | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM movie_sessions WHERE id = ?', args: [id] });
  return res.rows[0] as unknown as MovieSession | undefined;
}
export async function getActiveMovieSession(): Promise<MovieSession | undefined> {
  const res = await client.execute(`SELECT * FROM movie_sessions WHERE status = 'open' ORDER BY started_at DESC LIMIT 1`);
  return res.rows[0] as unknown as MovieSession | undefined;
}
export async function getRecentMovieSessions(limit = 10): Promise<MovieSession[]> {
  const res = await client.execute({ sql: 'SELECT * FROM movie_sessions ORDER BY started_at DESC LIMIT ?', args: [limit] });
  return res.rows as unknown as MovieSession[];
}
export async function updateMovieSession(id: number, patch: Partial<MovieSession>): Promise<void> {
  const c = await getMovieSession(id);
  if (!c) return;
  await client.execute({
    sql: `UPDATE movie_sessions SET movie_name=?, status=?, voice_channel_id=?, reviews_channel_id=?, thread_id=?, summary_message_id=?, closed_at=?, separator_sent=? WHERE id=?`,
    args: [
      patch.movie_name ?? c.movie_name, patch.status ?? c.status,
      patch.voice_channel_id ?? c.voice_channel_id, patch.reviews_channel_id ?? c.reviews_channel_id,
      patch.thread_id ?? c.thread_id, patch.summary_message_id ?? c.summary_message_id,
      patch.closed_at ?? c.closed_at, patch.separator_sent ?? c.separator_sent ?? 0, id
    ],
  });
}
export async function addMovieRecipient(sessionId: number, userId: string, dmStatus: string): Promise<void> {
  await client.execute({ sql: 'INSERT OR REPLACE INTO movie_recipients (session_id, user_id, dm_status) VALUES (?, ?, ?)', args: [sessionId, userId, dmStatus] });
}
export async function getMovieRecipients(sessionId: number): Promise<{ user_id: string; dm_status: string }[]> {
  const res = await client.execute({ sql: 'SELECT user_id, dm_status FROM movie_recipients WHERE session_id = ?', args: [sessionId] });
  return res.rows as unknown as any[];
}
export async function isMovieRecipient(sessionId: number, userId: string): Promise<boolean> {
  const res = await client.execute({ sql: 'SELECT 1 FROM movie_recipients WHERE session_id = ? AND user_id = ?', args: [sessionId, userId] });
  return res.rows.length > 0;
}
export async function upsertMovieRating(sessionId: number, userId: string, rating: number, comment: string | null): Promise<void> {
  const now = Date.now();
  const existing = await client.execute({ sql: 'SELECT 1 FROM movie_ratings WHERE session_id = ? AND user_id = ?', args: [sessionId, userId] });
  if (existing.rows.length > 0) {
    await client.execute({ sql: 'UPDATE movie_ratings SET rating=?, comment=COALESCE(?, comment), updated_at=? WHERE session_id=? AND user_id=?', args: [rating, comment, now, sessionId, userId] });
  } else {
    await client.execute({ sql: 'INSERT INTO movie_ratings (session_id, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', args: [sessionId, userId, rating, comment, now, now] });
  }
}
export async function getAllMovieRatings(sessionId: number): Promise<{ user_id: string; rating: number; comment: string | null; created_at: number; updated_at: number }[]> {
  const res = await client.execute({ sql: 'SELECT user_id, rating, comment, created_at, updated_at FROM movie_ratings WHERE session_id = ? ORDER BY created_at', args: [sessionId] });
  return res.rows as unknown as any[];
}
export async function getMovieStats(sessionId: number): Promise<{ count: number; average: number; distribution: Record<number, number> }> {
  const res = await client.execute({ sql: 'SELECT rating FROM movie_ratings WHERE session_id = ? AND rating > 0', args: [sessionId] });
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of res.rows) {
    const rating = Number(r.rating);
    sum += rating;
    dist[rating] = (dist[rating] ?? 0) + 1;
  }
  return { count: res.rows.length, average: res.rows.length > 0 ? sum / res.rows.length : 0, distribution: dist };
}

export interface MovieRatingState { session_id: number; user_id: string; rating: number; comment: string | null; created_at: number; updated_at: number; dm_message_id: string | null; dm_channel_id: string | null; comment_posted: number; review_message_id: string | null; }
export async function getMovieRatingFull(sessionId: number, userId: string): Promise<MovieRatingState | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM movie_ratings WHERE session_id = ? AND user_id = ?', args: [sessionId, userId] });
  return res.rows[0] as unknown as MovieRatingState | undefined;
}
export async function getMovieRating(sessionId: number, userId: string): Promise<{ rating: number; comment: string | null } | undefined> {
  const res = await client.execute({ sql: 'SELECT rating, comment FROM movie_ratings WHERE session_id = ? AND user_id = ?', args: [sessionId, userId] });
  return res.rows[0] as unknown as any;
}
export async function setRatingOnly(sessionId: number, userId: string, rating: number): Promise<void> {
  const now = Date.now();
  const existing = await getMovieRatingFull(sessionId, userId);
  if (existing) {
    await client.execute({ sql: 'UPDATE movie_ratings SET rating=?, updated_at=? WHERE session_id=? AND user_id=?', args: [rating, now, sessionId, userId] });
  } else {
    await client.execute({ sql: 'INSERT INTO movie_ratings (session_id, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)', args: [sessionId, userId, rating, now, now] });
  }
}
export async function setCommentOnly(sessionId: number, userId: string, comment: string): Promise<void> {
  const now = Date.now();
  const existing = await getMovieRatingFull(sessionId, userId);
  if (existing) {
    await client.execute({ sql: 'UPDATE movie_ratings SET comment=?, comment_posted=1, updated_at=? WHERE session_id=? AND user_id=?', args: [comment, now, sessionId, userId] });
  } else {
    await client.execute({ sql: 'INSERT INTO movie_ratings (session_id, user_id, rating, comment, comment_posted, created_at, updated_at) VALUES (?, ?, 0, ?, 1, ?, ?)', args: [sessionId, userId, comment, now, now] });
  }
}
export async function setDMMessageRef(sessionId: number, userId: string, channelId: string, messageId: string): Promise<void> {
  const existing = await getMovieRatingFull(sessionId, userId);
  if (existing) {
    await client.execute({ sql: 'UPDATE movie_ratings SET dm_channel_id=?, dm_message_id=? WHERE session_id=? AND user_id=?', args: [channelId, messageId, sessionId, userId] });
  } else {
    const now = Date.now();
    await client.execute({ sql: 'INSERT INTO movie_ratings (session_id, user_id, rating, comment, created_at, updated_at, dm_channel_id, dm_message_id) VALUES (?, ?, 0, NULL, ?, ?, ?, ?)', args: [sessionId, userId, now, now, channelId, messageId] });
  }
}
export async function getMovieStatsFull(sessionId: number): Promise<{ ratingsCount: number; commentsCount: number; average: number; distribution: Record<number, number> }> {
  const res = await client.execute({ sql: 'SELECT rating, comment, comment_posted FROM movie_ratings WHERE session_id = ?', args: [sessionId] });
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0; let rated = 0; let comments = 0;
  for (const r of res.rows) {
    const rating = Number(r.rating);
    if (rating > 0) { sum += rating; dist[rating] = (dist[rating] ?? 0) + 1; rated++; }
    if (r.comment && (r.comment as string).trim()) comments++;
  }
  return { ratingsCount: rated, commentsCount: comments, average: rated > 0 ? sum / rated : 0, distribution: dist };
}
export async function setReviewMessageId(sessionId: number, userId: string, messageId: string): Promise<void> {
  try { await client.execute({ sql: 'UPDATE movie_ratings SET review_message_id = ? WHERE session_id = ? AND user_id = ?', args: [messageId, sessionId, userId] }); }
  catch (e) { console.error('[Blade X] ❌ setReviewMessageId:', e); }
}
export async function getReviewMessageId(sessionId: number, userId: string): Promise<string | null> {
  try {
    const res = await client.execute({ sql: 'SELECT review_message_id FROM movie_ratings WHERE session_id = ? AND user_id = ?', args: [sessionId, userId] });
    return (res.rows[0]?.review_message_id as string) ?? null;
  } catch { return null; }
}

// ===== Movie Drafts =====
export interface MovieDraftRow { user_id: string; session_id: number; rating: number; comment: string | null; updated_at: number; }
export async function getMovieDraft(userId: string, sessionId: number): Promise<MovieDraftRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM movie_drafts WHERE user_id = ? AND session_id = ?', args: [userId, sessionId] });
  return res.rows[0] as unknown as MovieDraftRow | undefined;
}
export async function upsertMovieDraft(userId: string, sessionId: number, patch: { rating?: number; comment?: string | null }): Promise<void> {
  const existing = await getMovieDraft(userId, sessionId);
  const now = Date.now();
  if (existing) {
    await client.execute({ sql: 'UPDATE movie_drafts SET rating = ?, comment = ?, updated_at = ? WHERE user_id = ? AND session_id = ?', args: [patch.rating ?? existing.rating, patch.comment !== undefined ? patch.comment : existing.comment, now, userId, sessionId] });
  } else {
    await client.execute({ sql: 'INSERT INTO movie_drafts (user_id, session_id, rating, comment, updated_at) VALUES (?, ?, ?, ?, ?)', args: [userId, sessionId, patch.rating ?? 0, patch.comment ?? null, now] });
  }
}
export async function deleteMovieDraft(userId: string, sessionId: number): Promise<void> {
  await client.execute({ sql: 'DELETE FROM movie_drafts WHERE user_id = ? AND session_id = ?', args: [userId, sessionId] });
}
export async function cleanupOldMovieDrafts(maxAgeMs = 7 * 86_400_000): Promise<void> {
  await client.execute({ sql: 'DELETE FROM movie_drafts WHERE updated_at < ?', args: [Date.now() - maxAgeMs] });
}

// ===== Message Builder =====
export async function mbSaveDraft(name: string, payload: unknown, createdBy: string): Promise<number> {
  const now = Date.now();
  const res = await client.execute({ sql: `INSERT INTO mb_drafts (name, payload, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, args: [name, JSON.stringify(payload), createdBy, now, now] });
  return Number(res.lastInsertRowid);
}
export async function mbUpdateDraft(id: number, name: string, payload: unknown): Promise<void> {
  await client.execute({ sql: `UPDATE mb_drafts SET name=?, payload=?, updated_at=? WHERE id=?`, args: [name, JSON.stringify(payload), Date.now(), id] });
}
export async function mbDeleteDraft(id: number): Promise<void> {
  await client.execute({ sql: 'DELETE FROM mb_drafts WHERE id = ?', args: [id] });
}
export async function mbGetDrafts(): Promise<any[]> {
  const res = await client.execute('SELECT id, name, payload, created_by, updated_at FROM mb_drafts ORDER BY updated_at DESC');
  return res.rows as unknown as any[];
}
export async function mbGetDraft(id: number): Promise<any> {
  const res = await client.execute({ sql: 'SELECT id, name, payload, created_by FROM mb_drafts WHERE id = ?', args: [id] });
  return res.rows[0] as unknown as any;
}
export async function mbLogSend(channelId: string, messageId: string | null, payload: unknown, sentBy: string): Promise<void> {
  await client.execute({ sql: `INSERT INTO mb_history (channel_id, message_id, payload, sent_by, sent_at) VALUES (?, ?, ?, ?, ?)`, args: [channelId, messageId, JSON.stringify(payload), sentBy, Date.now()] });
}
export async function mbGetHistory(limit = 50): Promise<any[]> {
  const res = await client.execute({ sql: 'SELECT * FROM mb_history ORDER BY sent_at DESC LIMIT ?', args: [limit] });
  return res.rows as unknown as any[];
}

// ===== Spam Trap =====
export interface SpamTrapConfig { enabled: boolean; channelId: string | null; punishment: 'ban' | 'timeout' | 'kick'; timeoutMs: number; logChannelId: string | null; ignoreRoles: string[]; ignoreBots: boolean; }
export function getSpamTrapConfig(): SpamTrapConfig {
  const raw = getSetting('spam_trap_config');
  const def: SpamTrapConfig = { enabled: false, channelId: null, punishment: 'ban', timeoutMs: 7 * 86_400_000, logChannelId: null, ignoreRoles: [], ignoreBots: true };
  if (!raw) return def;
  try { return { ...def, ...JSON.parse(raw) }; } catch { return def; }
}
export async function setSpamTrapConfig(cfg: Partial<SpamTrapConfig>): Promise<void> {
  const current = getSpamTrapConfig();
  await setSetting('spam_trap_config', JSON.stringify({ ...current, ...cfg }));
}
export async function logSpamTrap(userId: string, channelId: string, messageId: string | null, content: string | null, punishment: string, durationMs: number | null, success: boolean, error: string | null): Promise<void> {
  await client.execute({ sql: `INSERT INTO spam_trap_log (user_id, channel_id, message_id, content, punishment, duration_ms, success, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [userId, channelId, messageId, content, punishment, durationMs, success ? 1 : 0, error, Date.now()] });
}
export async function getSpamTrapLog(limit = 100): Promise<any[]> {
  const res = await client.execute({ sql: 'SELECT * FROM spam_trap_log ORDER BY created_at DESC LIMIT ?', args: [limit] });
  return res.rows as unknown as any[];
}

// ===== Media Show =====
export interface MediaChannel {
  channel_id: string; enabled: number; title_format: string; author_emoji: string; color: string;
  footer_from_label: string; footer_others_label: string; reaction_emoji: string; comment_emoji: string;
  delete_emoji: string; viewall_emoji: string; share_emoji: string; share_title: string; share_hint: string;
  share_note: string; share_select_placeholder: string; share_confirm_label: string; share_cancel_label: string;
  share_title_emoji: string; share_confirm_emoji: string; share_cancel_emoji: string; share_color: string;
  share_dm_title: string; share_success_msg: string; share_partial_msg: string; share_none_msg: string;
  button_open_post_emoji: string; viewall_prev_label: string; viewall_prev_emoji: string;
  viewall_next_label: string; viewall_next_emoji: string; button_view_all_label: string;
  button_open_post_label: string; thread_auto_create: number; thread_name_format: string;
  allow_admin_edit: number; allow_admin_delete: number; admin_role_ids: string; ignore_bots: number;
  created_at: number; updated_at: number;
}
export async function getMediaChannels(): Promise<MediaChannel[]> {
  const res = await client.execute('SELECT * FROM media_channels ORDER BY created_at');
  return res.rows as unknown as MediaChannel[];
}
export async function getMediaChannel(channelId: string): Promise<MediaChannel | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM media_channels WHERE channel_id = ?', args: [channelId] });
  return res.rows[0] as unknown as MediaChannel | undefined;
}
export async function isMediaChannel(channelId: string): Promise<boolean> {
  const ch = await getMediaChannel(channelId);
  return !!ch && ch.enabled === 1;
}
export async function addMediaChannel(channelId: string): Promise<void> {
  const now = Date.now();
  await client.execute({ sql: `INSERT OR IGNORE INTO media_channels (channel_id, created_at, updated_at) VALUES (?, ?, ?)`, args: [channelId, now, now] });
}
export async function updateMediaChannel(channelId: string, patch: Partial<MediaChannel>): Promise<void> {
  const c = await getMediaChannel(channelId);
  if (!c) return;
  await client.execute({
    sql: `UPDATE media_channels SET enabled = ?, title_format = ?, author_emoji = ?, color = ?, footer_from_label = ?, footer_others_label = ?, reaction_emoji = ?, comment_emoji = ?, delete_emoji = ?, viewall_emoji = ?, share_emoji = ?, share_title = ?, share_hint = ?, share_note = ?, share_select_placeholder = ?, share_confirm_label = ?, share_cancel_label = ?, share_title_emoji = ?, share_confirm_emoji = ?, share_cancel_emoji = ?, share_color = ?, share_dm_title = ?, share_success_msg = ?, share_partial_msg = ?, share_none_msg = ?, button_open_post_emoji = ?, viewall_prev_label = ?, viewall_prev_emoji = ?, viewall_next_label = ?, viewall_next_emoji = ?, button_view_all_label = ?, button_open_post_label = ?, thread_auto_create = ?, thread_name_format = ?, allow_admin_edit = ?, allow_admin_delete = ?, admin_role_ids = ?, ignore_bots = ?, updated_at = ? WHERE channel_id = ?`,
    args: [
      patch.enabled ?? c.enabled, patch.title_format ?? c.title_format, patch.author_emoji ?? c.author_emoji, patch.color ?? c.color,
      patch.footer_from_label ?? c.footer_from_label, patch.footer_others_label ?? c.footer_others_label, patch.reaction_emoji ?? c.reaction_emoji,
      patch.comment_emoji ?? c.comment_emoji, patch.delete_emoji ?? c.delete_emoji, patch.viewall_emoji ?? c.viewall_emoji,
      patch.share_emoji ?? c.share_emoji, patch.share_title ?? c.share_title, patch.share_hint ?? c.share_hint, patch.share_note ?? c.share_note,
      patch.share_select_placeholder ?? c.share_select_placeholder, patch.share_confirm_label ?? c.share_confirm_label, patch.share_cancel_label ?? c.share_cancel_label,
      patch.share_title_emoji ?? c.share_title_emoji, patch.share_confirm_emoji ?? c.share_confirm_emoji, patch.share_cancel_emoji ?? c.share_cancel_emoji,
      patch.share_color ?? c.share_color, patch.share_dm_title ?? c.share_dm_title, patch.share_success_msg ?? c.share_success_msg,
      patch.share_partial_msg ?? c.share_partial_msg, patch.share_none_msg ?? c.share_none_msg, patch.button_open_post_emoji ?? c.button_open_post_emoji,
      patch.viewall_prev_label ?? c.viewall_prev_label, patch.viewall_prev_emoji ?? c.viewall_prev_emoji, patch.viewall_next_label ?? c.viewall_next_label,
      patch.viewall_next_emoji ?? c.viewall_next_emoji, patch.button_view_all_label ?? c.button_view_all_label, patch.button_open_post_label ?? c.button_open_post_label,
      patch.thread_auto_create ?? c.thread_auto_create, patch.thread_name_format ?? c.thread_name_format, patch.allow_admin_edit ?? c.allow_admin_edit,
      patch.allow_admin_delete ?? c.allow_admin_delete, patch.admin_role_ids ?? c.admin_role_ids, patch.ignore_bots ?? c.ignore_bots,
      Date.now(), channelId
    ],
  });
}
export async function removeMediaChannel(channelId: string): Promise<void> {
  await client.execute({ sql: 'DELETE FROM media_channels WHERE channel_id = ?', args: [channelId] });
}

export interface MediaPost { id: number; guild_id: string; source_channel_id: string; source_message_id: string; source_author_id: string; display_message_id: string; display_channel_id: string; thread_id: string | null; media_url: string | null; media_type: string | null; content_snapshot: string | null; created_at: number; separator_channel_id?: string | null; separator_message_id?: string | null; }

export async function createMediaPost(data: Omit<MediaPost, 'id'>): Promise<number> {
  const res = await client.execute({
    sql: `INSERT INTO media_posts (guild_id, source_channel_id, source_message_id, source_author_id, display_message_id, display_channel_id, thread_id, media_url, media_type, content_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.guild_id, data.source_channel_id, data.source_message_id, data.source_author_id, data.display_message_id, data.display_channel_id, data.thread_id, data.media_url, data.media_type, data.content_snapshot, data.created_at],
  });
  return Number(res.lastInsertRowid);
}

export async function reserveMediaPost(data: { guild_id: string; source_channel_id: string; source_message_id: string; source_author_id: string; display_message_id?: string; display_channel_id: string; thread_id?: string | null; media_url?: string | null; media_type?: string | null; content_snapshot?: string | null; created_at?: number; }): Promise<number> {
  const res = await client.execute({
    sql: `INSERT INTO media_posts (guild_id, source_channel_id, source_message_id, source_author_id, display_message_id, display_channel_id, thread_id, media_url, media_type, content_snapshot, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.guild_id, data.source_channel_id, data.source_message_id, data.source_author_id, data.display_message_id ?? '', data.display_channel_id, data.thread_id ?? null, data.media_url ?? null, data.media_type ?? null, data.content_snapshot ?? null, data.created_at ?? Date.now()],
  });
  return Number(res.lastInsertRowid);
}
export async function updateMediaPostDisplay(postId: number, displayMessageId: string): Promise<void> {
  await client.execute({ sql: 'UPDATE media_posts SET display_message_id = ? WHERE id = ?', args: [displayMessageId, postId] });
}
export async function updateMediaPostThread(postId: number, threadId: string | null): Promise<void> {
  await client.execute({ sql: 'UPDATE media_posts SET thread_id = ? WHERE id = ?', args: [threadId, postId] });
}
export async function updateMediaPostMediaUrl(postId: number, mediaUrl: string | null): Promise<void> {
  await client.execute({ sql: 'UPDATE media_posts SET media_url = ? WHERE id = ?', args: [mediaUrl, postId] });
}
export async function updateMediaPostSeparator(postId: number, channelId: string, messageId: string): Promise<void> {
  await client.execute({ sql: 'UPDATE media_posts SET separator_channel_id = ?, separator_message_id = ? WHERE id = ?', args: [channelId, messageId, postId] });
}
export async function getMediaPostBySource(messageId: string): Promise<MediaPost | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM media_posts WHERE source_message_id = ?', args: [messageId] });
  return res.rows[0] as unknown as MediaPost | undefined;
}
export async function getMediaPostByDisplay(messageId: string): Promise<MediaPost | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM media_posts WHERE display_message_id = ?', args: [messageId] });
  return res.rows[0] as unknown as MediaPost | undefined;
}
export async function getMediaPostById(id: number): Promise<MediaPost | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM media_posts WHERE id = ?', args: [id] });
  return res.rows[0] as unknown as MediaPost | undefined;
}
export async function getUserMediaPosts(authorId: string, limit = 100): Promise<MediaPost[]> {
  const res = await client.execute({ sql: 'SELECT * FROM media_posts WHERE source_author_id = ? ORDER BY created_at DESC LIMIT ?', args: [authorId, limit] });
  return res.rows as unknown as MediaPost[];
}
export async function setMediaPostThread(postId: number, threadId: string): Promise<void> {
  await client.execute({ sql: 'UPDATE media_posts SET thread_id = ? WHERE id = ?', args: [threadId, postId] });
}
export async function deleteMediaPost(postId: number): Promise<void> {
  await client.execute({ sql: 'DELETE FROM media_reactions WHERE post_id = ?', args: [postId] });
  await client.execute({ sql: 'DELETE FROM media_files WHERE post_id = ?', args: [postId] });
  await client.execute({ sql: 'DELETE FROM media_posts WHERE id = ?', args: [postId] });
}

// ===== Media files =====
export interface MediaFileRow { id: number; post_id: number; file_name: string; file_path: string; media_type: 'image' | 'video'; size: number; created_at: number; storage_source: 'disk' | 'archive' | 'cdn_url' | null; archive_channel_id: string | null; archive_message_id: string | null; archive_attachment_id: string | null; archive_url: string | null; }
export async function insertMediaFile(data: { postId: number; fileName: string; filePath: string; mediaType: 'image' | 'video'; size: number; storageSource?: 'disk' | 'archive' | 'cdn_url'; archiveChannelId?: string | null; archiveMessageId?: string | null; archiveAttachmentId?: string | null; archiveUrl?: string | null; }): Promise<number> {
  const res = await client.execute({
    sql: `INSERT INTO media_files (post_id, file_name, file_path, media_type, size, created_at, storage_source, archive_channel_id, archive_message_id, archive_attachment_id, archive_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.postId, data.fileName, data.filePath, data.mediaType, data.size, Date.now(), data.storageSource ?? 'disk', data.archiveChannelId ?? null, data.archiveMessageId ?? null, data.archiveAttachmentId ?? null, data.archiveUrl ?? null],
  });
  return Number(res.lastInsertRowid);
}
export async function getMediaFiles(postId: number): Promise<MediaFileRow[]> {
  const res = await client.execute({ sql: 'SELECT * FROM media_files WHERE post_id = ? ORDER BY id', args: [postId] });
  return res.rows as unknown as MediaFileRow[];
}
export async function deleteMediaFilesForPost(postId: number): Promise<void> {
  await client.execute({ sql: 'DELETE FROM media_files WHERE post_id = ?', args: [postId] });
}
export async function getTotalMediaFilesSize(): Promise<number> {
  const res = await client.execute("SELECT COALESCE(SUM(size), 0) as total FROM media_files WHERE storage_source = 'disk' OR storage_source IS NULL");
  return Number(res.rows[0]?.total ?? 0);
}
export async function countMediaFiles(): Promise<number> {
  const res = await client.execute('SELECT COUNT(*) as c FROM media_files');
  return Number(res.rows[0]?.c ?? 0);
}
export async function countMediaPosts(): Promise<number> {
  const res = await client.execute('SELECT COUNT(*) as c FROM media_posts');
  return Number(res.rows[0]?.c ?? 0);
}
export async function countArchivedMedia(): Promise<number> {
  const res = await client.execute("SELECT COUNT(*) as c FROM media_files WHERE storage_source = 'archive'");
  return Number(res.rows[0]?.c ?? 0);
}
export async function countDiskMedia(): Promise<number> {
  const res = await client.execute("SELECT COUNT(*) as c FROM media_files WHERE storage_source = 'disk' OR storage_source IS NULL");
  return Number(res.rows[0]?.c ?? 0);
}
export async function getOldestMediaFilePostIds(limit = 100): Promise<number[]> {
  const res = await client.execute({
    sql: "SELECT post_id, MIN(created_at) as oldest FROM media_files WHERE storage_source = 'disk' OR storage_source IS NULL GROUP BY post_id ORDER BY oldest ASC LIMIT ?",
    args: [limit],
  });
  return res.rows.map(r => Number(r.post_id));
}

// ===== Media reactions =====
export async function addMediaReaction(postId: number, userId: string, emoji: string): Promise<boolean> {
  try { await client.execute({ sql: 'INSERT INTO media_reactions (post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)', args: [postId, userId, emoji, Date.now()] }); return true; } catch { return false; }
}
export async function removeMediaReaction(postId: number, userId: string): Promise<boolean> {
  const res = await client.execute({ sql: 'DELETE FROM media_reactions WHERE post_id = ? AND user_id = ?', args: [postId, userId] });
  return res.rowsAffected > 0;
}
export async function hasMediaReaction(postId: number, userId: string): Promise<boolean> {
  const res = await client.execute({ sql: 'SELECT 1 FROM media_reactions WHERE post_id = ? AND user_id = ?', args: [postId, userId] });
  return res.rows.length > 0;
}
export async function getMediaReactionCount(postId: number): Promise<number> {
  const res = await client.execute({ sql: 'SELECT COUNT(*) as c FROM media_reactions WHERE post_id = ?', args: [postId] });
  return Number(res.rows[0].c);
}
export async function getMediaReactionUsers(postId: number, limit = 100): Promise<string[]> {
  const res = await client.execute({ sql: 'SELECT user_id FROM media_reactions WHERE post_id = ? ORDER BY created_at LIMIT ?', args: [postId, limit] });
  return res.rows.map(r => r.user_id as string);
}

// ===== Tickets & Suggestions =====
export interface TicketRow { id: number; guild_id: string; number: number; user_id: string; channel_id: string; subject: string; description: string | null; status: string; created_at: number; closed_at: number | null; closed_by: string | null; transcript_sent?: number; close_status?: string | null; close_error?: string | null; }
export async function getNextTicketNumber(guildId: string): Promise<number> {
  const res = await client.execute({ sql: 'SELECT MAX(number) as max FROM tickets WHERE guild_id = ?', args: [guildId] });
  return Number(res.rows[0]?.max ?? 0) + 1;
}
export async function createTicket(data: { guild_id: string; number: number; user_id: string; channel_id: string; subject: string; description: string | null; status: string; created_at: number; }): Promise<number> {
  const res = await client.execute({ sql: `INSERT INTO tickets (guild_id, number, user_id, channel_id, subject, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [data.guild_id, data.number, data.user_id, data.channel_id, data.subject, data.description, data.status, data.created_at] });
  return Number(res.lastInsertRowid);
}
export async function getTicket(id: number): Promise<TicketRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM tickets WHERE id = ?', args: [id] });
  return res.rows[0] as unknown as TicketRow | undefined;
}
export async function getTicketByChannel(channelId: string): Promise<TicketRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM tickets WHERE channel_id = ?', args: [channelId] });
  return res.rows[0] as unknown as TicketRow | undefined;
}
export async function getUserOpenTickets(guildId: string, userId: string): Promise<TicketRow[]> {
  const res = await client.execute({ sql: "SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'", args: [guildId, userId] });
  return res.rows as unknown as TicketRow[];
}
export async function closeTicket(id: number, closedBy: string): Promise<void> {
  await client.execute({ sql: "UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?", args: [Date.now(), closedBy, id] });
}
export async function reopenTicket(id: number): Promise<void> {
  await client.execute({ sql: "UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = ?", args: [id] });
}
export async function listTickets(guildId: string, limit = 100): Promise<TicketRow[]> {
  const res = await client.execute({ sql: 'SELECT * FROM tickets WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', args: [guildId, limit] });
  return res.rows as unknown as TicketRow[];
}

export interface SuggestionRow { id: number; guild_id: string; user_id: string; message_id: string; channel_id: string; title: string; description: string; status: string; created_at: number; decided_at: number | null; decided_by: string | null; }
export async function createSuggestion(data: { guild_id: string; user_id: string; message_id: string; channel_id: string; title: string; description: string; status: string; created_at: number; }): Promise<number> {
  const res = await client.execute({ sql: `INSERT INTO suggestions (guild_id, user_id, message_id, channel_id, title, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, args: [data.guild_id, data.user_id, data.message_id, data.channel_id, data.title, data.description, data.status, data.created_at] });
  return Number(res.lastInsertRowid);
}
export async function getSuggestion(id: number): Promise<SuggestionRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM suggestions WHERE id = ?', args: [id] });
  return res.rows[0] as unknown as SuggestionRow | undefined;
}
export async function getSuggestionByMessage(messageId: string): Promise<SuggestionRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM suggestions WHERE message_id = ?', args: [messageId] });
  return res.rows[0] as unknown as SuggestionRow | undefined;
}
export async function decideSuggestion(id: number, status: 'approved' | 'rejected', decidedBy: string): Promise<void> {
  await client.execute({ sql: 'UPDATE suggestions SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', args: [status, Date.now(), decidedBy, id] });
}
export async function listSuggestions(guildId: string, limit = 100): Promise<SuggestionRow[]> {
  const res = await client.execute({ sql: 'SELECT * FROM suggestions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', args: [guildId, limit] });
  return res.rows as unknown as SuggestionRow[];
}
export async function addSuggestionVote(suggestionId: number, userId: string, vote: number): Promise<void> {
  await client.execute({ sql: `INSERT INTO suggestion_votes (suggestion_id, user_id, vote, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote`, args: [suggestionId, userId, vote, Date.now()] });
}
export async function getUserSuggestionVote(suggestionId: number, userId: string): Promise<number | null> {
  const res = await client.execute({ sql: 'SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?', args: [suggestionId, userId] });
  return res.rows[0] ? Number(res.rows[0].vote) : null;
}
export async function getSuggestionVotes(suggestionId: number): Promise<{ up: number; down: number }> {
  const up = await client.execute({ sql: 'SELECT COUNT(*) as c FROM suggestion_votes WHERE suggestion_id = ? AND vote = 1', args: [suggestionId] });
  const down = await client.execute({ sql: 'SELECT COUNT(*) as c FROM suggestion_votes WHERE suggestion_id = ? AND vote = -1', args: [suggestionId] });
  return { up: Number(up.rows[0].c), down: Number(down.rows[0].c) };
}

// ===== Moderation Events & Nuke =====
export interface ModerationEvent { id: number; event_id: string | null; guild_id: string; action: string; target_id: string; moderator_id: string | null; reason: string | null; extra_details: string | null; duration_ms: number | null; source: string; actor_confidence: string; created_at: number; }
export async function logModerationEventFull(data: { event_id?: string | null; guild_id: string; action: string; target_id: string; moderator_id: string | null; reason: string | null; extra_details: string | null; duration_ms: number | null; source: string; actor_confidence: string; }): Promise<number> {
  const res = await client.execute({
    sql: `INSERT OR IGNORE INTO moderation_events (event_id, guild_id, action, target_id, moderator_id, reason, extra_details, duration_ms, source, actor_confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.event_id ?? null, data.guild_id, data.action, data.target_id, data.moderator_id, data.reason, data.extra_details, data.duration_ms, data.source, data.actor_confidence, Date.now()],
  });
  return Number(res.lastInsertRowid);
}
export async function getModerationEvents(guildId: string, limit = 100): Promise<ModerationEvent[]> {
  const res = await client.execute({ sql: 'SELECT * FROM moderation_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', args: [guildId, limit] });
  return res.rows as unknown as ModerationEvent[];
}
export async function getModerationEventByEventId(eventId: string): Promise<ModerationEvent | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM moderation_events WHERE event_id = ?', args: [eventId] });
  return res.rows[0] as unknown as ModerationEvent | undefined;
}

export interface NukeEvent { id: number; guild_id: string; event_type: string; executor_id: string | null; target_id: string | null; details: string | null; severity: string; action_taken: string | null; created_at: number; }
export async function logNukeEvent(data: { guild_id: string; event_type: string; executor_id: string | null; target_id: string | null; details: string | null; severity: string; action_taken: string | null; }): Promise<number> {
  const res = await client.execute({
    sql: `INSERT INTO nuke_events (guild_id, event_type, executor_id, target_id, details, severity, action_taken, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.guild_id, data.event_type, data.executor_id, data.target_id, data.details, data.severity, data.action_taken, Date.now()],
  });
  return Number(res.lastInsertRowid);
}
export async function getNukeEvents(guildId: string, limit = 100): Promise<NukeEvent[]> {
  const res = await client.execute({ sql: 'SELECT * FROM nuke_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', args: [guildId, limit] });
  return res.rows as unknown as NukeEvent[];
}
export async function countRecentNukeEvents(guildId: string, eventType: string, windowMs: number): Promise<number> {
  const res = await client.execute({ sql: 'SELECT COUNT(*) as c FROM nuke_events WHERE guild_id = ? AND event_type = ? AND created_at >= ?', args: [guildId, eventType, Date.now() - windowMs] });
  return Number(res.rows[0].c);
}

// ===== Spam Sessions =====
export interface SpamSessionRow { id: number; guild_id: string; user_id: string; violation_type: string; detected_at: number; window_start: number; window_ms: number; message_count: number; channels_json: string; punishment: string | null; punished_at: number | null; deleted_count: number; failed_count: number; status: string; details: string | null; created_at: number; }

function mapSpamSessionRow(row: Record<string, unknown>): SpamSessionRow {
  return {
    id: Number(row.id),
    guild_id: String(row.guild_id ?? ''),
    user_id: String(row.user_id ?? ''),
    violation_type: String(row.violation_type ?? ''),
    detected_at: Number(row.detected_at ?? 0),
    window_start: Number(row.window_start ?? 0),
    window_ms: Number(row.window_ms ?? 0),
    message_count: Number(row.message_count ?? 0),
    channels_json: String(row.channels_json ?? '[]'),
    punishment: row.punishment != null ? String(row.punishment) : null,
    punished_at: row.punished_at != null ? Number(row.punished_at) : null,
    deleted_count: Number(row.deleted_count ?? 0),
    failed_count: Number(row.failed_count ?? 0),
    status: String(row.status ?? 'pending'),
    details: row.details != null ? String(row.details) : null,
    created_at: Number(row.created_at ?? 0),
  };
}

export async function createSpamSession(data: { guild_id: string; user_id: string; violation_type: string; detected_at: number; window_start: number; window_ms: number; message_count: number; channels: string[]; punishment: string | null; details: string | null; }): Promise<number> {
  const res = await client.execute({
    sql: `INSERT INTO spam_sessions (guild_id, user_id, violation_type, detected_at, window_start, window_ms, message_count, channels_json, punishment, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.guild_id, data.user_id, data.violation_type, data.detected_at, data.window_start, data.window_ms, data.message_count, JSON.stringify(data.channels), data.punishment, data.details, Date.now()],
  });
  return Number(res.lastInsertRowid);
}
export async function updateSpamSession(id: number, patch: Partial<SpamSessionRow>): Promise<void> {
  const res = await client.execute({ sql: 'SELECT * FROM spam_sessions WHERE id = ?', args: [id] });
  const raw = res.rows[0];
  if (!raw) return;
  const c = mapSpamSessionRow(raw as Record<string, unknown>);
  await client.execute({
    sql: `UPDATE spam_sessions SET punishment=?, punished_at=?, deleted_count=?, failed_count=?, status=?, details=? WHERE id=?`,
    args: [patch.punishment ?? c.punishment, patch.punished_at ?? c.punished_at, patch.deleted_count ?? c.deleted_count, patch.failed_count ?? c.failed_count, patch.status ?? c.status, patch.details ?? c.details, id],
  });
}
export async function addSpamSessionMessage(sessionId: number, messageId: string, channelId: string, timestamp: number): Promise<void> {
  await client.execute({ sql: `INSERT INTO spam_session_messages (session_id, message_id, channel_id, timestamp) VALUES (?, ?, ?, ?)`, args: [sessionId, messageId, channelId, timestamp] });
}
export async function markSpamMessageDeleted(id: number, deleted: boolean, error: string | null): Promise<void> {
  await client.execute({ sql: 'UPDATE spam_session_messages SET deleted = ?, delete_error = ? WHERE id = ?', args: [deleted ? 1 : 0, error, id] });
}
export async function getSpamSessionMessages(sessionId: number): Promise<{ id: number; message_id: string; channel_id: string; deleted: number; delete_error: string | null }[]> {
  const res = await client.execute({ sql: 'SELECT id, message_id, channel_id, deleted, delete_error FROM spam_session_messages WHERE session_id = ?', args: [sessionId] });
  return res.rows as unknown as any[];
}
export async function listSpamSessions(guildId: string, limit = 100): Promise<SpamSessionRow[]> {
  const res = await client.execute({ sql: 'SELECT * FROM spam_sessions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?', args: [guildId, limit] });
  return res.rows.map(r => mapSpamSessionRow(r as Record<string, unknown>));
}
export async function getSpamSession(id: number): Promise<SpamSessionRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM spam_sessions WHERE id = ?', args: [id] });
  const raw = res.rows[0];
  return raw ? mapSpamSessionRow(raw as Record<string, unknown>) : undefined;
}

// ===== Components V2 Jobs =====
export interface Cv2JobRow { id: number; guild_id: string; panel_type: string; channel_id: string; message_id: string; status: string; error: string | null; backup_json: string | null; converted_at: number | null; created_at: number; }
export async function upsertCv2Job(data: { guild_id: string; panel_type: string; channel_id: string; message_id: string; status: string; error?: string | null; backup_json?: string | null; }): Promise<number> {
  const existing = await client.execute({ sql: 'SELECT id FROM componentsv2_jobs WHERE message_id = ?', args: [data.message_id] });
  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    await client.execute({ sql: `UPDATE componentsv2_jobs SET status=?, error=?, backup_json=?, converted_at=? WHERE id=?`, args: [data.status, data.error ?? null, data.backup_json ?? null, data.status === 'converted' ? Date.now() : null, id] });
    return Number(id);
  }
  const res = await client.execute({
    sql: `INSERT INTO componentsv2_jobs (guild_id, panel_type, channel_id, message_id, status, error, backup_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [data.guild_id, data.panel_type, data.channel_id, data.message_id, data.status, data.error ?? null, data.backup_json ?? null, Date.now()],
  });
  return Number(res.lastInsertRowid);
}
export async function getCv2Job(messageId: string): Promise<Cv2JobRow | undefined> {
  const res = await client.execute({ sql: 'SELECT * FROM componentsv2_jobs WHERE message_id = ?', args: [messageId] });
  return res.rows[0] as unknown as Cv2JobRow | undefined;
}
export async function listCv2Jobs(guildId: string, status?: string): Promise<Cv2JobRow[]> {
  if (status) {
    const res = await client.execute({ sql: 'SELECT * FROM componentsv2_jobs WHERE guild_id = ? AND status = ? ORDER BY created_at DESC', args: [guildId, status] });
    return res.rows as unknown as Cv2JobRow[];
  }
  const res = await client.execute({ sql: 'SELECT * FROM componentsv2_jobs WHERE guild_id = ? ORDER BY created_at DESC', args: [guildId] });
  return res.rows as unknown as Cv2JobRow[];
}

export async function closeDatabase(): Promise<void> {
  try { if (client) client.close(); }
  catch (e) { console.error('[Blade X] closeDatabase:', e); }
}

// ============================================================
// ✅ تصدير آمن — Proxy يقرأ `client` وقت الاستخدام فقط
// ============================================================
/**
 * `dbClient` هو Proxy يقرأ `client` lazily عبر `get` trap.
 * هذا يسمح بـ:
 *   - `import db from './database.js'` → يعمل
 *   - `import { dbClient } from './database.js'` → يعمل
 *   - Accessing before initDatabase() → رسالة خطأ واضحة
 *   - لا يعتمد على ترتيب التحميل
 */
export const dbClient: Client = new Proxy({} as Client, {
  get(_target, prop) {
    if (!client) {
      throw new Error('[Blade X] database not initialized — call initDatabase() first');
    }
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export default dbClient;