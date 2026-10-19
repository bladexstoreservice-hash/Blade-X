import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve('data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'bladex.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS welcome_phrases (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS welcome_buttons (
    button_id TEXT PRIMARY KEY, label TEXT NOT NULL, emoji_id TEXT, url TEXT,
    style TEXT DEFAULT 'Primary', enabled INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS self_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT, role_id TEXT NOT NULL UNIQUE,
    emoji_id TEXT, label TEXT NOT NULL, description TEXT,
    sort_order INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS moderation_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, target_id TEXT NOT NULL,
    moderator_id TEXT, reason TEXT, duration_ms INTEGER, expires_at INTEGER,
    dm_status TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
    user_id TEXT, details TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS member_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
    event_type TEXT NOT NULL, account_created_at INTEGER, joined_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_type ON activity_log(event_type);
  CREATE INDEX IF NOT EXISTS idx_moderation_target ON moderation_log(target_id);

  CREATE TABLE IF NOT EXISTS movie_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    voice_channel_id TEXT, reviews_channel_id TEXT, thread_id TEXT,
    summary_message_id TEXT, created_by TEXT,
    started_at INTEGER NOT NULL, closed_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS movie_recipients (
    session_id INTEGER NOT NULL, user_id TEXT NOT NULL,
    dm_status TEXT DEFAULT 'pending', PRIMARY KEY (session_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS movie_ratings (
    session_id INTEGER NOT NULL, user_id TEXT NOT NULL, rating INTEGER NOT NULL,
    comment TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    PRIMARY KEY (session_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_movie_sessions_status ON movie_sessions(status);
  CREATE INDEX IF NOT EXISTS idx_movie_ratings_session ON movie_ratings(session_id);
  CREATE TABLE IF NOT EXISTS movie_drafts (
    user_id TEXT NOT NULL, session_id INTEGER NOT NULL, rating INTEGER DEFAULT 0,
    comment TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, session_id)
  );
  CREATE INDEX IF NOT EXISTS idx_movie_drafts_session ON movie_drafts(session_id);
  CREATE INDEX IF NOT EXISTS idx_movie_drafts_updated ON movie_drafts(updated_at);

  CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expired INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);

  CREATE TABLE IF NOT EXISTS emoji_registry (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, default_value TEXT NOT NULL,
    description TEXT, updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS mb_drafts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, payload TEXT NOT NULL,
    created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mb_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT NOT NULL, message_id TEXT,
    payload TEXT NOT NULL, sent_by TEXT, sent_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS spam_trap_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, channel_id TEXT NOT NULL,
    message_id TEXT, content TEXT, punishment TEXT NOT NULL, duration_ms INTEGER,
    success INTEGER NOT NULL, error TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spam_trap_user ON spam_trap_log(user_id);

  CREATE TABLE IF NOT EXISTS media_channels (
    channel_id TEXT PRIMARY KEY, enabled INTEGER DEFAULT 1,
    title_format TEXT DEFAULT '{user}', author_emoji TEXT DEFAULT '',
    color TEXT DEFAULT '#f59e0b',
    footer_from_label TEXT DEFAULT 'Pumpkins from',
    footer_others_label TEXT DEFAULT 'and {n} others',
    reaction_emoji TEXT DEFAULT '🎃', comment_emoji TEXT DEFAULT '💬',
    delete_emoji TEXT DEFAULT '🗑️', viewall_emoji TEXT DEFAULT '👥',
    share_emoji TEXT DEFAULT '📤',
    button_view_all_label TEXT DEFAULT 'View All',
    button_open_post_label TEXT DEFAULT 'افتح المنشور',
    thread_auto_create INTEGER DEFAULT 0,
    thread_name_format TEXT DEFAULT 'Comments · {user}',
    allow_admin_edit INTEGER DEFAULT 1, allow_admin_delete INTEGER DEFAULT 1,
    admin_role_ids TEXT DEFAULT '[]', ignore_bots INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS media_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL,
    source_channel_id TEXT NOT NULL, source_message_id TEXT NOT NULL UNIQUE,
    source_author_id TEXT NOT NULL, display_message_id TEXT NOT NULL,
    display_channel_id TEXT NOT NULL, thread_id TEXT, media_url TEXT,
    media_type TEXT, content_snapshot TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_source ON media_posts(source_message_id);
  CREATE INDEX IF NOT EXISTS idx_media_author ON media_posts(source_author_id, guild_id);

  CREATE TABLE IF NOT EXISTS media_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT, post_id INTEGER NOT NULL,
    file_name TEXT NOT NULL, file_path TEXT NOT NULL,
    media_type TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_media_files_post ON media_files(post_id);

  CREATE TABLE IF NOT EXISTS media_reactions (
    post_id INTEGER NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (post_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_media_reactions_post ON media_reactions(post_id);

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, number INTEGER NOT NULL,
    user_id TEXT NOT NULL, channel_id TEXT NOT NULL, subject TEXT NOT NULL,
    description TEXT, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
    closed_at INTEGER, closed_by TEXT, transcript_sent INTEGER DEFAULT 0,
    close_status TEXT, close_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id, status);
  CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id, status);
  CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);

  CREATE TABLE IF NOT EXISTS suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    message_id TEXT NOT NULL, channel_id TEXT NOT NULL, title TEXT NOT NULL,
    description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(guild_id, status);
  CREATE INDEX IF NOT EXISTS idx_suggestions_msg ON suggestions(message_id);
  CREATE TABLE IF NOT EXISTS suggestion_votes (
    suggestion_id INTEGER NOT NULL, user_id TEXT NOT NULL, vote INTEGER NOT NULL,
    created_at INTEGER NOT NULL, PRIMARY KEY (suggestion_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS moderation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE,
    guild_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT NOT NULL,
    moderator_id TEXT, reason TEXT, extra_details TEXT, duration_ms INTEGER,
    source TEXT DEFAULT 'bot', actor_confidence TEXT DEFAULT 'high',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mod_events_target ON moderation_events(guild_id, target_id, created_at);

  CREATE TABLE IF NOT EXISTS nuke_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, event_type TEXT NOT NULL,
    executor_id TEXT, target_id TEXT, details TEXT, severity TEXT DEFAULT 'medium',
    action_taken TEXT, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nuke_guild ON nuke_events(guild_id, created_at);

  CREATE TABLE IF NOT EXISTS spam_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, user_id TEXT NOT NULL,
    violation_type TEXT NOT NULL, detected_at INTEGER NOT NULL, window_start INTEGER NOT NULL,
    window_ms INTEGER NOT NULL, message_count INTEGER NOT NULL, channels_json TEXT NOT NULL,
    punishment TEXT, punished_at INTEGER, deleted_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', details TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_spam_sessions_guild ON spam_sessions(guild_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_spam_sessions_user ON spam_sessions(user_id, created_at);
  CREATE TABLE IF NOT EXISTS spam_session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER NOT NULL,
    message_id TEXT NOT NULL, channel_id TEXT NOT NULL, timestamp INTEGER NOT NULL,
    deleted INTEGER DEFAULT 0, delete_error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_spam_msgs_session ON spam_session_messages(session_id);

  CREATE TABLE IF NOT EXISTS componentsv2_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, panel_type TEXT NOT NULL,
    channel_id TEXT NOT NULL, message_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    error TEXT, backup_json TEXT, converted_at INTEGER, created_at INTEGER NOT NULL,
    UNIQUE(message_id)
  );
  CREATE INDEX IF NOT EXISTS idx_cv2_guild ON componentsv2_jobs(guild_id, status);
`);

function safeAddColumn(table: string, column: string, definition: string): void {
  try {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[Blade X] ✅ Migration: ${table}.${column} added`);
    }
  } catch (e) {
    console.error(`[Blade X] ❌ Migration ${table}.${column}:`, e);
  }
}

safeAddColumn('movie_ratings', 'dm_message_id', 'TEXT');
safeAddColumn('movie_ratings', 'dm_channel_id', 'TEXT');
safeAddColumn('movie_ratings', 'comment_posted', 'INTEGER DEFAULT 0');
safeAddColumn('movie_ratings', 'review_message_id', 'TEXT');
safeAddColumn('movie_recipients', 'dm_message_id', 'TEXT');
safeAddColumn('movie_sessions', 'separator_sent', 'INTEGER DEFAULT 0');
safeAddColumn('moderation_events', 'extra_details', 'TEXT');
safeAddColumn('tickets', 'transcript_sent', 'INTEGER DEFAULT 0');
safeAddColumn('tickets', 'close_status', 'TEXT');
safeAddColumn('tickets', 'close_error', 'TEXT');
safeAddColumn('media_channels', 'author_emoji', "TEXT DEFAULT ''");
safeAddColumn('media_channels', 'comment_emoji', "TEXT DEFAULT '💬'");
safeAddColumn('media_channels', 'delete_emoji', "TEXT DEFAULT '🗑️'");
safeAddColumn('media_channels', 'viewall_emoji', "TEXT DEFAULT '👥'");
safeAddColumn('media_channels', 'share_emoji', "TEXT DEFAULT '📤'");

// ✅ Share interface customization
safeAddColumn('media_channels', 'share_title', "TEXT DEFAULT 'مشاركة المنشور'");
safeAddColumn('media_channels', 'share_hint', "TEXT DEFAULT 'اختر المستلمين ثم اضغط تأكيد.'");
safeAddColumn('media_channels', 'share_note', "TEXT DEFAULT 'سيتم إرسال المنشور إلى المستلمين المحددين عبر رسالة خاصة.'");
safeAddColumn('media_channels', 'share_select_placeholder', "TEXT DEFAULT 'اختر مستلمًا أو أكثر...'");
safeAddColumn('media_channels', 'share_confirm_label', "TEXT DEFAULT 'تأكيد الإرسال'");
safeAddColumn('media_channels', 'share_cancel_label', "TEXT DEFAULT 'إلغاء'");
safeAddColumn('media_channels', 'share_title_emoji', "TEXT DEFAULT '📤'");
safeAddColumn('media_channels', 'share_confirm_emoji', "TEXT DEFAULT '✅'");
safeAddColumn('media_channels', 'share_cancel_emoji', "TEXT DEFAULT '❌'");
safeAddColumn('media_channels', 'share_color', "TEXT DEFAULT '#f59e0b'");
safeAddColumn('media_channels', 'share_dm_title', "TEXT DEFAULT '📤 تمت مشاركة منشور معك'");
safeAddColumn('media_channels', 'share_success_msg', "TEXT DEFAULT '✅ تم الإرسال'");
safeAddColumn('media_channels', 'share_partial_msg', "TEXT DEFAULT '⚠️ تعذّر إرسال رسالة خاصة إلى بعض المستلمين'");
safeAddColumn('media_channels', 'share_none_msg', "TEXT DEFAULT '⚠️ لم تختر مستلمين'");

// ✅ View All buttons customization
safeAddColumn('media_channels', 'button_open_post_emoji', "TEXT DEFAULT '🎃'");
safeAddColumn('media_channels', 'viewall_prev_label', "TEXT DEFAULT ''");
safeAddColumn('media_channels', 'viewall_prev_emoji', "TEXT DEFAULT '◀️'");
safeAddColumn('media_channels', 'viewall_next_label', "TEXT DEFAULT ''");
safeAddColumn('media_channels', 'viewall_next_emoji', "TEXT DEFAULT '▶️'");

// ✅ Archive storage (previous round)
safeAddColumn('media_files', 'storage_source', "TEXT DEFAULT 'disk'");
safeAddColumn('media_files', 'archive_channel_id', 'TEXT');
safeAddColumn('media_files', 'archive_message_id', 'TEXT');
safeAddColumn('media_files', 'archive_attachment_id', 'TEXT');
safeAddColumn('media_files', 'archive_url', 'TEXT');

// ✅ line.png separator tracking (previous round)
safeAddColumn('media_posts', 'separator_channel_id', 'TEXT');
safeAddColumn('media_posts', 'separator_message_id', 'TEXT');

// ===== Settings =====
export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}
export function getAllSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
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
export function setSettingJSON(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}

// ===== Welcome phrases =====
export function getWelcomePhrases(): string[] {
  return (db.prepare('SELECT text FROM welcome_phrases ORDER BY id').all() as { text: string }[]).map(r => r.text);
}
export function getWelcomePhrasesDetailed(): { id: number; text: string }[] {
  return db.prepare('SELECT id, text FROM welcome_phrases ORDER BY id').all() as { id: number; text: string }[];
}
export function addWelcomePhrase(text: string): void {
  db.prepare('INSERT INTO welcome_phrases (text) VALUES (?)').run(text);
}
export function replaceWelcomePhrase(id: number, text: string): void {
  db.prepare('UPDATE welcome_phrases SET text = ? WHERE id = ?').run(text, id);
}
export function deleteWelcomePhrase(id: number): void {
  db.prepare('DELETE FROM welcome_phrases WHERE id = ?').run(id);
}

// ===== Welcome buttons =====
export interface WelcomeButton {
  button_id: string; label: string; emoji_id: string | null;
  url: string | null; style: string; enabled: number;
}
export function getWelcomeButtons(): WelcomeButton[] {
  return db.prepare('SELECT * FROM welcome_buttons ORDER BY rowid').all() as WelcomeButton[];
}
export function upsertWelcomeButton(btn: WelcomeButton): void {
  db.prepare(`INSERT INTO welcome_buttons (button_id, label, emoji_id, url, style, enabled)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(button_id) DO UPDATE SET
    label = excluded.label, emoji_id = excluded.emoji_id, url = excluded.url,
    style = excluded.style, enabled = excluded.enabled`)
    .run(btn.button_id, btn.label, btn.emoji_id, btn.url, btn.style, btn.enabled);
}

// ===== Self roles =====
export interface SelfRoleRow {
  id: number; role_id: string; emoji_id: string | null;
  label: string; description: string | null; sort_order: number; enabled: number;
}
export function getSelfRoles(): SelfRoleRow[] {
  return db.prepare('SELECT * FROM self_roles ORDER BY sort_order, id').all() as SelfRoleRow[];
}
export function getSelfRoleById(id: number): SelfRoleRow | undefined {
  return db.prepare('SELECT * FROM self_roles WHERE id = ?').get(id) as SelfRoleRow | undefined;
}
export function addSelfRole(roleId: string, label: string, emojiId: string | null, description: string | null): void {
  db.prepare('INSERT INTO self_roles (role_id, label, emoji_id, description) VALUES (?, ?, ?, ?)').run(roleId, label, emojiId, description);
}
export function removeSelfRole(id: number): void {
  db.prepare('DELETE FROM self_roles WHERE id = ?').run(id);
}
export function updateSelfRole(id: number, patch: Partial<SelfRoleRow>): void {
  const c = getSelfRoleById(id);
  if (!c) return;
  db.prepare(`UPDATE self_roles SET role_id=?, emoji_id=?, label=?, description=?, sort_order=?, enabled=? WHERE id=?`)
    .run(patch.role_id ?? c.role_id, patch.emoji_id ?? c.emoji_id, patch.label ?? c.label,
      patch.description ?? c.description, patch.sort_order ?? c.sort_order, patch.enabled ?? c.enabled, id);
}

// ===== Moderation =====
export function logModeration(action: string, targetId: string, moderatorId: string | null, reason: string | null, durationMs: number | null, dmStatus: string | null): void {
  const now = Date.now();
  const expiresAt = durationMs ? now + durationMs : null;
  db.prepare(`INSERT INTO moderation_log (action, target_id, moderator_id, reason, duration_ms, expires_at, dm_status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(action, targetId, moderatorId, reason, durationMs, expiresAt, dmStatus, now);
}
export function getActiveTemporaryPunishments(): { action: string; target_id: string; expires_at: number }[] {
  return db.prepare('SELECT action, target_id, expires_at FROM moderation_log WHERE expires_at IS NOT NULL AND expires_at > ? AND action IN (?, ?)')
    .all(Date.now(), 'ban', 'timeout') as any[];
}
export function getModerationLog(limit = 100): any[] {
  return db.prepare('SELECT * FROM moderation_log ORDER BY created_at DESC LIMIT ?').all(limit);
}

// ===== Activity log =====
export function logActivity(eventType: string, userId: string | null, details: string | null): void {
  db.prepare('INSERT INTO activity_log (event_type, user_id, details, created_at) VALUES (?, ?, ?, ?)')
    .run(eventType, userId, details, Date.now());
}
export function getRecentActivity(limit = 50): any[] {
  return db.prepare('SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
}
export function logMemberHistory(userId: string, eventType: string, accountCreatedAt: number | null, joinedAt: number | null): void {
  db.prepare('INSERT INTO member_history (user_id, event_type, account_created_at, joined_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, eventType, accountCreatedAt, joinedAt, Date.now());
}

// ===== Movie Night =====
export interface MovieSession {
  id: number; movie_name: string; status: string;
  voice_channel_id: string | null; reviews_channel_id: string | null;
  thread_id: string | null; summary_message_id: string | null;
  created_by: string | null; started_at: number; closed_at: number | null;
  separator_sent?: number;
}
export function createMovieSession(movieName: string, voiceChannelId: string | null, reviewsChannelId: string | null, createdBy: string): number {
  const info = db.prepare(`INSERT INTO movie_sessions (movie_name, status, voice_channel_id, reviews_channel_id, created_by, started_at)
    VALUES (?, 'open', ?, ?, ?, ?)`).run(movieName, voiceChannelId, reviewsChannelId, createdBy, Date.now());
  return Number(info.lastInsertRowid);
}
export function getMovieSession(id: number): MovieSession | undefined {
  return db.prepare('SELECT * FROM movie_sessions WHERE id = ?').get(id) as MovieSession | undefined;
}
export function getActiveMovieSession(): MovieSession | undefined {
  return db.prepare("SELECT * FROM movie_sessions WHERE status = 'open' ORDER BY started_at DESC LIMIT 1").get() as MovieSession | undefined;
}
export function getRecentMovieSessions(limit = 10): MovieSession[] {
  return db.prepare('SELECT * FROM movie_sessions ORDER BY started_at DESC LIMIT ?').all(limit) as MovieSession[];
}
export function updateMovieSession(id: number, patch: Partial<MovieSession>): void {
  const c = getMovieSession(id);
  if (!c) return;
  db.prepare(`UPDATE movie_sessions SET movie_name=?, status=?, voice_channel_id=?, reviews_channel_id=?, thread_id=?, summary_message_id=?, closed_at=?, separator_sent=? WHERE id=?`)
    .run(patch.movie_name ?? c.movie_name, patch.status ?? c.status,
      patch.voice_channel_id ?? c.voice_channel_id, patch.reviews_channel_id ?? c.reviews_channel_id,
      patch.thread_id ?? c.thread_id, patch.summary_message_id ?? c.summary_message_id,
      patch.closed_at ?? c.closed_at, patch.separator_sent ?? c.separator_sent ?? 0, id);
}
export function addMovieRecipient(sessionId: number, userId: string, dmStatus: string): void {
  db.prepare('INSERT OR REPLACE INTO movie_recipients (session_id, user_id, dm_status) VALUES (?, ?, ?)').run(sessionId, userId, dmStatus);
}
export function getMovieRecipients(sessionId: number): { user_id: string; dm_status: string }[] {
  return db.prepare('SELECT user_id, dm_status FROM movie_recipients WHERE session_id = ?').all(sessionId) as any[];
}
export function isMovieRecipient(sessionId: number, userId: string): boolean {
  return !!db.prepare('SELECT 1 FROM movie_recipients WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
}
export function upsertMovieRating(sessionId: number, userId: string, rating: number, comment: string | null): void {
  const now = Date.now();
  const existing = db.prepare('SELECT 1 FROM movie_ratings WHERE session_id = ? AND user_id = ?').get(sessionId, userId);
  if (existing) {
    db.prepare('UPDATE movie_ratings SET rating=?, comment=COALESCE(?, comment), updated_at=? WHERE session_id=? AND user_id=?')
      .run(rating, comment, now, sessionId, userId);
  } else {
    db.prepare('INSERT INTO movie_ratings (session_id, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sessionId, userId, rating, comment, now, now);
  }
}
export function getAllMovieRatings(sessionId: number): { user_id: string; rating: number; comment: string | null; created_at: number; updated_at: number }[] {
  return db.prepare('SELECT user_id, rating, comment, created_at, updated_at FROM movie_ratings WHERE session_id = ? ORDER BY created_at').all(sessionId) as any[];
}
export function getMovieStats(sessionId: number): { count: number; average: number; distribution: Record<number, number> } {
  const rows = db.prepare('SELECT rating FROM movie_ratings WHERE session_id = ? AND rating > 0').all(sessionId) as { rating: number }[];
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of rows) { sum += r.rating; dist[r.rating] = (dist[r.rating] ?? 0) + 1; }
  return { count: rows.length, average: rows.length > 0 ? sum / rows.length : 0, distribution: dist };
}

export interface MovieRatingState {
  session_id: number; user_id: string; rating: number; comment: string | null;
  created_at: number; updated_at: number;
  dm_message_id: string | null; dm_channel_id: string | null; comment_posted: number;
  review_message_id: string | null;
}
export function getMovieRatingFull(sessionId: number, userId: string): MovieRatingState | undefined {
  return db.prepare('SELECT * FROM movie_ratings WHERE session_id = ? AND user_id = ?').get(sessionId, userId) as MovieRatingState | undefined;
}
export function getMovieRating(sessionId: number, userId: string): { rating: number; comment: string | null } | undefined {
  return db.prepare('SELECT rating, comment FROM movie_ratings WHERE session_id = ? AND user_id = ?').get(sessionId, userId) as any;
}
export function setRatingOnly(sessionId: number, userId: string, rating: number): void {
  const now = Date.now();
  const existing = getMovieRatingFull(sessionId, userId);
  if (existing) {
    db.prepare('UPDATE movie_ratings SET rating=?, updated_at=? WHERE session_id=? AND user_id=?').run(rating, now, sessionId, userId);
  } else {
    db.prepare('INSERT INTO movie_ratings (session_id, user_id, rating, comment, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)')
      .run(sessionId, userId, rating, now, now);
  }
}
export function setCommentOnly(sessionId: number, userId: string, comment: string): void {
  const now = Date.now();
  const existing = getMovieRatingFull(sessionId, userId);
  if (existing) {
    db.prepare('UPDATE movie_ratings SET comment=?, comment_posted=1, updated_at=? WHERE session_id=? AND user_id=?').run(comment, now, sessionId, userId);
  } else {
    db.prepare('INSERT INTO movie_ratings (session_id, user_id, rating, comment, comment_posted, created_at, updated_at) VALUES (?, ?, 0, ?, 1, ?, ?)')
      .run(sessionId, userId, comment, now, now);
  }
}
export function setDMMessageRef(sessionId: number, userId: string, channelId: string, messageId: string): void {
  const existing = getMovieRatingFull(sessionId, userId);
  if (existing) {
    db.prepare('UPDATE movie_ratings SET dm_channel_id=?, dm_message_id=? WHERE session_id=? AND user_id=?').run(channelId, messageId, sessionId, userId);
  } else {
    const now = Date.now();
    db.prepare('INSERT INTO movie_ratings (session_id, user_id, rating, comment, created_at, updated_at, dm_channel_id, dm_message_id) VALUES (?, ?, 0, NULL, ?, ?, ?, ?)')
      .run(sessionId, userId, now, now, channelId, messageId);
  }
}
export function getMovieStatsFull(sessionId: number): {
  ratingsCount: number; commentsCount: number;
  average: number; distribution: Record<number, number>;
} {
  const rows = db.prepare('SELECT rating, comment, comment_posted FROM movie_ratings WHERE session_id = ?').all(sessionId) as { rating: number; comment: string | null; comment_posted: number }[];
  const dist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0; let rated = 0; let comments = 0;
  for (const r of rows) {
    if (r.rating > 0) { sum += r.rating; dist[r.rating] = (dist[r.rating] ?? 0) + 1; rated++; }
    if (r.comment && r.comment.trim()) comments++;
  }
  return { ratingsCount: rated, commentsCount: comments, average: rated > 0 ? sum / rated : 0, distribution: dist };
}
export function setReviewMessageId(sessionId: number, userId: string, messageId: string): void {
  try {
    db.prepare('UPDATE movie_ratings SET review_message_id = ? WHERE session_id = ? AND user_id = ?')
      .run(messageId, sessionId, userId);
  } catch (e) { console.error('[Blade X] ❌ setReviewMessageId:', e); }
}
export function getReviewMessageId(sessionId: number, userId: string): string | null {
  try {
    const row = db.prepare('SELECT review_message_id FROM movie_ratings WHERE session_id = ? AND user_id = ?')
      .get(sessionId, userId) as { review_message_id: string | null } | undefined;
    return row?.review_message_id ?? null;
  } catch { return null; }
}

// ===== Movie Drafts =====
export interface MovieDraftRow {
  user_id: string; session_id: number; rating: number;
  comment: string | null; updated_at: number;
}
export function getMovieDraft(userId: string, sessionId: number): MovieDraftRow | undefined {
  return db.prepare('SELECT * FROM movie_drafts WHERE user_id = ? AND session_id = ?').get(userId, sessionId) as MovieDraftRow | undefined;
}
export function upsertMovieDraft(userId: string, sessionId: number, patch: { rating?: number; comment?: string | null }): void {
  const existing = getMovieDraft(userId, sessionId);
  const now = Date.now();
  if (existing) {
    db.prepare('UPDATE movie_drafts SET rating = ?, comment = ?, updated_at = ? WHERE user_id = ? AND session_id = ?')
      .run(patch.rating ?? existing.rating, patch.comment !== undefined ? patch.comment : existing.comment, now, userId, sessionId);
  } else {
    db.prepare('INSERT INTO movie_drafts (user_id, session_id, rating, comment, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, sessionId, patch.rating ?? 0, patch.comment ?? null, now);
  }
}
export function deleteMovieDraft(userId: string, sessionId: number): void {
  db.prepare('DELETE FROM movie_drafts WHERE user_id = ? AND session_id = ?').run(userId, sessionId);
}
export function cleanupOldMovieDrafts(maxAgeMs = 7 * 86_400_000): void {
  db.prepare('DELETE FROM movie_drafts WHERE updated_at < ?').run(Date.now() - maxAgeMs);
}

// ===== Message Builder =====
export function mbSaveDraft(name: string, payload: unknown, createdBy: string): number {
  const now = Date.now();
  const info = db.prepare(`INSERT INTO mb_drafts (name, payload, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run(name, JSON.stringify(payload), createdBy, now, now);
  return Number(info.lastInsertRowid);
}
export function mbUpdateDraft(id: number, name: string, payload: unknown): void {
  db.prepare(`UPDATE mb_drafts SET name=?, payload=?, updated_at=? WHERE id=?`).run(name, JSON.stringify(payload), Date.now(), id);
}
export function mbDeleteDraft(id: number): void {
  db.prepare('DELETE FROM mb_drafts WHERE id = ?').run(id);
}
export function mbGetDrafts(): any[] {
  return db.prepare('SELECT id, name, payload, created_by, updated_at FROM mb_drafts ORDER BY updated_at DESC').all();
}
export function mbGetDraft(id: number): any {
  return db.prepare('SELECT id, name, payload, created_by FROM mb_drafts WHERE id = ?').get(id);
}
export function mbLogSend(channelId: string, messageId: string | null, payload: unknown, sentBy: string): void {
  db.prepare(`INSERT INTO mb_history (channel_id, message_id, payload, sent_by, sent_at) VALUES (?, ?, ?, ?, ?)`)
    .run(channelId, messageId, JSON.stringify(payload), sentBy, Date.now());
}
export function mbGetHistory(limit = 50): any[] {
  return db.prepare('SELECT * FROM mb_history ORDER BY sent_at DESC LIMIT ?').all(limit);
}

// ===== Spam Trap =====
export interface SpamTrapConfig {
  enabled: boolean; channelId: string | null; punishment: 'ban' | 'timeout' | 'kick';
  timeoutMs: number; logChannelId: string | null; ignoreRoles: string[]; ignoreBots: boolean;
}
export function getSpamTrapConfig(): SpamTrapConfig {
  const raw = getSetting('spam_trap_config');
  const def: SpamTrapConfig = {
    enabled: false, channelId: null, punishment: 'ban',
    timeoutMs: 7 * 86_400_000, logChannelId: null, ignoreRoles: [], ignoreBots: true,
  };
  if (!raw) return def;
  try { return { ...def, ...JSON.parse(raw) }; } catch { return def; }
}
export function setSpamTrapConfig(cfg: Partial<SpamTrapConfig>): void {
  const current = getSpamTrapConfig();
  setSetting('spam_trap_config', JSON.stringify({ ...current, ...cfg }));
}
export function logSpamTrap(userId: string, channelId: string, messageId: string | null, content: string | null, punishment: string, durationMs: number | null, success: boolean, error: string | null): void {
  db.prepare(`INSERT INTO spam_trap_log (user_id, channel_id, message_id, content, punishment, duration_ms, success, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, channelId, messageId, content, punishment, durationMs, success ? 1 : 0, error, Date.now());
}
export function getSpamTrapLog(limit = 100): any[] {
  return db.prepare('SELECT * FROM spam_trap_log ORDER BY created_at DESC LIMIT ?').all(limit);
}

// ===== Media Show =====
export interface MediaChannel {
  channel_id: string; enabled: number; title_format: string;
  author_emoji: string; color: string;
  footer_from_label: string; footer_others_label: string; reaction_emoji: string;
  comment_emoji: string; delete_emoji: string; viewall_emoji: string;
  share_emoji: string;
  share_title: string;
  share_hint: string;
  share_note: string;
  share_select_placeholder: string;
  share_confirm_label: string;
  share_cancel_label: string;
  share_title_emoji: string;
  share_confirm_emoji: string;
  share_cancel_emoji: string;
  share_color: string;
  share_dm_title: string;
  share_success_msg: string;
  share_partial_msg: string;
  share_none_msg: string;
  button_open_post_emoji: string;
  viewall_prev_label: string;
  viewall_prev_emoji: string;
  viewall_next_label: string;
  viewall_next_emoji: string;
  button_view_all_label: string; button_open_post_label: string;
  thread_auto_create: number; thread_name_format: string;
  allow_admin_edit: number; allow_admin_delete: number;
  admin_role_ids: string; ignore_bots: number;
  created_at: number; updated_at: number;
}
export function getMediaChannels(): MediaChannel[] {
  return db.prepare('SELECT * FROM media_channels ORDER BY created_at').all() as MediaChannel[];
}
export function getMediaChannel(channelId: string): MediaChannel | undefined {
  return db.prepare('SELECT * FROM media_channels WHERE channel_id = ?').get(channelId) as MediaChannel | undefined;
}
export function isMediaChannel(channelId: string): boolean {
  const ch = getMediaChannel(channelId);
  return !!ch && ch.enabled === 1;
}
export function addMediaChannel(channelId: string): void {
  const now = Date.now();
  db.prepare(`INSERT OR IGNORE INTO media_channels (channel_id, created_at, updated_at) VALUES (?, ?, ?)`).run(channelId, now, now);
}
export function updateMediaChannel(channelId: string, patch: Partial<MediaChannel>): void {
  const c = getMediaChannel(channelId);
  if (!c) return;
  db.prepare(`UPDATE media_channels SET
    enabled = ?, title_format = ?, author_emoji = ?, color = ?,
    footer_from_label = ?, footer_others_label = ?,
    reaction_emoji = ?, comment_emoji = ?, delete_emoji = ?, viewall_emoji = ?,
    share_emoji = ?,
    share_title = ?, share_hint = ?, share_note = ?, share_select_placeholder = ?,
    share_confirm_label = ?, share_cancel_label = ?,
    share_title_emoji = ?, share_confirm_emoji = ?, share_cancel_emoji = ?,
    share_color = ?, share_dm_title = ?, share_success_msg = ?,
    share_partial_msg = ?, share_none_msg = ?,
    button_open_post_emoji = ?,
    viewall_prev_label = ?, viewall_prev_emoji = ?,
    viewall_next_label = ?, viewall_next_emoji = ?,
    button_view_all_label = ?, button_open_post_label = ?,
    thread_auto_create = ?, thread_name_format = ?, allow_admin_edit = ?, allow_admin_delete = ?,
    admin_role_ids = ?, ignore_bots = ?, updated_at = ?
    WHERE channel_id = ?`)
    .run(
      patch.enabled ?? c.enabled, patch.title_format ?? c.title_format,
      patch.author_emoji ?? c.author_emoji, patch.color ?? c.color,
      patch.footer_from_label ?? c.footer_from_label, patch.footer_others_label ?? c.footer_others_label,
      patch.reaction_emoji ?? c.reaction_emoji, patch.comment_emoji ?? c.comment_emoji,
      patch.delete_emoji ?? c.delete_emoji, patch.viewall_emoji ?? c.viewall_emoji,
      patch.share_emoji ?? c.share_emoji,
      patch.share_title ?? c.share_title, patch.share_hint ?? c.share_hint,
      patch.share_note ?? c.share_note, patch.share_select_placeholder ?? c.share_select_placeholder,
      patch.share_confirm_label ?? c.share_confirm_label, patch.share_cancel_label ?? c.share_cancel_label,
      patch.share_title_emoji ?? c.share_title_emoji, patch.share_confirm_emoji ?? c.share_confirm_emoji,
      patch.share_cancel_emoji ?? c.share_cancel_emoji,
      patch.share_color ?? c.share_color, patch.share_dm_title ?? c.share_dm_title,
      patch.share_success_msg ?? c.share_success_msg,
      patch.share_partial_msg ?? c.share_partial_msg, patch.share_none_msg ?? c.share_none_msg,
      patch.button_open_post_emoji ?? c.button_open_post_emoji,
      patch.viewall_prev_label ?? c.viewall_prev_label, patch.viewall_prev_emoji ?? c.viewall_prev_emoji,
      patch.viewall_next_label ?? c.viewall_next_label, patch.viewall_next_emoji ?? c.viewall_next_emoji,
      patch.button_view_all_label ?? c.button_view_all_label, patch.button_open_post_label ?? c.button_open_post_label,
      patch.thread_auto_create ?? c.thread_auto_create, patch.thread_name_format ?? c.thread_name_format,
      patch.allow_admin_edit ?? c.allow_admin_edit, patch.allow_admin_delete ?? c.allow_admin_delete,
      patch.admin_role_ids ?? c.admin_role_ids, patch.ignore_bots ?? c.ignore_bots,
      Date.now(), channelId
    );
}
export function removeMediaChannel(channelId: string): void {
  db.prepare('DELETE FROM media_channels WHERE channel_id = ?').run(channelId);
}

export interface MediaPost {
  id: number; guild_id: string; source_channel_id: string; source_message_id: string;
  source_author_id: string; display_message_id: string; display_channel_id: string;
  thread_id: string | null; media_url: string | null; media_type: string | null;
  content_snapshot: string | null; created_at: number;
  separator_channel_id?: string | null;
  separator_message_id?: string | null;
}
export function createMediaPost(data: Omit<MediaPost, 'id'>): number {
  const info = db.prepare(`INSERT INTO media_posts
    (guild_id, source_channel_id, source_message_id, source_author_id,
     display_message_id, display_channel_id, thread_id, media_url, media_type,
     content_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      data.guild_id, data.source_channel_id, data.source_message_id, data.source_author_id,
      data.display_message_id, data.display_channel_id, data.thread_id, data.media_url,
      data.media_type, data.content_snapshot, data.created_at
    );
  return Number(info.lastInsertRowid);
}
export function reserveMediaPost(data: {
  guild_id: string; source_channel_id: string; source_message_id: string;
  source_author_id: string; display_message_id?: string; display_channel_id: string;
  thread_id?: string | null; media_url?: string | null; media_type?: string | null;
  content_snapshot?: string | null; created_at?: number;
}): number {
  const info = db.prepare(`INSERT INTO media_posts
    (guild_id, source_channel_id, source_message_id, source_author_id,
     display_message_id, display_channel_id, thread_id, media_url, media_type,
     content_snapshot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      data.guild_id, data.source_channel_id, data.source_message_id, data.source_author_id,
      data.display_message_id ?? '', data.display_channel_id, data.thread_id ?? null,
      data.media_url ?? null, data.media_type ?? null,
      data.content_snapshot ?? null, data.created_at ?? Date.now()
    );
  return Number(info.lastInsertRowid);
}
export function updateMediaPostDisplay(postId: number, displayMessageId: string): void {
  db.prepare('UPDATE media_posts SET display_message_id = ? WHERE id = ?').run(displayMessageId, postId);
}
export function updateMediaPostThread(postId: number, threadId: string | null): void {
  db.prepare('UPDATE media_posts SET thread_id = ? WHERE id = ?').run(threadId, postId);
}
export function updateMediaPostMediaUrl(postId: number, mediaUrl: string | null): void {
  db.prepare('UPDATE media_posts SET media_url = ? WHERE id = ?').run(mediaUrl, postId);
}
export function updateMediaPostSeparator(postId: number, channelId: string, messageId: string): void {
  db.prepare('UPDATE media_posts SET separator_channel_id = ?, separator_message_id = ? WHERE id = ?')
    .run(channelId, messageId, postId);
}
export function getMediaPostBySource(messageId: string): MediaPost | undefined {
  return db.prepare('SELECT * FROM media_posts WHERE source_message_id = ?').get(messageId) as MediaPost | undefined;
}
export function getMediaPostByDisplay(messageId: string): MediaPost | undefined {
  return db.prepare('SELECT * FROM media_posts WHERE display_message_id = ?').get(messageId) as MediaPost | undefined;
}
export function getMediaPostById(id: number): MediaPost | undefined {
  return db.prepare('SELECT * FROM media_posts WHERE id = ?').get(id) as MediaPost | undefined;
}
export function getUserMediaPosts(authorId: string, limit = 100): MediaPost[] {
  return db.prepare('SELECT * FROM media_posts WHERE source_author_id = ? ORDER BY created_at DESC LIMIT ?').all(authorId, limit) as MediaPost[];
}
export function setMediaPostThread(postId: number, threadId: string): void {
  db.prepare('UPDATE media_posts SET thread_id = ? WHERE id = ?').run(threadId, postId);
}
export function deleteMediaPost(postId: number): void {
  db.prepare('DELETE FROM media_reactions WHERE post_id = ?').run(postId);
  db.prepare('DELETE FROM media_files WHERE post_id = ?').run(postId);
  db.prepare('DELETE FROM media_posts WHERE id = ?').run(postId);
}

// ===== Media files =====
export interface MediaFileRow {
  id: number; post_id: number; file_name: string; file_path: string;
  media_type: 'image' | 'video'; size: number; created_at: number;
  storage_source: 'disk' | 'archive' | 'cdn_url' | null;
  archive_channel_id: string | null;
  archive_message_id: string | null;
  archive_attachment_id: string | null;
  archive_url: string | null;
}
export function insertMediaFile(data: {
  postId: number; fileName: string; filePath: string;
  mediaType: 'image' | 'video'; size: number;
  storageSource?: 'disk' | 'archive' | 'cdn_url';
  archiveChannelId?: string | null; archiveMessageId?: string | null;
  archiveAttachmentId?: string | null; archiveUrl?: string | null;
}): number {
  const info = db.prepare(`INSERT INTO media_files
    (post_id, file_name, file_path, media_type, size, created_at,
     storage_source, archive_channel_id, archive_message_id, archive_attachment_id, archive_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      data.postId, data.fileName, data.filePath, data.mediaType, data.size, Date.now(),
      data.storageSource ?? 'disk',
      data.archiveChannelId ?? null, data.archiveMessageId ?? null,
      data.archiveAttachmentId ?? null, data.archiveUrl ?? null,
    );
  return Number(info.lastInsertRowid);
}
export function getMediaFiles(postId: number): MediaFileRow[] {
  return db.prepare('SELECT * FROM media_files WHERE post_id = ? ORDER BY id').all(postId) as MediaFileRow[];
}
export function deleteMediaFilesForPost(postId: number): void {
  db.prepare('DELETE FROM media_files WHERE post_id = ?').run(postId);
}

// ===== Media storage stats =====
export function getTotalMediaFilesSize(): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(size), 0) as total FROM media_files WHERE storage_source = 'disk' OR storage_source IS NULL")
    .get() as { total: number };
  return row?.total ?? 0;
}
export function countMediaFiles(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM media_files').get() as { c: number };
  return row?.c ?? 0;
}
export function countMediaPosts(): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM media_posts').get() as { c: number };
  return row?.c ?? 0;
}
export function countArchivedMedia(): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM media_files WHERE storage_source = 'archive'").get() as { c: number };
  return row?.c ?? 0;
}
export function countDiskMedia(): number {
  const row = db.prepare("SELECT COUNT(*) as c FROM media_files WHERE storage_source = 'disk' OR storage_source IS NULL").get() as { c: number };
  return row?.c ?? 0;
}
export function getOldestMediaFilePostIds(limit = 100): number[] {
  const rows = db
    .prepare("SELECT post_id, MIN(created_at) as oldest FROM media_files WHERE storage_source = 'disk' OR storage_source IS NULL GROUP BY post_id ORDER BY oldest ASC LIMIT ?")
    .all(limit) as { post_id: number }[];
  return rows.map(r => r.post_id);
}

export function addMediaReaction(postId: number, userId: string, emoji: string): boolean {
  try {
    db.prepare('INSERT INTO media_reactions (post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)').run(postId, userId, emoji, Date.now());
    return true;
  } catch { return false; }
}
export function removeMediaReaction(postId: number, userId: string): boolean {
  const info = db.prepare('DELETE FROM media_reactions WHERE post_id = ? AND user_id = ?').run(postId, userId);
  return info.changes > 0;
}
export function hasMediaReaction(postId: number, userId: string): boolean {
  return !!db.prepare('SELECT 1 FROM media_reactions WHERE post_id = ? AND user_id = ?').get(postId, userId);
}
export function getMediaReactionCount(postId: number): number {
  return (db.prepare('SELECT COUNT(*) as c FROM media_reactions WHERE post_id = ?').get(postId) as { c: number }).c;
}
export function getMediaReactionUsers(postId: number, limit = 100): string[] {
  return (db.prepare('SELECT user_id FROM media_reactions WHERE post_id = ? ORDER BY created_at LIMIT ?').all(postId, limit) as { user_id: string }[])
    .map(r => r.user_id);
}

// ===== Tickets =====
export interface TicketRow {
  id: number; guild_id: string; number: number; user_id: string;
  channel_id: string; subject: string; description: string | null;
  status: string; created_at: number; closed_at: number | null; closed_by: string | null;
  transcript_sent?: number; close_status?: string | null; close_error?: string | null;
}
export function getNextTicketNumber(guildId: string): number {
  const row = db.prepare('SELECT MAX(number) as max FROM tickets WHERE guild_id = ?').get(guildId) as { max: number | null };
  return (row.max ?? 0) + 1;
}
export function createTicket(data: {
  guild_id: string; number: number; user_id: string; channel_id: string;
  subject: string; description: string | null; status: string; created_at: number;
}): number {
  const info = db.prepare(`INSERT INTO tickets
    (guild_id, number, user_id, channel_id, subject, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.guild_id, data.number, data.user_id, data.channel_id, data.subject, data.description, data.status, data.created_at);
  return Number(info.lastInsertRowid);
}
export function getTicket(id: number): TicketRow | undefined {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined;
}
export function getTicketByChannel(channelId: string): TicketRow | undefined {
  return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) as TicketRow | undefined;
}
export function getUserOpenTickets(guildId: string, userId: string): TicketRow[] {
  return db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open'").all(guildId, userId) as TicketRow[];
}
export function closeTicket(id: number, closedBy: string): void {
  db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE id = ?").run(Date.now(), closedBy, id);
}
export function reopenTicket(id: number): void {
  db.prepare("UPDATE tickets SET status = 'open', closed_at = NULL, closed_by = NULL WHERE id = ?").run(id);
}
export function listTickets(guildId: string, limit = 100): TicketRow[] {
  return db.prepare('SELECT * FROM tickets WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit) as TicketRow[];
}

// ===== Suggestions =====
export interface SuggestionRow {
  id: number; guild_id: string; user_id: string; message_id: string; channel_id: string;
  title: string; description: string; status: string;
  created_at: number; decided_at: number | null; decided_by: string | null;
}
export function createSuggestion(data: {
  guild_id: string; user_id: string; message_id: string; channel_id: string;
  title: string; description: string; status: string; created_at: number;
}): number {
  const info = db.prepare(`INSERT INTO suggestions
    (guild_id, user_id, message_id, channel_id, title, description, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.guild_id, data.user_id, data.message_id, data.channel_id, data.title, data.description, data.status, data.created_at);
  return Number(info.lastInsertRowid);
}
export function getSuggestion(id: number): SuggestionRow | undefined {
  return db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as SuggestionRow | undefined;
}
export function getSuggestionByMessage(messageId: string): SuggestionRow | undefined {
  return db.prepare('SELECT * FROM suggestions WHERE message_id = ?').get(messageId) as SuggestionRow | undefined;
}
export function decideSuggestion(id: number, status: 'approved' | 'rejected', decidedBy: string): void {
  db.prepare('UPDATE suggestions SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?')
    .run(status, Date.now(), decidedBy, id);
}
export function listSuggestions(guildId: string, limit = 100): SuggestionRow[] {
  return db.prepare('SELECT * FROM suggestions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit) as SuggestionRow[];
}
export function addSuggestionVote(suggestionId: number, userId: string, vote: number): void {
  db.prepare(`INSERT INTO suggestion_votes (suggestion_id, user_id, vote, created_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(suggestion_id, user_id) DO UPDATE SET vote = excluded.vote`)
    .run(suggestionId, userId, vote, Date.now());
}
export function getUserSuggestionVote(suggestionId: number, userId: string): number | null {
  const row = db.prepare('SELECT vote FROM suggestion_votes WHERE suggestion_id = ? AND user_id = ?').get(suggestionId, userId) as { vote: number } | undefined;
  return row?.vote ?? null;
}
export function getSuggestionVotes(suggestionId: number): { up: number; down: number } {
  const up = (db.prepare('SELECT COUNT(*) as c FROM suggestion_votes WHERE suggestion_id = ? AND vote = 1').get(suggestionId) as { c: number }).c;
  const down = (db.prepare('SELECT COUNT(*) as c FROM suggestion_votes WHERE suggestion_id = ? AND vote = -1').get(suggestionId) as { c: number }).c;
  return { up, down };
}

// ===== Moderation Events =====
export interface ModerationEvent {
  id: number; event_id: string | null; guild_id: string; action: string;
  target_id: string; moderator_id: string | null; reason: string | null;
  extra_details: string | null; duration_ms: number | null;
  source: string; actor_confidence: string; created_at: number;
}
export function logModerationEventFull(data: {
  event_id?: string | null; guild_id: string; action: string; target_id: string;
  moderator_id: string | null; reason: string | null; extra_details: string | null;
  duration_ms: number | null; source: string; actor_confidence: string;
}): number {
  const info = db.prepare(`INSERT OR IGNORE INTO moderation_events
    (event_id, guild_id, action, target_id, moderator_id, reason, extra_details, duration_ms, source, actor_confidence, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      data.event_id ?? null, data.guild_id, data.action, data.target_id,
      data.moderator_id, data.reason, data.extra_details, data.duration_ms,
      data.source, data.actor_confidence, Date.now()
    );
  return Number(info.lastInsertRowid);
}
export function getModerationEvents(guildId: string, limit = 100): ModerationEvent[] {
  return db.prepare('SELECT * FROM moderation_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit) as ModerationEvent[];
}
export function getModerationEventByEventId(eventId: string): ModerationEvent | undefined {
  return db.prepare('SELECT * FROM moderation_events WHERE event_id = ?').get(eventId) as ModerationEvent | undefined;
}

// ===== Nuke Events =====
export interface NukeEvent {
  id: number; guild_id: string; event_type: string; executor_id: string | null;
  target_id: string | null; details: string | null; severity: string;
  action_taken: string | null; created_at: number;
}
export function logNukeEvent(data: {
  guild_id: string; event_type: string; executor_id: string | null;
  target_id: string | null; details: string | null; severity: string; action_taken: string | null;
}): number {
  const info = db.prepare(`INSERT INTO nuke_events
    (guild_id, event_type, executor_id, target_id, details, severity, action_taken, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.guild_id, data.event_type, data.executor_id, data.target_id, data.details, data.severity, data.action_taken, Date.now());
  return Number(info.lastInsertRowid);
}
export function getNukeEvents(guildId: string, limit = 100): NukeEvent[] {
  return db.prepare('SELECT * FROM nuke_events WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit) as NukeEvent[];
}
export function countRecentNukeEvents(guildId: string, eventType: string, windowMs: number): number {
  const since = Date.now() - windowMs;
  return (db.prepare('SELECT COUNT(*) as c FROM nuke_events WHERE guild_id = ? AND event_type = ? AND created_at >= ?')
    .get(guildId, eventType, since) as { c: number }).c;
}

// ===== Spam Sessions =====
export interface SpamSessionRow {
  id: number; guild_id: string; user_id: string; violation_type: string;
  detected_at: number; window_start: number; window_ms: number;
  message_count: number; channels_json: string;
  punishment: string | null; punished_at: number | null;
  deleted_count: number; failed_count: number; status: string;
  details: string | null; created_at: number;
}
export function createSpamSession(data: {
  guild_id: string; user_id: string; violation_type: string;
  detected_at: number; window_start: number; window_ms: number;
  message_count: number; channels: string[]; punishment: string | null; details: string | null;
}): number {
  const info = db.prepare(`INSERT INTO spam_sessions
    (guild_id, user_id, violation_type, detected_at, window_start, window_ms,
     message_count, channels_json, punishment, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      data.guild_id, data.user_id, data.violation_type, data.detected_at,
      data.window_start, data.window_ms, data.message_count,
      JSON.stringify(data.channels), data.punishment, data.details, Date.now()
    );
  return Number(info.lastInsertRowid);
}
export function updateSpamSession(id: number, patch: Partial<SpamSessionRow>): void {
  const c = db.prepare('SELECT * FROM spam_sessions WHERE id = ?').get(id) as SpamSessionRow | undefined;
  if (!c) return;
  db.prepare(`UPDATE spam_sessions SET
    punishment=?, punished_at=?, deleted_count=?, failed_count=?, status=?, details=?
    WHERE id=?`)
    .run(
      patch.punishment ?? c.punishment, patch.punished_at ?? c.punished_at,
      patch.deleted_count ?? c.deleted_count, patch.failed_count ?? c.failed_count,
      patch.status ?? c.status, patch.details ?? c.details, id
    );
}
export function addSpamSessionMessage(sessionId: number, messageId: string, channelId: string, timestamp: number): void {
  db.prepare(`INSERT INTO spam_session_messages (session_id, message_id, channel_id, timestamp)
    VALUES (?, ?, ?, ?)`).run(sessionId, messageId, channelId, timestamp);
}
export function markSpamMessageDeleted(id: number, deleted: boolean, error: string | null): void {
  db.prepare('UPDATE spam_session_messages SET deleted = ?, delete_error = ? WHERE id = ?')
    .run(deleted ? 1 : 0, error, id);
}
export function getSpamSessionMessages(sessionId: number): { id: number; message_id: string; channel_id: string; deleted: number; delete_error: string | null }[] {
  return db.prepare('SELECT id, message_id, channel_id, deleted, delete_error FROM spam_session_messages WHERE session_id = ?')
    .all(sessionId) as any[];
}
export function listSpamSessions(guildId: string, limit = 100): SpamSessionRow[] {
  return db.prepare('SELECT * FROM spam_sessions WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?').all(guildId, limit) as SpamSessionRow[];
}
export function getSpamSession(id: number): SpamSessionRow | undefined {
  return db.prepare('SELECT * FROM spam_sessions WHERE id = ?').get(id) as SpamSessionRow | undefined;
}

// ===== Components V2 Jobs =====
export interface Cv2JobRow {
  id: number; guild_id: string; panel_type: string; channel_id: string;
  message_id: string; status: string; error: string | null;
  backup_json: string | null; converted_at: number | null; created_at: number;
}
export function upsertCv2Job(data: {
  guild_id: string; panel_type: string; channel_id: string; message_id: string;
  status: string; error?: string | null; backup_json?: string | null;
}): number {
  const existing = db.prepare('SELECT id FROM componentsv2_jobs WHERE message_id = ?').get(data.message_id) as { id: number } | undefined;
  if (existing) {
    db.prepare(`UPDATE componentsv2_jobs SET status=?, error=?, backup_json=?, converted_at=? WHERE id=?`)
      .run(data.status, data.error ?? null, data.backup_json ?? null, data.status === 'converted' ? Date.now() : null, existing.id);
    return existing.id;
  }
  const info = db.prepare(`INSERT INTO componentsv2_jobs
    (guild_id, panel_type, channel_id, message_id, status, error, backup_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(data.guild_id, data.panel_type, data.channel_id, data.message_id, data.status, data.error ?? null, data.backup_json ?? null, Date.now());
  return Number(info.lastInsertRowid);
}
export function getCv2Job(messageId: string): Cv2JobRow | undefined {
  return db.prepare('SELECT * FROM componentsv2_jobs WHERE message_id = ?').get(messageId) as Cv2JobRow | undefined;
}
export function listCv2Jobs(guildId: string, status?: string): Cv2JobRow[] {
  if (status) {
    return db.prepare('SELECT * FROM componentsv2_jobs WHERE guild_id = ? AND status = ? ORDER BY created_at DESC').all(guildId, status) as Cv2JobRow[];
  }
  return db.prepare('SELECT * FROM componentsv2_jobs WHERE guild_id = ? ORDER BY created_at DESC').all(guildId) as Cv2JobRow[];
}

export function closeDatabase(): void { db.close(); }
export default db;