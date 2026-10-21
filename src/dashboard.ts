import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import path from 'node:path';
import { config } from './config.js';
import {
  getSetting, setSetting, getRecentActivity, getWelcomePhrases,
  getWelcomePhrasesDetailed, addWelcomePhrase, deleteWelcomePhrase,
  getSelfRoles, addSelfRole, removeSelfRole, updateSelfRole,
  getWelcomeButtons, upsertWelcomeButton, getModerationLog,
  getAllSettings, getActiveMovieSession, getRecentMovieSessions,
  getMovieStats, getMovieRecipients, getAllMovieRatings, getMovieSession,
  mbSaveDraft, mbUpdateDraft, mbDeleteDraft, mbGetDrafts, mbGetDraft,
  mbLogSend, mbGetHistory,
  getSpamTrapConfig, setSpamTrapConfig, getSpamTrapLog,
  getMediaChannels, getMediaChannel, addMediaChannel, updateMediaChannel,
  removeMediaChannel, getUserMediaPosts, getMediaPostById,
  listTickets, listSuggestions, getSuggestionVotes,
  getModerationEvents, getNukeEvents,
  listSpamSessions, getSpamSession, getSpamSessionMessages,
  getTotalMediaFilesSize, countMediaFiles, countMediaPosts,
  countArchivedMedia, countDiskMedia,
  default as db,
} from './database.js';
import { getTextsByPrefix } from './texts.js';
import {
  getAllEmojis, getEmojiRow, setEmoji, resetEmoji, resetAllEmojis,
  isValidEmojiFormat, DEFAULT_EMOJIS, seedEmojiDefaults,
  getAllEmojisResolved, resolveStoredEmojiValue, validateEmojiInput,
  listReplacements, upsertReplacement, deleteReplacement, toggleReplacement,
} from './emojiRegistry.js';
import { runEmojiScan, invalidateScanCache } from './emojiScanner.js';
import {
  listAllTexts, listCategories, setText, resetText,
  listAllColors, setColor, resetColor, getRegistryDiagnostics,
} from './textRegistry.js';
import { sendViaBot, validatePayload, type BuilderPayload } from './messageBuilder.js';
import { saveConfig as saveNukeConfig, runAntiNukeSimulation } from './antiNuke.js';
import { updateSelfRoleFull, publishRolePanel } from './selfRoles.js';
import { getStorageUsage } from './mediaStorage.js';
import { invalidateMediaEmojiCache } from './mediaShow.js';

const app = express();
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '200kb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// ============================================================
// Turso Session Store — Lazy Init
// ============================================================
// ⚠️ التهيئة تؤجَّل حتى أول عملية فعلية (get/set/destroy/touch)
// لأن dashboard.ts يُحمَّل قبل أن يكتمل initDatabase() في index.ts.
// ============================================================
class TursoSessionStore extends session.Store {
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private ensureReady(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        await db.executeMultiple(`
          CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            sess TEXT NOT NULL,
            expired INTEGER NOT NULL
          );
          CREATE INDEX IF NOT EXISTS idx_sessions_expired ON sessions(expired);
        `);
        this.initialized = true;
      } catch (e) {
        console.error('[Blade X] ❌ Session store init failed (will retry):', e);
        this.initPromise = null;
        throw e;
      }
    })();
    return this.initPromise;
  }

  constructor() {
    super();
    // Lazy cleanup — يتجاهل بصمت إن لم تُهيَّأ القاعدة بعد
    setInterval(() => {
      void (async () => {
        if (!this.initialized) return;
        try {
          await db.execute({ sql: 'DELETE FROM sessions WHERE expired < ?', args: [Date.now()] });
        } catch (e) {
          console.error('[Blade X] ❌ Session cleanup failed:', e);
        }
      })();
    }, 60 * 60 * 1000);
  }

  get(sid: string, cb: (err: any, session?: any) => void): void {
    void (async () => {
      try {
        await this.ensureReady();
        const r = await db.execute({ sql: 'SELECT sess FROM sessions WHERE sid = ? AND expired > ?', args: [sid, Date.now()] });
        const row = r.rows[0];
        if (!row) { cb(null, null); return; }
        cb(null, JSON.parse(String(row.sess)));
      } catch (e) { cb(e); }
    })();
  }

  set(sid: string, sessionData: any, cb?: (err?: any) => void): void {
    void (async () => {
      try {
        await this.ensureReady();
        const expired = sessionData.cookie?.expires
          ? new Date(sessionData.cookie.expires).getTime()
          : Date.now() + 30 * 86_400_000;
        await db.execute({ sql: 'INSERT OR REPLACE INTO sessions (sid, sess, expired) VALUES (?, ?, ?)', args: [sid, JSON.stringify(sessionData), expired] });
        cb?.();
      } catch (e) { cb?.(e); }
    })();
  }

  destroy(sid: string, cb?: (err?: any) => void): void {
    void (async () => {
      try {
        await this.ensureReady();
        await db.execute({ sql: 'DELETE FROM sessions WHERE sid = ?', args: [sid] });
        cb?.();
      } catch (e) { cb?.(e); }
    })();
  }

  touch(sid: string, sessionData: any, cb?: () => void): void {
    void (async () => {
      try {
        await this.ensureReady();
        const expired = sessionData.cookie?.expires
          ? new Date(sessionData.cookie.expires).getTime()
          : Date.now() + 30 * 86_400_000;
        await db.execute({ sql: 'UPDATE sessions SET expired = ? WHERE sid = ?', args: [expired, sid] });
        cb?.();
      } catch { cb?.(); }
    })();
  }
}

const isHttps = config.dashboard.baseUrl.startsWith('https');

app.use(
  session({
    secret: config.dashboard.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: new TursoSessionStore(),
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: 30 * 86_400_000,
    },
  })
);

app.use(express.static(path.resolve('public')));
app.use('/assets', express.static(path.resolve('assets')));

// ============================================================
// Text registry cache
// ============================================================
interface RegistryCacheEntry { payload: any; expiresAt: number; }
let registryCache: RegistryCacheEntry | null = null;
const REGISTRY_CACHE_MS = 5_000;

function getRegistryPayloadCached(): any {
  const now = Date.now();
  if (registryCache && now < registryCache.expiresAt) return registryCache.payload;
  const texts = listAllTexts();
  const categories = listCategories();
  const colors = listAllColors();
  const diagnostics = getRegistryDiagnostics();
  const payload = { ok: true, texts, categories, colors, diagnostics };
  registryCache = { payload, expiresAt: now + REGISTRY_CACHE_MS };
  return payload;
}

function invalidateRegistryCache(): void { registryCache = null; }

// ============================================================
// Diagnostics
// ============================================================
app.get('/api/diag/texts', (req: Request, res: Response) => {
  try {
    const payload = getRegistryPayloadCached();
    console.log(`[Blade X] 🔍 DIAG /api/diag/texts → ${payload.texts.length} texts, ${payload.colors.length} colors`);
    res.json({
      ok: true,
      counts: { texts: payload.texts.length, categories: payload.categories.length, colors: payload.colors.length },
      diagnostics: payload.diagnostics,
      firstFiveTexts: payload.texts.slice(0, 5).map((t: any) => ({ key: t.key, defaultValue: t.defaultValue })),
      firstThreeColors: payload.colors.slice(0, 3).map((c: any) => ({ key: c.key, currentValue: c.currentValue })),
      session: { hasUser: !!(req.session as any)?.user, username: (req.session as any)?.user?.username ?? null },
    });
  } catch (e: any) {
    console.error('[Blade X] ❌ DIAG /api/diag/texts:', e);
    res.status(500).json({ ok: false, error: e?.message ?? 'unknown' });
  }
});

app.get('/api/discord/members', requireAuth, async (req: Request, res: Response) => {
  const query = String(req.query.q || '').trim();
  if (!query) { res.json([]); return; }
  
  const client = (globalThis as any).__bladeClient;
  if (!client || !client.isReady()) { res.json([]); return; }
  
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { res.json([]); return; }
  
  try {
    const members = await guild.members.fetch({ query, limit: 25 });
    const results = members.map((m: any) => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName || m.user.username,
      avatar: m.user.displayAvatarURL({ size: 64, extension: 'png' })
    }));
    res.json(results);
  } catch (e) {
    console.error('[Blade X] ❌ member search:', e);
    res.json([]);
  }
});

app.get('/api/diag/routes', (_req: Request, res: Response) => {
  const routes: { method: string; path: string }[] = [];
  const stack = (app as any)._router?.stack ?? [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods ?? {})) {
        routes.push({ method: method.toUpperCase(), path: layer.route.path });
      }
    }
  }
  res.json({ ok: true, count: routes.length, routes });
});

// ============================================================
// OAuth2
// ============================================================
app.get('/auth/login', (req: Request, res: Response) => {
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  (req.session as any).oauthState = state;
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.dashboard.redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const returnedState = req.query.state as string | undefined;
  const expectedState = (req.session as any).oauthState;

  if (!code) { res.status(400).send('Missing code'); return; }
  if (!returnedState || returnedState !== expectedState) { res.status(403).send('Invalid OAuth state'); return; }
  delete (req.session as any).oauthState;

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.dashboard.redirectUri,
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) { res.status(401).send('OAuth failed'); return; }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = (await userRes.json()) as { id: string; username: string; avatar?: string };

    const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const guilds = (await guildsRes.json()) as { id: string; permissions: string }[];

    const targetGuild = guilds.find((g) => g.id === config.guildId);
    if (!targetGuild) { res.status(403).send('You are not a member of the target guild.'); return; }

    const perms = BigInt(targetGuild.permissions);
    if (!(perms & 8n)) { res.status(403).send('You need Administrator permission.'); return; }

    (req.session as any).user = { id: user.id, username: user.username, avatar: user.avatar };
    (req.session as any).loggedInAt = Date.now();
    res.redirect('/');
  } catch (err) {
    console.error('[Blade X] ❌ OAuth error:', err);
    res.status(500).send('Internal error');
  }
});

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!(req.session as any).user) { res.status(401).json({ error: 'Unauthorized' }); return; }
  next();
}

app.get('/api/me', requireAuth, (req: Request, res: Response) => {
  const u = (req.session as any).user;
  const loggedInAt = (req.session as any).loggedInAt;
  const cookie = (req.session as any).cookie;
  res.json({ ...u, loggedInAt, expiresAt: cookie?.expires ? new Date(cookie.expires).getTime() : null });
});

app.post('/auth/logout', (req: Request, res: Response) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ===== Settings =====
app.get('/api/settings', requireAuth, (_req: Request, res: Response) => { res.json(getAllSettings()); });
app.get('/api/settings/:key', requireAuth, (req: Request, res: Response) => {
  res.json({ key: String(req.params.key), value: getSetting(String(req.params.key)) });
});
app.post('/api/settings/:key', requireAuth, async (req: Request, res: Response) => {
  const key = String(req.params.key);
  const { value } = req.body as { value?: unknown };
  if (typeof value !== 'string') { res.status(400).json({ error: 'value must be string' }); return; }
  try { await setSetting(key, value); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/settings', requireAuth, async (req: Request, res: Response) => {
  const { values } = req.body as { values?: Record<string, string> };
  if (!values || typeof values !== 'object') { res.status(400).json({ error: 'values object required' }); return; }
  let count = 0;
  try {
    for (const [k, v] of Object.entries(values)) { if (typeof v === 'string') { await setSetting(k, v); count++; } }
    res.json({ ok: true, count });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed', count }); }
});

// ===== Stats =====
app.get('/api/stats', requireAuth, async (_req: Request, res: Response) => {
  try {
    const client = (globalThis as any).__bladeClient;
    const guild = client?.guilds?.cache?.get(config.guildId);
    const [phrases, selfRoles, buttons, mediaChannels, recentActivity, activeSession] = await Promise.all([
      getWelcomePhrases(),
      getSelfRoles(),
      getWelcomeButtons(),
      getMediaChannels(),
      getRecentActivity(15),
      getActiveMovieSession(),
    ]);
    let activeMovie: any = null;
    if (activeSession) {
      const st = await getMovieStats(activeSession.id);
      activeMovie = { id: activeSession.id, movie: activeSession.movie_name, status: activeSession.status, startedAt: activeSession.started_at, ratings: st.count, average: st.average };
    }
    res.json({
      botOnline: !!client?.isReady?.(),
      guildName: guild?.name ?? null,
      guildId: config.guildId,
      memberCount: guild?.memberCount ?? null,
      channelCount: guild?.channels?.cache?.size ?? null,
      roleCount: guild?.roles?.cache?.size ?? null,
      welcomeEnabled: getSetting('welcome_enabled') !== 'false',
      welcomeChannel: getSetting('welcome_channel_id'),
      phrasesCount: phrases.length,
      selfRolesCount: selfRoles.length,
      buttonsCount: buttons.length,
      mediaChannelsCount: mediaChannels.length,
      recentActivity,
      activeMovie,
    });
  } catch (e: any) {
    console.error('[Blade X] ❌ /api/stats:', e);
    res.status(500).json({ error: e?.message ?? 'stats failed' });
  }
});

app.get('/api/server-stats', requireAuth, async (_req: Request, res: Response) => {
  const client = (globalThis as any).__bladeClient;
  if (!client || !client.isReady()) { res.json({ available: false, reason: 'Bot is not ready' }); return; }
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { res.json({ available: false, reason: 'Guild not found' }); return; }
  try {
    const members = guild.members.cache;
    const humans = members.filter((m: any) => !m.user.bot).size;
    const bots = members.filter((m: any) => m.user.bot).size;
    const channels = guild.channels.cache;
    const textChannels = channels.filter((c: any) => c.type === 0).size;
    const voiceChannels = channels.filter((c: any) => c.type === 2).size;
    const categories = channels.filter((c: any) => c.type === 4).size;
    const threads = channels.filter((c: any) => c.isThread?.()).size;
    let inVoice = 0;
    for (const ch of guild.channels.cache.values()) {
      if (ch.type === 2 || ch.type === 13) inVoice += ch.members?.size ?? 0;
    }
    const uptimeMs = client.uptime ?? 0;
    const uptimeH = Math.floor(uptimeMs / 3_600_000);
    const uptimeM = Math.floor((uptimeMs % 3_600_000) / 60_000);
    res.json({
      available: true,
      guild: { name: guild.name, id: guild.id, icon: guild.iconURL({ size: 128 }), ownerId: guild.ownerId, created: guild.createdTimestamp, botJoined: guild.members.me?.joinedTimestamp ?? null, boosts: guild.premiumSubscriptionCount ?? 0, boostTier: guild.premiumTier, preferredLocale: guild.preferredLocale },
      counts: { members: guild.memberCount, humans, bots, inVoice, channels: channels.size, textChannels, voiceChannels, categories, threads, roles: guild.roles.cache.size, emojis: guild.emojis.cache.size, stickers: guild.stickers.cache.size },
      bot: { online: client.isReady(), uptimeMs, uptimeText: `${uptimeH}h ${uptimeM}m`, ping: client.ws.ping },
    });
  } catch (e) { console.error('[Blade X] ❌ server-stats:', e); res.status(500).json({ available: false, reason: 'Failed' }); }
});

// ===== Activity / Moderation =====
app.get('/api/activity', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getRecentActivity(150)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/moderation', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getModerationLog(150)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// ===== Welcome =====
app.get('/api/welcome/phrases', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getWelcomePhrasesDetailed()); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/welcome/phrases', requireAuth, async (req: Request, res: Response) => {
  const { text } = req.body as { text?: string };
  if (!text || typeof text !== 'string') { res.status(400).json({ error: 'text required' }); return; }
  try { await addWelcomePhrase(text.slice(0, 500)); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.delete('/api/welcome/phrases/:id', requireAuth, async (req: Request, res: Response) => {
  try { await deleteWelcomePhrase(Number(req.params.id)); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

app.get('/api/welcome/buttons', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getWelcomeButtons()); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/welcome/buttons/:id', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const body = req.body as Partial<{ label: string; emoji_id: string | null; url: string | null; style: string; enabled: number }>;
  try {
    const buttons = await getWelcomeButtons();
    const current = buttons.find((b) => b.button_id === id);
    if (!current) { res.status(404).json({ error: 'button not found' }); return; }
    await upsertWelcomeButton({
      button_id: id,
      label: body.label ?? current.label,
      emoji_id: body.emoji_id !== undefined ? body.emoji_id : current.emoji_id,
      url: body.url !== undefined ? body.url : current.url,
      style: body.style ?? current.style,
      enabled: body.enabled ?? current.enabled,
    });
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

app.get('/api/welcome/preview', requireAuth, async (_req: Request, res: Response) => {
  const client = (globalThis as any).__bladeClient;
  if (!client) { res.status(500).json({ error: 'client not ready' }); return; }
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { res.status(500).json({ error: 'guild not found' }); return; }
  try {
    const me = await guild.members.fetch(client.user.id);
    const { generateWelcomeImage } = await import('./welcome.js');
    const att = await generateWelcomeImage(me);
    if (!att) { res.status(500).json({ error: 'image generation failed' }); return; }
    const buf = (att as any).attachment as Buffer;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    res.send(buf);
  } catch (err) { console.error('[Blade X] ❌ preview error:', err); res.status(500).json({ error: 'preview failed' }); }
});

// ===== Self Roles =====
app.get('/api/selfroles', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getSelfRoles()); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/selfroles', requireAuth, async (req: Request, res: Response) => {
  const { role_id, label, emoji_id, description } = req.body as { role_id?: string; label?: string; emoji_id?: string | null; description?: string | null };
  if (!role_id || !label) { res.status(400).json({ error: 'role_id and label required' }); return; }
  try { await addSelfRole(role_id, label, emoji_id ?? null, description ?? null); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.put('/api/selfroles/:id', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const patch = req.body as Partial<{ role_id: string; label: string; emoji_id: string | null; description: string | null; sort_order: number; enabled: number }>;
  try {
    const result = await updateSelfRoleFull(id, patch as any);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    res.json({ ok: true, row: result.row });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.delete('/api/selfroles/:id', requireAuth, async (req: Request, res: Response) => {
  try { await removeSelfRole(Number(req.params.id)); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/selfroles/reorder', requireAuth, async (req: Request, res: Response) => {
  const { order } = req.body as { order?: { id: number; sort_order: number }[] };
  if (!Array.isArray(order)) { res.status(400).json({ error: 'order array required' }); return; }
  let count = 0;
  try {
    for (const item of order) {
      if (typeof item.id !== 'number' || typeof item.sort_order !== 'number') continue;
      if (!Number.isFinite(item.id) || !Number.isFinite(item.sort_order)) continue;
      await updateSelfRole(item.id, { sort_order: item.sort_order });
      count++;
    }
    res.json({ ok: true, count });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed', count }); }
});
app.post('/api/selfroles/publish', requireAuth, async (_req: Request, res: Response) => {
  const client = (globalThis as any).__bladeClient;
  if (!client) { res.status(500).json({ error: 'client not ready' }); return; }
  try { const ok = await publishRolePanel(client); res.json({ ok }); }
  catch (e: any) { console.error('[Blade X] ❌ publishRolePanel:', e); res.status(500).json({ ok: false, error: e?.message ?? 'failed' }); }
});

// ============================================================
// Text Customizer API
// ============================================================
app.get('/api/texts/registry', requireAuth, (_req: Request, res: Response) => {
  try {
    const cacheHit = !!(registryCache && Date.now() < registryCache.expiresAt);
    const payload = getRegistryPayloadCached();
    if (!cacheHit) {
      console.log(`[Blade X] ✅ /api/texts/registry → ${payload.texts.length} texts, ${payload.categories.length} categories, ${payload.colors.length} colors`);
    }
    res.json(payload);
  } catch (e: any) { console.error('[Blade X] ❌ /api/texts/registry:', e); res.status(500).json({ error: e?.message ?? 'failed', ok: false }); }
});
app.post('/api/texts/registry/save', requireAuth, async (req: Request, res: Response) => {
  const { key, value } = req.body as { key?: string; value?: string };
  if (!key || typeof value !== 'string') { res.status(400).json({ error: 'key and value required' }); return; }
  const user = (req.session as any)?.user?.username ?? 'dashboard';
  try {
    const result = await setText(key, value, user);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    invalidateRegistryCache();
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/texts/registry/reset', requireAuth, async (req: Request, res: Response) => {
  const { key } = req.body as { key?: string };
  if (!key) { res.status(400).json({ error: 'key required' }); return; }
  try { await resetText(key); invalidateRegistryCache(); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/texts/registry/color', requireAuth, async (req: Request, res: Response) => {
  const { key, value } = req.body as { key?: string; value?: string };
  if (!key || typeof value !== 'string') { res.status(400).json({ error: 'key and value required' }); return; }
  const user = (req.session as any)?.user?.username ?? 'dashboard';
  try {
    const result = await setColor(key, value, user);
    if (!result.ok) { res.status(400).json({ error: result.error }); return; }
    invalidateRegistryCache();
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/texts/registry/color/reset', requireAuth, async (req: Request, res: Response) => {
  const { key } = req.body as { key?: string };
  if (!key) { res.status(400).json({ error: 'key required' }); return; }
  try { await resetColor(key); invalidateRegistryCache(); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/texts', requireAuth, (_req: Request, res: Response) => { res.json(getAllSettings()); });
app.post('/api/texts', requireAuth, async (req: Request, res: Response) => {
  const { values } = req.body as { values?: Record<string, string> };
  if (!values || typeof values !== 'object') { res.status(400).json({ error: 'values object required' }); return; }
  let count = 0;
  try {
    for (const [k, v] of Object.entries(values)) { if (typeof v === 'string') { await setSetting(k, v); count++; } }
    res.json({ ok: true, count });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed', count }); }
});
app.get('/api/texts/:prefix', requireAuth, (req: Request, res: Response) => {
  const prefix = String(req.params.prefix);
  const RESERVED = new Set(['registry', 'save', 'reset', 'color']);
  if (RESERVED.has(prefix)) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(getTextsByPrefix(prefix));
});
app.post('/api/settings/reset', requireAuth, async (req: Request, res: Response) => {
  const { keys } = req.body as { keys?: string[] };
  if (!Array.isArray(keys)) { res.status(400).json({ error: 'keys array required' }); return; }
  let count = 0;
  try {
    for (const k of keys) {
      const def = (config.defaultTexts as Record<string, string>)[k];
      if (def !== undefined) { await setSetting(k, def); count++; }
    }
    res.json({ ok: true, count });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed', count }); }
});

// ===== Movie Night =====
app.get('/api/movie/status', requireAuth, async (_req: Request, res: Response) => {
  try {
    const active = await getActiveMovieSession();
    const recent = await getRecentMovieSessions(15);
    if (!active) { res.json({ active: null, recent }); return; }
    const [stats, recipients, ratings] = await Promise.all([
      getMovieStats(active.id),
      getMovieRecipients(active.id),
      getAllMovieRatings(active.id),
    ]);
    res.json({ active: { ...active, stats, recipientsCount: recipients.length, recipients, ratings }, recent });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/movie/session/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const s = await getMovieSession(Number(req.params.id));
    if (!s) { res.status(404).json({ error: 'not found' }); return; }
    const [stats, recipients, ratings] = await Promise.all([
      getMovieStats(s.id),
      getMovieRecipients(s.id),
      getAllMovieRatings(s.id),
    ]);
    res.json({ ...s, stats, recipients, ratings });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/movie/start', requireAuth, async (req: Request, res: Response) => {
  const { movie } = req.body as { movie?: string };
  if (!movie || typeof movie !== 'string') { res.status(400).json({ error: 'movie required' }); return; }
  const client = (globalThis as any).__bladeClient;
  if (!client) { res.status(500).json({ error: 'client not available' }); return; }
  try {
    const { startMovieSession } = await import('./movieNight.js');
    const result = await startMovieSession(client, movie.trim(), 'dashboard');
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/movie/close', requireAuth, async (_req: Request, res: Response) => {
  try {
    const active = await getActiveMovieSession();
    if (!active) { res.status(404).json({ error: 'no active session' }); return; }
    const { closeMovieSession } = await import('./movieNight.js');
    await closeMovieSession(active.id);
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// ===== Discord data =====
app.get('/api/discord/channels', requireAuth, (_req: Request, res: Response) => {
  const client = (globalThis as any).__bladeClient;
  const guild = client?.guilds?.cache?.get(config.guildId);
  if (!guild) { res.json([]); return; }
  res.json(guild.channels.cache
    .map((c: any) => ({ id: c.id, name: c.name, type: c.type, parentId: c.parentId ?? null }))
    .sort((a: any, b: any) => a.type - b.type || a.name.localeCompare(b.name)));
});
app.get('/api/discord/roles', requireAuth, (_req: Request, res: Response) => {
  const client = (globalThis as any).__bladeClient;
  const guild = client?.guilds?.cache?.get(config.guildId);
  if (!guild) { res.json([]); return; }
  res.json(guild.roles.cache
    .filter((r: any) => r.id !== guild.id && !r.managed)
    .map((r: any) => ({ id: r.id, name: r.name, color: r.color, position: r.position }))
    .sort((a: any, b: any) => b.position - a.position));
});

// ===== Emoji Manager =====
app.get('/api/emojis', requireAuth, (_req: Request, res: Response) => { res.json(getAllEmojisResolved()); });
app.get('/api/emojis/defaults', requireAuth, (_req: Request, res: Response) => { res.json(DEFAULT_EMOJIS); });
app.get('/api/emojis/scan', requireAuth, async (req: Request, res: Response) => {
  try { const force = req.query.force === '1'; const report = await runEmojiScan(force); res.json(report); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'scan failed' }); }
});
app.post('/api/emojis/scan/refresh', requireAuth, async (_req: Request, res: Response) => {
  try { invalidateScanCache(); const report = await runEmojiScan(true); res.json(report); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'scan failed' }); }
});
app.get('/api/emojis/replacements', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await listReplacements()); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/emojis/replacements', requireAuth, async (req: Request, res: Response) => {
  const { original, replacement, scope, createdBy } = req.body as { original?: string; replacement?: string; scope?: string; createdBy?: string };
  if (!original || !replacement) { res.status(400).json({ error: 'original and replacement required' }); return; }
  const check = validateEmojiInput(replacement);
  if (!check.valid) { res.status(400).json({ error: check.reason ?? 'Invalid replacement emoji' }); return; }
  try {
    const id = await upsertReplacement({ original: original.trim(), replacement: replacement.trim(), scope: (scope ?? 'global').trim(), enabled: 1, createdBy: createdBy ?? (req.session as any)?.user?.username });
    res.json({ ok: true, id, resolved: resolveStoredEmojiValue(replacement) || replacement });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.delete('/api/emojis/replacements/:id', requireAuth, async (req: Request, res: Response) => {
  try { await deleteReplacement(Number(req.params.id)); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/emojis/replacements/:id/toggle', requireAuth, async (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  try { await toggleReplacement(Number(req.params.id), !!enabled); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/emojis/:key', requireAuth, async (req: Request, res: Response) => {
  const key = String(req.params.key);
  const { value } = req.body as { value?: string };
  if (typeof value !== 'string' || !value.trim()) { res.status(400).json({ error: 'value required' }); return; }
  const trimmed = value.trim();
  const check = validateEmojiInput(trimmed);
  if (!check.valid) { res.status(400).json({ error: check.reason ?? 'Invalid emoji format' }); return; }
  try { await setEmoji(key, trimmed); res.json({ ok: true, resolved: resolveStoredEmojiValue(trimmed) }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/emojis/:key/reset', requireAuth, async (req: Request, res: Response) => {
  const key = String(req.params.key);
  try { await resetEmoji(key); res.json({ ok: true, row: getEmojiRow(key) }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/emojis/reset-all', requireAuth, async (_req: Request, res: Response) => {
  try { await resetAllEmojis(); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/emojis/seed', requireAuth, async (_req: Request, res: Response) => {
  try { await seedEmojiDefaults(); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// ===== Message Builder =====
app.get('/api/builder/drafts', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await mbGetDrafts()); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/builder/drafts/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const row = await mbGetDraft(Number(req.params.id));
    if (!row) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...row, payload: JSON.parse(row.payload) });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/builder/drafts', requireAuth, async (req: Request, res: Response) => {
  const { name, payload } = req.body as { name?: string; payload?: BuilderPayload };
  if (!name || !payload) { res.status(400).json({ error: 'name and payload required' }); return; }
  const err = validatePayload(payload);
  if (err) { res.status(400).json({ error: err }); return; }
  try { const id = await mbSaveDraft(name, payload, (req.session as any).user.id); res.json({ ok: true, id }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.put('/api/builder/drafts/:id', requireAuth, async (req: Request, res: Response) => {
  const { name, payload } = req.body as { name?: string; payload?: BuilderPayload };
  if (!name || !payload) { res.status(400).json({ error: 'name and payload required' }); return; }
  const err = validatePayload(payload);
  if (err) { res.status(400).json({ error: err }); return; }
  try { await mbUpdateDraft(Number(req.params.id), name, payload); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.delete('/api/builder/drafts/:id', requireAuth, async (req: Request, res: Response) => {
  try { await mbDeleteDraft(Number(req.params.id)); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/builder/validate', requireAuth, (req: Request, res: Response) => {
  const { payload } = req.body as { payload?: BuilderPayload };
  if (!payload) { res.status(400).json({ error: 'payload required' }); return; }
  const err = validatePayload(payload);
  res.json({ ok: !err, error: err });
});
app.post('/api/builder/send', requireAuth, async (req: Request, res: Response) => {
  const { channelId, payload } = req.body as { channelId?: string; payload?: BuilderPayload };
  if (!channelId || !payload) { res.status(400).json({ error: 'channelId and payload required' }); return; }
  const client = (globalThis as any).__bladeClient;
  if (!client) { res.status(500).json({ error: 'client not available' }); return; }
  try {
    const result = await sendViaBot(client, channelId, payload);
    if (result.ok) await mbLogSend(result.channelId, result.messageId, payload, (req.session as any).user.id);
    res.json(result);
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/builder/history', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await mbGetHistory(50)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// ===== Spam Trap =====
app.get('/api/spamtrap', requireAuth, (_req: Request, res: Response) => { res.json(getSpamTrapConfig()); });
app.post('/api/spamtrap', requireAuth, async (req: Request, res: Response) => {
  try { await setSpamTrapConfig(req.body as Partial<ReturnType<typeof getSpamTrapConfig>>); res.json({ ok: true, config: getSpamTrapConfig() }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/spamtrap/log', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getSpamTrapLog(100)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// ===== Media Show =====
app.get('/api/media/defaults', requireAuth, (_req: Request, res: Response) => {
  res.json({
    title_format: '{user}', author_emoji: '', color: '#f59e0b', footer_from_label: 'Pumpkins from', footer_others_label: 'and {n} others',
    reaction_emoji: '🎃', comment_emoji: '💬', delete_emoji: '🗑️', viewall_emoji: '👥', share_emoji: '📤',
    share_title: 'مشاركة المنشور', share_hint: 'اختر المستلمين ثم اضغط تأكيد.', share_note: 'سيتم إرسال المنشور إلى المستلمين المحددين عبر رسالة خاصة.',
    share_select_placeholder: 'اختر مستلمًا أو أكثر...', share_confirm_label: 'تأكيد الإرسال', share_cancel_label: 'إلغاء',
    share_title_emoji: '📤', share_confirm_emoji: '✅', share_cancel_emoji: '❌', share_color: '#f59e0b',
    share_dm_title: '📤 تمت مشاركة منشور معك', share_success_msg: '✅ تم الإرسال', share_partial_msg: '⚠️ تعذّر إرسال رسالة خاصة إلى بعض المستلمين',
    share_none_msg: '⚠️ لم تختر مستلمين', button_open_post_emoji: '🎃', viewall_prev_label: '', viewall_prev_emoji: '◀️',
    viewall_next_label: '', viewall_next_emoji: '▶️', button_view_all_label: 'View All', button_open_post_label: 'افتح المنشور',
    thread_auto_create: 0, thread_name_format: 'Comments · {user}', allow_admin_edit: 1, allow_admin_delete: 1, ignore_bots: 1,
  });
});
app.get('/api/media/channels', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getMediaChannels()); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/media/channels', requireAuth, async (req: Request, res: Response) => {
  const { channelId } = req.body as { channelId?: string };
  if (!channelId || !/^\d{17,20}$/.test(channelId)) { res.status(400).json({ error: 'channelId required' }); return; }
  try { await addMediaChannel(channelId); res.json({ ok: true, channel: await getMediaChannel(channelId) }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.put('/api/media/channels/:id', requireAuth, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  try { await updateMediaChannel(id, req.body); invalidateMediaEmojiCache(); res.json({ ok: true, channel: await getMediaChannel(id) }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.delete('/api/media/channels/:id', requireAuth, async (req: Request, res: Response) => {
  try { await removeMediaChannel(String(req.params.id)); res.json({ ok: true }); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/media/posts/:authorId', requireAuth, async (req: Request, res: Response) => {
  try { res.json(await getUserMediaPosts(String(req.params.authorId), 100)); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/media/post/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const post = await getMediaPostById(Number(req.params.id));
    if (!post) { res.status(404).json({ error: 'not found' }); return; }
    res.json(post);
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// Archive channel status
app.get('/api/media/archive', requireAuth, async (_req: Request, res: Response) => {
  try {
    const channelId = getSetting('media_archive_channel_id');
    const client = (globalThis as any).__bladeClient;
    const guild = client?.guilds?.cache?.get(config.guildId);
    if (!guild) { res.json({ channelId, valid: false, reason: 'Guild not ready' }); return; }
    if (!channelId) { res.json({ channelId: null, valid: false, reason: 'Not configured' }); return; }
    const ch: any = guild.channels.cache.get(channelId);
    if (!ch) { res.json({ channelId, valid: false, reason: 'Channel not found' }); return; }
    if (!ch.isTextBased?.() || ch.isDMBased?.()) { res.json({ channelId, valid: false, reason: 'Not a text channel' }); return; }
    const me = guild.members.me;
    const perms = me ? ch.permissionsFor(me) : null;
    const permissions = { viewChannel: perms?.has('ViewChannel') ?? false, sendMessages: perms?.has('SendMessages') ?? false, attachFiles: perms?.has('AttachFiles') ?? false, readMessageHistory: perms?.has('ReadMessageHistory') ?? false };
    const valid = Object.values(permissions).every(Boolean);
    res.json({ channelId, valid, permissions, channelName: ch.name });
  } catch (e: any) { res.status(500).json({ valid: false, reason: e?.message ?? 'unknown' }); }
});

app.post('/api/media/archive', requireAuth, async (req: Request, res: Response) => {
  try {
    const { channelId } = req.body as { channelId?: string | null };
    if (channelId === null || channelId === undefined || channelId === '') { await setSetting('media_archive_channel_id', ''); res.json({ ok: true, channelId: null }); return; }
    if (!/^\d{17,20}$/.test(channelId)) { res.status(400).json({ error: 'Invalid channel id' }); return; }
    const client = (globalThis as any).__bladeClient;
    const guild = client?.guilds?.cache?.get(config.guildId);
    if (!guild) { res.status(500).json({ error: 'Guild not ready' }); return; }
    const ch: any = guild.channels.cache.get(channelId);
    if (!ch) { res.status(400).json({ error: 'Channel not found' }); return; }
    if (!ch.isTextBased?.() || ch.isDMBased?.()) { res.status(400).json({ error: 'Not a text channel' }); return; }
    const me = guild.members.me;
    const perms = me ? ch.permissionsFor(me) : null;
    const missing: string[] = [];
    if (!perms?.has('ViewChannel')) missing.push('ViewChannel');
    if (!perms?.has('SendMessages')) missing.push('SendMessages');
    if (!perms?.has('AttachFiles')) missing.push('AttachFiles');
    if (!perms?.has('ReadMessageHistory')) missing.push('ReadMessageHistory');
    if (missing.length > 0) { res.status(400).json({ error: `Bot lacks permissions: ${missing.join(', ')}` }); return; }
    await setSetting('media_archive_channel_id', channelId);
    res.json({ ok: true, channelId });
  } catch (e: any) { res.status(500).json({ ok: false, error: e?.message ?? 'unknown' }); }
});

app.get('/api/media/storage', requireAuth, async (_req: Request, res: Response) => {
  try {
    const disk = getStorageUsage();
    const [totalSize, diskFiles, archivedFiles, totalFiles, totalPosts] = await Promise.all([
      getTotalMediaFilesSize(),
      countDiskMedia(),
      countArchivedMedia(),
      countMediaFiles(),
      countMediaPosts(),
    ]);
    res.json({
      ok: true,
      disk: {
        bytes: totalSize,
        files: diskFiles,
        posts: disk.postCount,
        actualBytes: disk.totalBytes,
        actualFiles: disk.fileCount,
      },
      archive: { files: archivedFiles },
      total: { dbFiles: totalFiles, posts: totalPosts },
    });
  } catch (e: any) { res.status(500).json({ ok: false, error: e?.message ?? 'failed' }); }
});

// ===== Support =====
app.get('/api/support/settings', requireAuth, (_req: Request, res: Response) => {
  const keys = [
    'support_enabled', 'support_panel_channel', 'support_ticket_category', 'support_suggestions_channel', 'support_transcript_channel', 'support_admin_role',
    'support_max_open_per_user', 'support_title', 'support_description', 'support_color', 'support_select_placeholder', 'support_select_placeholder_emoji',
    'support_option_support_label', 'support_option_support_desc', 'support_option_support_emoji',
    'support_option_suggestion_label', 'support_option_suggestion_desc', 'support_option_suggestion_emoji',
    'support_ticket_title', 'support_ticket_close_label', 'support_ticket_close_emoji', 'support_ticket_dm_title', 'support_ticket_dm_desc',
    'support_suggestion_title', 'support_suggestion_approved', 'support_suggestion_rejected', 'support_transcript_title',
  ];
  const out: Record<string, string | null> = {};
  for (const k of keys) out[k] = getSetting(k);
  res.json(out);
});
app.get('/api/support/tickets', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await listTickets(config.guildId, 200)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/support/suggestions', requireAuth, async (_req: Request, res: Response) => {
  try {
    const list = await listSuggestions(config.guildId, 200);
    const withVotes = await Promise.all(list.map(async (s) => ({ ...s, votes: await getSuggestionVotes(s.id) })));
    res.json(withVotes);
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.post('/api/support/publish', requireAuth, async (_req: Request, res: Response) => {
  const client = (globalThis as any).__bladeClient;
  if (!client) { res.status(500).json({ error: 'client not ready' }); return; }
  try { const { publishSupportPanel } = await import('./support.js'); const result = await publishSupportPanel(client); res.json(result); }
  catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// ===== Moderation Events / Anti-Nuke =====
app.get('/api/moderation/events', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getModerationEvents(config.guildId, 200)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/antinuke/config', requireAuth, (_req: Request, res: Response) => {
  const raw = getSetting('antinuke_config');
  try { res.json(raw ? JSON.parse(raw) : {}); } catch { res.json({}); }
});
app.post('/api/antinuke/config', requireAuth, async (req: Request, res: Response) => {
  try { await saveNukeConfig(req.body); res.json({ ok: true }); }
  catch (e: any) { res.status(400).json({ error: e?.message ?? 'invalid' }); }
});
app.get('/api/antinuke/events', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await getNukeEvents(config.guildId, 200)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

let antiNukeTestRunning = false;
app.post('/api/antinuke/test', requireAuth, async (req: Request, res: Response) => {
  if (antiNukeTestRunning) { res.status(429).json({ ok: false, error: 'اختبار Anti-Nuke قيد التشغيل بالفعل. انتظر انتهاءه.' }); return; }
  const client = (globalThis as any).__bladeClient;
  if (!client || !client.isReady?.()) { res.status(500).json({ ok: false, error: 'البوت غير جاهز' }); return; }
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { res.status(500).json({ ok: false, error: 'السيرفر غير موجود' }); return; }
  antiNukeTestRunning = true;
  try {
    const user = (req.session as any)?.user?.username ?? 'dashboard';
    const report = await runAntiNukeSimulation(config.guildId, user);
    res.json({ ok: true, report });
  } catch (e: any) { console.error('[Blade X] ❌ Anti-Nuke test:', e); res.status(500).json({ ok: false, error: e?.message ?? 'unknown' }); }
  finally { antiNukeTestRunning = false; }
});

// ===== Spam Sessions =====
app.get('/api/spam/sessions', requireAuth, async (_req: Request, res: Response) => {
  try { res.json(await listSpamSessions(config.guildId, 100)); } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});
app.get('/api/spam/session/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const s = await getSpamSession(Number(req.params.id));
    if (!s) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ ...s, messages: await getSpamSessionMessages(s.id) });
  } catch (e: any) { res.status(500).json({ error: e?.message ?? 'failed' }); }
});

// ============================================================
// SPA fallback
// ============================================================
app.get(/^(?!\/api|\/auth).*/, (_req: Request, res: Response) => {
  res.sendFile(path.resolve('public/index.html'));
});

export function startDashboard(): void {
  app.listen(config.dashboard.port, () => {
    console.log(`[Blade X] ✅ Dashboard running at ${config.dashboard.baseUrl}`);
  });
}

export default app;