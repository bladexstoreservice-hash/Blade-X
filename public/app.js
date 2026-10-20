// ============================================================
// Blade X · Dashboard app.js
// Complete consolidated file.
// All functions listed in HTML onclick handlers are defined at
// top-level scope here. If any show "not defined", the file has
// a syntax error somewhere — check the browser Console for the
// exact line and fix it, don't just re-add the function.
// ============================================================

const $ = (id) => document.getElementById(id);
const contentArea = $('content-area');
const pageTitle = $('page-title');
const pageSubtitle = $('page-subtitle');
const statusPill = $('bot-status-pill');
const userChip = $('user-chip');
const userName = $('user-name');

let discordChannels = [];
let discordRoles = [];

// ============================================================
// Global error handlers
// ============================================================
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Blade X] Unhandled rejection:', event.reason);
  showGlobalError(`خطأ غير متوقع: ${event.reason?.message || event.reason}`);
});
window.addEventListener('error', (event) => {
  console.error('[Blade X] Uncaught error:', event.error || event.message);
  showGlobalError(`خطأ: ${event.message}`);
});

function showGlobalError(msg) {
  try {
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast error';
    el.textContent = `❌ ${msg}`;
    el.style.cursor = 'pointer';
    el.title = 'اضغط للإغلاق';
    el.onclick = () => el.remove();
    container.appendChild(el);
    setTimeout(() => el.remove(), 10000);
  } catch { /* ignore */ }
}

// ============================================================
// HTTP with timeout
// ============================================================
async function api(path, opts = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      ...opts,
    });
    if (res.status === 401) {
      window.location.href = '/auth/login';
      throw new Error('Unauthorized');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`انتهت مهلة الطلب: ${path} (15s)`);
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toast(msg, type = 'info') {
  const container = $('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = { success: '✅', error: '❌', info: 'ℹ️' }[type] || '';
  el.textContent = `${icon} ${msg}`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function confirmModal(title, body) {
  return new Promise((resolve) => {
    $('modal-title').textContent = title;
    $('modal-body').textContent = body;
    $('modal-overlay').classList.remove('hidden');
    const cleanup = () => {
      $('modal-overlay').classList.add('hidden');
      $('modal-confirm').onclick = null;
      $('modal-cancel').onclick = null;
    };
    $('modal-confirm').onclick = () => { cleanup(); resolve(true); };
    $('modal-cancel').onclick = () => { cleanup(); resolve(false); };
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatDate(ms) {
  if (!ms) return '—';
  return new Date(Number(ms)).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
}

function channelName(id) {
  if (!id) return 'غير مضبوط';
  const ch = discordChannels.find((c) => c.id === id);
  return ch ? `#${ch.name}` : id;
}

function roleName(id) {
  if (!id) return '—';
  const r = discordRoles.find((x) => x.id === id);
  return r ? r.name : id;
}

function channelSelect(id, settingKey, opts = {}) {
  const types = opts.types || null;
  let channels = discordChannels;
  if (types) channels = channels.filter((c) => types.includes(c.type));
  const options = channels.map((c) => `<option value="${c.id}" ${c.id === id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
  return `<select data-setting="${settingKey}"><option value="">— بدون —</option>${options}</select>`;
}

// ============================================================
// Loaders
// ============================================================
async function loadMe() {
  try {
    const me = await api('/api/me');
    if (userName) userName.textContent = me.username || 'Admin';
    if (userChip) {
      const avatar = userChip.querySelector('.avatar');
      if (avatar) avatar.textContent = (me.username || 'A')[0].toUpperCase();
    }
  } catch (e) { console.warn('[Blade X] /api/me failed:', e.message); }
}

async function loadDiscordData() {
  try {
    const [ch, ro] = await Promise.all([api('/api/discord/channels'), api('/api/discord/roles')]);
    discordChannels = Array.isArray(ch) ? ch : [];
    discordRoles = Array.isArray(ro) ? ro : [];
  } catch (e) {
    console.warn('[Blade X] Discord data load failed:', e.message);
    discordChannels = [];
    discordRoles = [];
  }
}

async function refreshStatus() {
  try {
    const s = await api('/api/stats');
    statusPill.classList.toggle('online', s.botOnline);
    statusPill.classList.toggle('offline', !s.botOnline);
    const label = statusPill.querySelector('span:last-child');
    if (label) label.textContent = s.botOnline ? `متصل · ${s.guildName || 'Guild'}` : 'غير متصل';
  } catch {
    statusPill.classList.add('offline');
    const label = statusPill.querySelector('span:last-child');
    if (label) label.textContent = 'خطأ في الاتصال';
  }
}

// ============================================================
// Overview
// ============================================================
async function pageOverview() {
  let s;
  try { s = await api('/api/stats'); }
  catch (e) {
    contentArea.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">❌ فشل تحميل الإحصاءات</div></div>
        <div class="panel-desc">${escapeHtml(e.message)}</div>
        <div class="btn-row"><button class="btn-primary" onclick="navigate('overview')">🔄 إعادة المحاولة</button></div>
      </div>`;
    return;
  }

  const serverStats = await api('/api/server-stats').catch((e) => ({ available: false, reason: e.message }));
  const activity = s.recentActivity || [];
  const movie = s.activeMovie;

  let serverCards = '';
  if (serverStats.available) {
    const c = serverStats.counts, g = serverStats.guild, b = serverStats.bot;
    serverCards = `
      <div class="grid">
        <div class="card"><div class="label">🌐 السيرفر</div><div class="value" style="font-size:18px">${escapeHtml(g.name)}</div><div class="sub">${escapeHtml(g.id)}</div></div>
        <div class="card"><div class="label">👥 الأعضاء</div><div class="value">${c.members}</div><div class="sub">${c.humans} بشر · ${c.bots} بوت</div></div>
        <div class="card"><div class="label">🎙️ في الصوت</div><div class="value">${c.inVoice}</div></div>
        <div class="card"><div class="label">📁 القنوات</div><div class="value">${c.channels}</div><div class="sub">${c.textChannels} نصية · ${c.voiceChannels} صوتية</div></div>
        <div class="card"><div class="label">🎭 الرولات</div><div class="value">${c.roles}</div></div>
        <div class="card"><div class="label">😀 الإيموجيات</div><div class="value">${c.emojis}</div></div>
        <div class="card"><div class="label">🚀 التعزيزات</div><div class="value">${g.boosts}</div><div class="sub">Level ${g.boostTier}</div></div>
        <div class="card"><div class="label">⏱️ Uptime</div><div class="value" style="font-size:18px">${b.uptimeText}</div></div>
        <div class="card"><div class="label">📡 Ping</div><div class="value">${b.ping}ms</div></div>
      </div>`;
  } else {
    serverCards = `<div class="panel"><div class="empty">⚠️ إحصائيات السيرفر غير متاحة: ${escapeHtml(serverStats.reason || 'unknown')}</div></div>`;
  }

  contentArea.innerHTML = `
    ${serverCards}
    <div class="grid">
      <div class="card"><div class="label">👋 الترحيب</div><div class="value">${s.welcomeEnabled ? 'مفعّل' : 'معطّل'}</div><div class="sub">${channelName(s.welcomeChannel)}</div></div>
      <div class="card"><div class="label">💬 عبارات الترحيب</div><div class="value">${s.phrasesCount}</div></div>
      <div class="card"><div class="label">🎭 Self Roles</div><div class="value">${s.selfRolesCount}</div></div>
      <div class="card"><div class="label">📸 Media Show</div><div class="value">${s.mediaChannelsCount ?? 0}</div><div class="sub">قنوات</div></div>
      <div class="card"><div class="label">🎬 Movie Night</div><div class="value">${movie ? movie.ratings : '—'}</div><div class="sub">${movie ? escapeHtml(movie.movie) : 'لا توجد جلسة'}</div></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📜 آخر الأحداث</div></div>
      ${activity.length === 0 ? '<div class="empty">لا توجد أحداث.</div>' :
      `<table class="table"><thead><tr><th>الحدث</th><th>التفاصيل</th><th>الوقت</th></tr></thead><tbody>
        ${activity.slice(0, 20).map((e) => `<tr>
          <td><span class="badge info">${escapeHtml(e.event_type)}</span></td>
          <td>${escapeHtml(e.details || '—')}</td>
          <td>${formatDate(e.created_at)}</td>
        </tr>`).join('')}
      </tbody></table>`}
    </div>`;
}

// ============================================================
// Welcome
// ============================================================
async function pageWelcome() {
  const settings = await api('/api/settings');
  const phrases = await api('/api/welcome/phrases');
  let welcomeTexts = [];
  try {
    const reg = await api('/api/texts/registry');
    welcomeTexts = (reg.texts || []).filter(t => t.category === 'welcome');
  } catch (e) { console.warn('[Welcome] failed:', e); }

  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">👋 إعدادات الترحيب</div></div>
      <div class="form-grid">
        <div class="form-row">
          <label>الحالة</label>
          <label class="switch">
            <input type="checkbox" data-setting="welcome_enabled" data-type="bool" ${settings.welcome_enabled !== 'false' ? 'checked' : ''}>
            <span class="track"></span>
            <span class="label-text">تفعيل نظام الترحيب</span>
          </label>
        </div>
        <div class="form-row"><label>قناة الترحيب</label>${channelSelect(settings.welcome_channel_id, 'welcome_channel_id', { types: [0] })}</div>
      </div>
      <div class="btn-row">
        <button class="btn-primary" onclick="saveSettings(this)">💾 حفظ</button>
        <button class="btn-secondary" onclick="previewWelcome()">🖼️ معاينة الصورة</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">✏️ نصوص الترحيب (${welcomeTexts.length})</div></div>
      ${renderWelcomeTextsSection(welcomeTexts)}
    </div>
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">💬 عبارات الترحيب (${phrases.length})</div>
        <button class="btn-secondary" onclick="addPhrase()">➕ إضافة عبارة</button>
      </div>
      <div id="phrases-list" class="chip-list">
        ${phrases.map((p) => `<span class="chip">${escapeHtml(p.text)}<span class="x" onclick="deletePhrase(${p.id})">✕</span></span>`).join('')}
      </div>
    </div>`;
  attachSettingListeners();
  document.querySelectorAll('[data-welcome-text-key]').forEach(el => {
    el.addEventListener('input', () => { el.style.borderColor = 'var(--warning)'; });
  });
}

function renderWelcomeTextsSection(texts) {
  if (!texts || texts.length === 0) {
    return '<div class="empty">لا توجد نصوص مسجّلة في فئة welcome.</div>';
  }
  return `
    <table class="table">
      <thead><tr><th>المفتاح</th><th>الوصف</th><th>القيمة</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${texts.map(t => {
        const val = t.currentValue ?? '';
        const isLong = val.includes('\n') || val.length > 80;
        return `
          <tr>
            <td><code style="font-size:11px">${escapeHtml(t.key)}</code></td>
            <td style="font-size:12px">${escapeHtml(t.description || '—')}</td>
            <td style="min-width:280px">${isLong
              ? `<textarea data-welcome-text-key="${escapeHtml(t.key)}" rows="3" style="width:100%">${escapeHtml(val)}</textarea>`
              : `<input type="text" value="${escapeHtml(val)}" data-welcome-text-key="${escapeHtml(t.key)}" style="width:100%">`}</td>
            <td>${t.isCustomized ? '<span class="badge success">مُخصَّص</span>' : '<span class="badge muted">افتراضي</span>'}</td>
            <td style="white-space:nowrap">
              <button class="btn-success" style="padding:5px 10px;font-size:12px" onclick="saveWelcomeText('${escapeHtml(t.key)}')">💾</button>
              <button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="resetWelcomeText('${escapeHtml(t.key)}')">↺</button>
            </td>
          </tr>`;
      }).join('')}</tbody>
    </table>`;
}

async function saveWelcomeText(key) {
  const input = document.querySelector(`[data-welcome-text-key="${key}"]`);
  if (!input) return;
  try {
    await api('/api/texts/registry/save', { method: 'POST', body: JSON.stringify({ key, value: input.value }) });
    toast('✅ تم حفظ النص', 'success'); pageWelcome();
  } catch (e) { toast(e.message || 'فشل', 'error'); }
}

async function resetWelcomeText(key) {
  if (!(await confirmModal('تأكيد', 'إعادة هذا النص إلى القيمة الافتراضية؟'))) return;
  try {
    await api('/api/texts/registry/reset', { method: 'POST', body: JSON.stringify({ key }) });
    toast('✅ تمت الاستعادة', 'success'); pageWelcome();
  } catch (e) { toast(e.message || 'فشل', 'error'); }
}

async function addPhrase() {
  const text = prompt('النص:');
  if (!text) return;
  try {
    await api('/api/welcome/phrases', { method: 'POST', body: JSON.stringify({ text }) });
    toast('تم إضافة العبارة', 'success'); pageWelcome();
  } catch (e) { toast(e.message, 'error'); }
}

async function deletePhrase(id) {
  if (!(await confirmModal('تأكيد', 'حذف هذه العبارة؟'))) return;
  try {
    await api(`/api/welcome/phrases/${id}`, { method: 'DELETE' });
    toast('تم الحذف', 'success'); pageWelcome();
  } catch (e) { toast(e.message, 'error'); }
}

async function previewWelcome() {
  const w = window.open('', '_blank');
  w.document.write('<p style="font-family:sans-serif;padding:20px">جارٍ التوليد...</p>');
  try {
    const res = await fetch('/api/welcome/preview', { credentials: 'include' });
    if (!res.ok) throw new Error('فشل التوليد');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    w.document.body.innerHTML = `<img src="${url}" style="max-width:100%">`;
  } catch (e) {
    w.document.body.innerHTML = `<p style="color:red;font-family:sans-serif;padding:20px">❌ ${e.message}</p>`;
  }
}

// ============================================================
// Image Editor
// ============================================================
let weState = {
  canvas: null, ctx: null, template: null, demoAvatar: null,
  demoName: 'Suli', selectedLayer: 'text',
  layers: {
    text:   { x: 839, y: 510,   size: 109, visible: true, locked: false },
    avatar: { x: 416, y: 512.5, size: 550, visible: true, locked: false },
    background: { visible: true, locked: true },
  },
  outline: { color: '#484848', strength: 40 },
  gradient: { from: '#e8e8e8', to: '#ffffff' },
  shadow: { directionDeg: -45, offsetPx: 40, blurPx: 40, opacity: 0.75, color: '#000000' },
  showUsername: true, dirty: false, drag: null,
  defaults: { text: { x: 839, y: 510, size: 109 }, avatar: { x: 416, y: 512.5, size: 550 } },
};

function weInjectStyles() {
  if (document.getElementById('we-styles')) return;
  const style = document.createElement('style');
  style.id = 'we-styles';
  style.textContent = `
    @font-face { font-family: 'RH Zak'; src: url('/assets/ArbFONTS-RH-Zak-Bold.otf') format('opentype'); font-display: swap; }
    .we-root { display: flex; flex-direction: column; gap: 16px; }
    .we-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; background: var(--bg-elev-2, #2a2a2a); border-radius: 10px; }
    .we-toolbar-status { font-size: 13px; color: #8e8e8e; display: flex; align-items: center; gap: 8px; }
    .we-toolbar-status .we-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; }
    .we-toolbar-status.dirty .we-dot { background: #f59e0b; }
    .we-toolbar-status.dirty .we-status-text { color: #f59e0b; }
    .we-toolbar-buttons { display: flex; gap: 8px; }
    .we-main { display: grid; grid-template-columns: 1fr 340px; gap: 16px; }
    @media (max-width: 1100px) { .we-main { grid-template-columns: 1fr; } }
    .we-canvas-wrapper { background: var(--bg-elev-2, #2a2a2a); border-radius: 10px; padding: 16px; display: flex; align-items: flex-start; justify-content: center; }
    .we-canvas-container { position: relative; width: 100%; max-width: 960px; background: #0f0f10; border-radius: 8px; overflow: hidden; user-select: none; }
    .we-canvas-container canvas { display: block; width: 100%; height: auto; cursor: default; }
    .we-canvas-container.layer-text canvas, .we-canvas-container.layer-avatar canvas { cursor: move; }
    .we-sidebar { display: flex; flex-direction: column; gap: 14px; }
    .we-section { background: var(--bg-elev-2, #2a2a2a); border-radius: 10px; padding: 14px; }
    .we-section-title { font-size: 14px; font-weight: 600; color: #fff; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .we-layer-row { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; border: 1px solid transparent; margin-bottom: 4px; transition: background 0.15s, border-color 0.15s; }
    .we-layer-row:hover { background: rgba(255,255,255,0.04); }
    .we-layer-row.active { background: rgba(88,101,242,0.15); border-color: rgba(88,101,242,0.5); }
    .we-layer-row .we-layer-icon { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    .we-layer-row .we-layer-name { flex: 1; font-size: 13px; color: #dbdee1; }
    .we-layer-row .we-layer-btn { background: none; border: none; cursor: pointer; font-size: 14px; padding: 3px 6px; border-radius: 4px; opacity: 0.7; color: #dbdee1; }
    .we-layer-row .we-layer-btn:hover { opacity: 1; background: rgba(255,255,255,0.08); }
    .we-layer-row .we-layer-btn.hidden { opacity: 0.35; }
    .we-form-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .we-form-row label { flex: 1; font-size: 12px; color: #b5bac1; }
    .we-form-row input[type="number"], .we-form-row input[type="text"] { width: 80px; padding: 5px 8px; background: #1e1f22; color: #dbdee1; border: 1px solid #3a3c42; border-radius: 5px; font-size: 12px; }
    .we-form-row input[type="color"] { width: 42px; height: 26px; padding: 0; border: 1px solid #3a3c42; border-radius: 5px; cursor: pointer; }
    .we-form-row input[type="range"] { flex: 1; }
    .we-switch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
    .we-switch input { opacity: 0; width: 0; height: 0; }
    .we-switch .we-slider { position: absolute; cursor: pointer; inset: 0; background: #4f545c; border-radius: 22px; transition: 0.2s; }
    .we-switch .we-slider:before { content: ""; position: absolute; height: 16px; width: 16px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: 0.2s; }
    .we-switch input:checked + .we-slider { background: #5865f2; }
    .we-switch input:checked + .we-slider:before { transform: translateX(18px); }
    .we-empty { font-size: 12px; color: #6d6f78; text-align: center; padding: 10px; }
    .we-btn { padding: 8px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; border: none; font-weight: 600; transition: 0.15s; }
    .we-btn-save { background: #5865f2; color: #fff; }
    .we-btn-save:hover { background: #4752c4; }
    .we-btn-secondary { background: #4f545c; color: #fff; }
    .we-btn-secondary:hover { background: #5d6269; }
    .we-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `;
  document.head.appendChild(style);
}

async function weLoadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function pageImageEditor() {
  weInjectStyles();
  contentArea.innerHTML = '<div class="loader">جارٍ تحميل المحرر...</div>';
  const settings = await api('/api/settings');
  const we = weState;
  we.layers.text.x = Number(settings.welcome_name_x ?? 839);
  we.layers.text.y = Number(settings.welcome_name_y ?? 510);
  we.layers.text.size = Number(settings.welcome_name_size ?? 109);
  we.layers.avatar.x = Number(settings.welcome_avatar_x ?? 416);
  we.layers.avatar.y = Number(settings.welcome_avatar_y ?? 512.5);
  we.layers.avatar.size = Number(settings.welcome_avatar_size ?? 550);
  we.showUsername = settings.welcome_show_username !== 'false';
  we.outline.color = settings['welcome.outline.color'] || '#484848';
  we.outline.strength = Number(settings.welcome_outline_strength ?? 40);
  we.gradient.from = settings['welcome.gradient.from'] || '#e8e8e8';
  we.gradient.to = settings['welcome.gradient.to'] || '#ffffff';
  try { we.shadow = { ...we.shadow, ...JSON.parse(settings.welcome_shadow || '{}') }; } catch { /* ignore */ }
  we.dirty = false; we.selectedLayer = 'text';
  we.layers.text.visible = true; we.layers.text.locked = false;
  we.layers.avatar.visible = true; we.layers.avatar.locked = false;

  try {
    const me = await api('/api/me');
    if (me?.id && me?.avatar) we.demoAvatar = await weLoadImage(`https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=256`);
    if (me?.username) we.demoName = me.username;
  } catch { /* ignore */ }
  if (!we.demoAvatar) { try { we.demoAvatar = await weLoadImage('/assets/logo.png'); } catch { /* ignore */ } }

  try { we.template = await weLoadImage('/assets/welcome.png'); }
  catch (e) {
    contentArea.innerHTML = `<div class="panel"><div class="empty">❌ فشل تحميل قالب الترحيب (assets/welcome.png)</div></div>`;
    return;
  }
  try { await document.fonts.load('bold 100px "RH Zak"'); } catch { /* ignore */ }

  contentArea.innerHTML = `
    <div class="we-root">
      <div class="we-toolbar">
        <div class="we-toolbar-status" id="we-status"><span class="we-dot"></span><span class="we-status-text">محفوظ</span></div>
        <div class="we-toolbar-buttons">
          <button class="we-btn we-btn-secondary" id="we-reset-btn">↺ إعادة ضبط الكل</button>
          <button class="we-btn we-btn-save" id="we-save-btn">💾 حفظ التغييرات</button>
        </div>
      </div>
      <div class="we-main">
        <div class="we-canvas-wrapper">
          <div class="we-canvas-container" id="we-canvas-container"><canvas id="we-canvas" width="1920" height="1080"></canvas></div>
        </div>
        <div class="we-sidebar">
          <div class="we-section"><div class="we-section-title">📚 الطبقات</div><div id="we-layers-list"></div></div>
          <div class="we-section" id="we-props-section"></div>
        </div>
      </div>
    </div>`;

  we.canvas = $('we-canvas');
  we.ctx = we.canvas.getContext('2d');
  weAttachListeners(); weDraw(); weRenderLayers(); weRenderProps();
}

function weOutlineToPixel(strength, fontSize) { return (strength / 200) * (fontSize * 0.46); }
function weHexToRgba(hex, alpha) {
  try { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${alpha})`; }
  catch { return `rgba(0,0,0,${alpha})`; }
}

function weDraw() {
  const { canvas, ctx, template, layers, showUsername, outline, gradient, shadow } = weState;
  if (!canvas || !ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (template) ctx.drawImage(template, 0, 0, canvas.width, canvas.height);
  else { ctx.fillStyle = '#1e1f22'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  if (layers.avatar.visible && weState.demoAvatar) {
    const a = layers.avatar, r = a.size / 2;
    ctx.save(); ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    ctx.fillStyle = '#1e2024'; ctx.fillRect(a.x - r, a.y - r, r * 2, r * 2);
    ctx.drawImage(weState.demoAvatar, a.x - r, a.y - r, r * 2, r * 2); ctx.restore();
  }
  if (layers.text.visible && showUsername) {
    const t = layers.text, fontSize = t.size, nx = t.x, ny = t.y;
    ctx.save();
    ctx.font = `${fontSize}px "RH Zak", sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
    const rad = ((shadow.directionDeg || 0) * Math.PI) / 180;
    ctx.shadowColor = weHexToRgba(shadow.color || '#000000', shadow.opacity ?? 0.75);
    ctx.shadowBlur = shadow.blurPx ?? 40;
    ctx.shadowOffsetX = Math.cos(rad) * (shadow.offsetPx ?? 40);
    ctx.shadowOffsetY = Math.sin(rad) * (shadow.offsetPx ?? 40);
    ctx.fillStyle = '#000000'; ctx.fillText(weState.demoName, nx, ny);
    ctx.restore();
    ctx.save();
    ctx.font = `${fontSize}px "RH Zak", sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
    ctx.lineWidth = weOutlineToPixel(outline.strength, fontSize); ctx.lineJoin = 'round'; ctx.strokeStyle = outline.color;
    ctx.strokeText(weState.demoName, nx, ny);
    ctx.restore();
    ctx.save();
    ctx.font = `${fontSize}px "RH Zak", sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
    const grd = ctx.createLinearGradient(nx, ny - fontSize / 2, nx, ny + fontSize / 2);
    grd.addColorStop(0, gradient.from); grd.addColorStop(1, gradient.to);
    ctx.fillStyle = grd; ctx.fillText(weState.demoName, nx, ny);
    ctx.restore();
  }
  weDrawSelection(ctx);
}

function weDrawSelection(ctx) {
  const sel = weState.selectedLayer;
  if (sel === 'background') return;
  const layer = weState.layers[sel];
  if (!layer || !layer.visible) return;
  if (sel === 'text' && !weState.showUsername) return;
  const lw = 4;
  if (sel === 'text') {
    const fontSize = layer.size;
    ctx.save(); ctx.font = `${fontSize}px "RH Zak", sans-serif`; ctx.direction = 'rtl';
    const w = ctx.measureText(weState.demoName).width, h = fontSize;
    const x = layer.x - lw, y = layer.y - h / 2 - lw;
    ctx.restore();
    ctx.save(); ctx.strokeStyle = '#5865f2'; ctx.lineWidth = lw; ctx.setLineDash([12, 8]);
    ctx.strokeRect(x, y, w + lw * 2, h + lw * 2); ctx.setLineDash([]);
    weDrawHandle(ctx, x + w + lw * 2, y + h + lw * 2, '#5865f2'); ctx.restore();
  }
  if (sel === 'avatar') {
    const r = layer.size / 2;
    ctx.save(); ctx.strokeStyle = '#5865f2'; ctx.lineWidth = lw; ctx.setLineDash([12, 8]);
    ctx.beginPath(); ctx.arc(layer.x, layer.y, r + lw, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    weDrawHandle(ctx, layer.x + r, layer.y + r, '#5865f2'); ctx.restore();
  }
}

function weDrawHandle(ctx, x, y, color) {
  const size = 20;
  ctx.fillStyle = color; ctx.fillRect(x - size / 2, y - size / 2, size, size);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x - size / 2, y - size / 2, size, size);
}

function weRenderLayers() {
  const container = $('we-layers-list');
  if (!container) return;
  const rows = [
    { id: 'text', icon: 'T', name: 'Text' },
    { id: 'avatar', icon: '🖼️', name: 'Avatar' },
    { id: 'background', icon: '🌄', name: 'Background' },
  ];
  container.innerHTML = rows.map(r => {
    const layer = weState.layers[r.id];
    const active = weState.selectedLayer === r.id ? 'active' : '';
    const visIcon = layer.visible ? '👁️' : '🚫';
    const lockIcon = layer.locked ? '🔒' : '🔓';
    const isBackground = r.id === 'background';
    return `
      <div class="we-layer-row ${active}" data-layer="${r.id}">
        <span class="we-layer-icon">${r.icon}</span>
        <span class="we-layer-name">${r.name}</span>
        ${!isBackground ? `<button class="we-layer-btn ${layer.visible ? '' : 'hidden'}" data-action="visibility" data-layer="${r.id}">${visIcon}</button>` : ''}
        ${!isBackground ? `<button class="we-layer-btn ${layer.locked ? '' : 'hidden'}" data-action="lock" data-layer="${r.id}">${lockIcon}</button>` : ''}
        ${!isBackground ? `<button class="we-layer-btn" data-action="reset" data-layer="${r.id}">↺</button>` : ''}
      </div>`;
  }).join('');
  container.querySelectorAll('.we-layer-row').forEach(el => {
    el.addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') return; weSelectLayer(el.dataset.layer); });
  });
  container.querySelectorAll('[data-action="visibility"]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); weToggleVisibility(el.dataset.layer); });
  });
  container.querySelectorAll('[data-action="lock"]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); weToggleLock(el.dataset.layer); });
  });
  container.querySelectorAll('[data-action="reset"]').forEach(el => {
    el.addEventListener('click', (e) => { e.stopPropagation(); weResetLayer(el.dataset.layer); });
  });
}

function weRenderProps() {
  const container = $('we-props-section');
  if (!container) return;
  const sel = weState.selectedLayer;
  if (sel === 'background') {
    container.innerHTML = `<div class="we-section-title">🌄 الخلفية</div><div class="we-empty">الخلفية ثابتة.</div>`;
    return;
  }
  if (sel === 'text') {
    const t = weState.layers.text;
    container.innerHTML = `
      <div class="we-section-title">✏️ إعدادات النص</div>
      <div class="we-form-row"><label>إظهار اسم العضو</label><label class="we-switch"><input type="checkbox" id="we-show-username" ${weState.showUsername ? 'checked' : ''}><span class="we-slider"></span></label></div>
      <div class="we-form-row"><label>الموضع X</label><input type="number" id="we-tx" value="${Math.round(t.x)}"></div>
      <div class="we-form-row"><label>الموضع Y</label><input type="number" id="we-ty" value="${Math.round(t.y)}"></div>
      <div class="we-form-row"><label>حجم الخط</label><input type="number" id="we-ts" value="${Math.round(t.size)}"></div>
      <div class="we-form-row"><label>لون المخطط</label><input type="color" id="we-oc" value="${weState.outline.color}"></div>
      <div class="we-form-row"><label>شدة المخطط</label><input type="range" id="we-os" value="${weState.outline.strength}" min="0" max="200"></div>
      <div class="we-form-row"><label>تدرج من</label><input type="color" id="we-gf" value="${weState.gradient.from}"></div>
      <div class="we-form-row"><label>تدرج إلى</label><input type="color" id="we-gt" value="${weState.gradient.to}"></div>`;
    weBindTextProps();
    return;
  }
  if (sel === 'avatar') {
    const a = weState.layers.avatar;
    container.innerHTML = `
      <div class="we-section-title">🖼️ إعدادات الصورة</div>
      <div class="we-form-row"><label>الموضع X</label><input type="number" id="we-ax" value="${Math.round(a.x)}"></div>
      <div class="we-form-row"><label>الموضع Y</label><input type="number" id="we-ay" value="${Math.round(a.y)}"></div>
      <div class="we-form-row"><label>الحجم</label><input type="number" id="we-as" value="${Math.round(a.size)}"></div>`;
    weBindAvatarProps();
  }
}

function weBindTextProps() {
  const su = $('we-show-username'); if (su) su.addEventListener('change', (e) => { weState.showUsername = e.target.checked; weMarkDirty(); weDraw(); });
  const tx = $('we-tx'); if (tx) tx.addEventListener('input', (e) => { weState.layers.text.x = Number(e.target.value) || 0; weMarkDirty(); weDraw(); });
  const ty = $('we-ty'); if (ty) ty.addEventListener('input', (e) => { weState.layers.text.y = Number(e.target.value) || 0; weMarkDirty(); weDraw(); });
  const ts = $('we-ts'); if (ts) ts.addEventListener('input', (e) => { weState.layers.text.size = Number(e.target.value) || 20; weMarkDirty(); weDraw(); });
  const oc = $('we-oc'); if (oc) oc.addEventListener('input', (e) => { weState.outline.color = e.target.value; weMarkDirty(); weDraw(); });
  const os = $('we-os'); if (os) os.addEventListener('input', (e) => { weState.outline.strength = Number(e.target.value) || 0; weMarkDirty(); weDraw(); });
  const gf = $('we-gf'); if (gf) gf.addEventListener('input', (e) => { weState.gradient.from = e.target.value; weMarkDirty(); weDraw(); });
  const gt = $('we-gt'); if (gt) gt.addEventListener('input', (e) => { weState.gradient.to = e.target.value; weMarkDirty(); weDraw(); });
}

function weBindAvatarProps() {
  const ax = $('we-ax'); if (ax) ax.addEventListener('input', (e) => { weState.layers.avatar.x = Number(e.target.value) || 0; weMarkDirty(); weDraw(); });
  const ay = $('we-ay'); if (ay) ay.addEventListener('input', (e) => { weState.layers.avatar.y = Number(e.target.value) || 0; weMarkDirty(); weDraw(); });
  const as = $('we-as'); if (as) as.addEventListener('input', (e) => { weState.layers.avatar.size = Number(e.target.value) || 50; weMarkDirty(); weDraw(); });
}

function weSelectLayer(name) {
  if (!['text', 'avatar', 'background'].includes(name)) return;
  weState.selectedLayer = name; weRenderLayers(); weRenderProps(); weDraw(); weUpdateCursor();
}
function weToggleVisibility(name) {
  if (name === 'background') return;
  weState.layers[name].visible = !weState.layers[name].visible; weMarkDirty(); weRenderLayers(); weDraw();
}
function weToggleLock(name) {
  if (name === 'background') return;
  weState.layers[name].locked = !weState.layers[name].locked; weMarkDirty(); weRenderLayers();
}
function weResetLayer(name) {
  if (name === 'text') {
    weState.layers.text.x = weState.defaults.text.x;
    weState.layers.text.y = weState.defaults.text.y;
    weState.layers.text.size = weState.defaults.text.size;
  } else if (name === 'avatar') {
    weState.layers.avatar.x = weState.defaults.avatar.x;
    weState.layers.avatar.y = weState.defaults.avatar.y;
    weState.layers.avatar.size = weState.defaults.avatar.size;
  }
  weMarkDirty(); weRenderProps(); weDraw();
}

function weAttachListeners() {
  const canvas = weState.canvas;
  if (!canvas) return;
  canvas.addEventListener('mousedown', weOnMouseDown);
  document.addEventListener('mousemove', weOnMouseMove);
  document.addEventListener('mouseup', weOnMouseUp);
  const saveBtn = $('we-save-btn'); if (saveBtn) saveBtn.addEventListener('click', () => weSave(saveBtn));
  const resetBtn = $('we-reset-btn'); if (resetBtn) resetBtn.addEventListener('click', () => weResetAll());
  weUpdateCursor();
}

function weGetCanvasCoords(e) {
  const canvas = weState.canvas, rect = canvas.getBoundingClientRect();
  const scale = rect.width / canvas.width;
  return { x: (e.clientX - rect.left) / scale, y: (e.clientY - rect.top) / scale };
}

function weOnMouseDown(e) {
  const { x, y } = weGetCanvasCoords(e);
  const candidates = [];
  if (weState.showUsername && weState.layers.text.visible && !weState.layers.text.locked) candidates.push('text');
  if (weState.layers.avatar.visible && !weState.layers.avatar.locked) candidates.push('avatar');
  for (const c of candidates) {
    if (c === 'text') {
      const t = weState.layers.text, fs = t.size, ctx = weState.ctx;
      ctx.save(); ctx.font = `${fs}px "RH Zak", sans-serif`; ctx.direction = 'rtl';
      const w = ctx.measureText(weState.demoName).width; ctx.restore();
      if (x >= t.x && x <= t.x + w && y >= t.y - fs / 2 && y <= t.y + fs / 2) {
        weSelectLayer('text');
        weState.drag = { layerName: 'text', mode: 'move', offsetX: x - t.x, offsetY: y - t.y };
        e.preventDefault(); return;
      }
    }
    if (c === 'avatar') {
      const a = weState.layers.avatar, r = a.size / 2;
      if ((x - a.x) ** 2 + (y - a.y) ** 2 <= r * r) {
        weSelectLayer('avatar');
        weState.drag = { layerName: 'avatar', mode: 'move', offsetX: x - a.x, offsetY: y - a.y };
        e.preventDefault(); return;
      }
    }
  }
}

function weOnMouseMove(e) {
  if (!weState.drag) return;
  const { x, y } = weGetCanvasCoords(e);
  const layer = weState.layers[weState.drag.layerName];
  if (!layer) return;
  layer.x = Math.max(0, Math.min(1920, x - weState.drag.offsetX));
  layer.y = Math.max(0, Math.min(1080, y - weState.drag.offsetY));
  weMarkDirty(); weDraw(); weUpdatePropsValues(); e.preventDefault();
}

function weOnMouseUp() { weState.drag = null; }

function weUpdatePropsValues() {
  const sel = weState.selectedLayer;
  if (sel === 'text') {
    const tx = $('we-tx'), ty = $('we-ty'), ts = $('we-ts');
    if (tx) tx.value = Math.round(weState.layers.text.x);
    if (ty) ty.value = Math.round(weState.layers.text.y);
    if (ts) ts.value = Math.round(weState.layers.text.size);
  } else if (sel === 'avatar') {
    const ax = $('we-ax'), ay = $('we-ay'), as = $('we-as');
    if (ax) ax.value = Math.round(weState.layers.avatar.x);
    if (ay) ay.value = Math.round(weState.layers.avatar.y);
    if (as) as.value = Math.round(weState.layers.avatar.size);
  }
}

function weUpdateCursor() {
  const container = $('we-canvas-container');
  if (!container) return;
  container.className = 'we-canvas-container';
  const sel = weState.selectedLayer;
  if (sel === 'text' || sel === 'avatar') container.classList.add(`layer-${sel}`);
}

function weMarkDirty() {
  weState.dirty = true;
  const s = $('we-status');
  if (s) {
    s.classList.add('dirty');
    const t = s.querySelector('.we-status-text'); if (t) t.textContent = 'تغييرات غير محفوظة';
  }
}
function weMarkSaved() {
  weState.dirty = false;
  const s = $('we-status');
  if (s) {
    s.classList.remove('dirty');
    const t = s.querySelector('.we-status-text'); if (t) t.textContent = 'محفوظ';
  }
}

async function weSave(btn) {
  btn.disabled = true; btn.textContent = '...';
  try {
    const values = {
      welcome_avatar_x: String(Math.round(weState.layers.avatar.x)),
      welcome_avatar_y: String(Math.round(weState.layers.avatar.y)),
      welcome_avatar_size: String(Math.round(weState.layers.avatar.size)),
      welcome_name_x: String(Math.round(weState.layers.text.x)),
      welcome_name_y: String(Math.round(weState.layers.text.y)),
      welcome_name_size: String(Math.round(weState.layers.text.size)),
      'welcome.outline.color': weState.outline.color,
      welcome_outline_strength: String(weState.outline.strength),
      'welcome.gradient.from': weState.gradient.from,
      'welcome.gradient.to': weState.gradient.to,
      welcome_shadow: JSON.stringify(weState.shadow),
      welcome_show_username: weState.showUsername ? 'true' : 'false',
    };
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ values }) });
    weMarkSaved(); toast('✅ تم حفظ تصميم الترحيب', 'success');
  } catch (e) { toast('❌ فشل الحفظ: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '💾 حفظ التغييرات'; }
}

async function weResetAll() {
  if (!(await confirmModal('تأكيد', 'إعادة جميع الإعدادات إلى الوضع الافتراضي؟'))) return;
  weState.layers.text = { ...weState.defaults.text, visible: true, locked: false };
  weState.layers.avatar = { ...weState.defaults.avatar, visible: true, locked: false };
  weState.showUsername = true;
  weState.outline = { color: '#484848', strength: 40 };
  weState.gradient = { from: '#e8e8e8', to: '#ffffff' };
  weState.shadow = { directionDeg: -45, offsetPx: 40, blurPx: 40, opacity: 0.75, color: '#000000' };
  weMarkDirty(); weRenderLayers(); weRenderProps(); weDraw();
}

// ============================================================
// Welcome Buttons
// ============================================================
async function pageButtons() {
  const buttons = await api('/api/welcome/buttons');
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🔘 أزرار الترحيب</div></div>
      ${buttons.map((b) => `
        <div class="panel" style="background:var(--bg-elev-2);margin-bottom:12px">
          <div class="form-grid">
            <div class="form-row"><label>النوع</label><input type="text" value="${escapeHtml(b.button_id)}" disabled></div>
            <div class="form-row"><label>Label</label><input type="text" value="${escapeHtml(b.label ?? '')}" data-btn="${b.button_id}" data-field="label"></div>
            <div class="form-row"><label>Emoji ID</label><input type="text" value="${escapeHtml(b.emoji_id || '')}" data-btn="${b.button_id}" data-field="emoji_id"></div>
            ${b.button_id !== 'welcome' ? `<div class="form-row"><label>URL</label><input type="url" value="${escapeHtml(b.url || '')}" data-btn="${b.button_id}" data-field="url"></div>` : ''}
            <div class="form-row"><label>الحالة</label><label class="switch"><input type="checkbox" ${b.enabled ? 'checked' : ''} data-btn="${b.button_id}" data-field="enabled" data-type="bool"><span class="track"></span><span class="label-text">${b.enabled ? 'مفعّل' : 'معطّل'}</span></label></div>
          </div>
        </div>
      `).join('')}
      <div class="btn-row"><button class="btn-primary" onclick="saveButtons(this)">💾 حفظ الكل</button></div>
    </div>`;
}

async function saveButtons(btn) {
  btn.disabled = true;
  try {
    const grouped = {};
    document.querySelectorAll('[data-btn]').forEach((el) => {
      const id = el.dataset.btn;
      if (!grouped[id]) grouped[id] = {};
      const f = el.dataset.field;
      if (el.type === 'checkbox') grouped[id][f] = el.checked ? 1 : 0;
      else grouped[id][f] = el.value;
    });
    for (const [id, data] of Object.entries(grouped)) {
      await api(`/api/welcome/buttons/${id}`, { method: 'POST', body: JSON.stringify(data) });
    }
    toast('تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ============================================================
// Logs, Activity, Moderation
// ============================================================
const LOG_KEYS = [
  { key: 'logs_join_channel_id', label: '👋 Join Logs' },
  { key: 'logs_leave_channel_id', label: '🚪 Leave Logs' },
  { key: 'logs_voice_channel_id', label: '🎙️ Voice Logs' },
  { key: 'logs_message_channel_id', label: '💬 Message Logs' },
  { key: 'logs_channel_channel_id', label: '📁 Channel Logs' },
  { key: 'logs_role_channel_id', label: '🎭 Role Create/Delete' },
  { key: 'logs_role_added_channel_id', label: '✅ Role Added' },
  { key: 'logs_role_removed_channel_id', label: '❌ Role Removed' },
  { key: 'logs_moderation_channel_id', label: '🔨 Moderation Logs' },
  { key: 'logs_security_channel_id', label: '🛡️ Security Logs' },
  { key: 'logs_ban_channel_id', label: '🔨 Ban Logs' },
  { key: 'logs_unban_channel_id', label: '🔓 Unban Logs' },
  { key: 'logs_timeout_channel_id', label: '⏱️ Timeout Logs' },
  { key: 'logs_untimeout_channel_id', label: '🔓 Untimeout Logs' },
];

async function pageLogs() {
  const settings = await api('/api/settings');
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📋 قنوات اللوجز</div></div>
      <div class="form-grid">
        ${LOG_KEYS.map((l) => `<div class="form-row"><label>${l.label}</label>${channelSelect(settings[l.key], l.key, { types: [0] })}</div>`).join('')}
      </div>
      <div class="btn-row"><button class="btn-primary" onclick="saveSettings(this)">💾 حفظ</button></div>
    </div>`;
  attachSettingListeners();
}

async function pageActivity() {
  const list = await api('/api/activity');
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📜 سجل الأحداث (${list.length})</div></div>
      ${list.length === 0 ? '<div class="empty">لا توجد أحداث.</div>' :
      `<table class="table">
        <thead><tr><th>النوع</th><th>المستخدم</th><th>التفاصيل</th><th>الوقت</th></tr></thead>
        <tbody>${list.map((e) => `<tr>
          <td><span class="badge info">${escapeHtml(e.event_type)}</span></td>
          <td>${e.user_id ? `<code>${e.user_id}</code>` : '—'}</td>
          <td>${escapeHtml(e.details || '—')}</td>
          <td>${formatDate(e.created_at)}</td>
        </tr>`).join('')}</tbody></table>`}
    </div>`;
}

async function pageModeration() {
  const list = await api('/api/moderation');
  const events = await api('/api/moderation/events').catch(() => []);
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🔨 سجل العقوبات (${list.length})</div></div>
      ${list.length === 0 ? '<div class="empty">لا توجد عقوبات.</div>' :
      `<table class="table">
        <thead><tr><th>الإجراء</th><th>المستهدف</th><th>المشرف</th><th>السبب</th><th>DM</th><th>الوقت</th></tr></thead>
        <tbody>${list.map((m) => `<tr>
          <td><span class="badge ${m.action.includes('ban') ? 'danger' : m.action.includes('warn') ? 'warn' : 'info'}">${escapeHtml(m.action)}</span></td>
          <td><code>${m.target_id}</code></td>
          <td>${m.moderator_id ? `<code>${m.moderator_id}</code>` : '—'}</td>
          <td>${escapeHtml(m.reason || '—')}</td>
          <td><span class="badge ${m.dm_status === 'sent' ? 'success' : 'muted'}">${m.dm_status || '—'}</span></td>
          <td>${formatDate(m.created_at)}</td>
        </tr>`).join('')}</tbody></table>`}
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📋 أحداث الإشراف (${events.length})</div></div>
      ${events.length === 0 ? '<div class="empty">لا توجد أحداث.</div>' :
      `<table class="table">
        <thead><tr><th>الإجراء</th><th>الهدف</th><th>المنفذ</th><th>الثقة</th><th>الوقت</th></tr></thead>
        <tbody>${events.slice(0, 40).map((e) => `<tr>
          <td><span class="badge info">${escapeHtml(e.action)}</span></td>
          <td><code>${e.target_id}</code></td>
          <td>${e.moderator_id ? `<code>${e.moderator_id}</code>` : '—'}</td>
          <td>${escapeHtml(e.actor_confidence)}</td>
          <td>${formatDate(e.created_at)}</td>
        </tr>`).join('')}</tbody></table>`}
    </div>`;
}

// ============================================================
// Anti-Spam
// ============================================================
async function pageAntiSpam() {
  const settings = await api('/api/settings');
  let cfg = { enabled: false, maxMessages: 8, intervalMs: 7000, punishment: 'timeout', timeoutMs: 600000, deleteMessages: true, maxDeleteCount: 20 };
  try { cfg = { ...cfg, ...JSON.parse(settings.antispam_config || '{}') }; } catch { /* ignore */ }
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🛡️ Anti-Spam</div></div>
      <div class="form-grid">
        <div class="form-row"><label>الحالة</label><label class="switch"><input type="checkbox" id="as-enabled" ${cfg.enabled ? 'checked' : ''}><span class="track"></span><span class="label-text">تفعيل</span></label></div>
        <div class="form-row"><label>الحد الأقصى للرسائل</label><input type="number" id="as-max" value="${cfg.maxMessages}"></div>
        <div class="form-row"><label>الفترة (ms)</label><input type="number" id="as-interval" value="${cfg.intervalMs}"></div>
        <div class="form-row"><label>العقوبة</label><select id="as-pun">
          <option value="none" ${cfg.punishment === 'none' ? 'selected' : ''}>None</option>
          <option value="warn" ${cfg.punishment === 'warn' ? 'selected' : ''}>Warn</option>
          <option value="timeout" ${cfg.punishment === 'timeout' ? 'selected' : ''}>Timeout</option>
          <option value="kick" ${cfg.punishment === 'kick' ? 'selected' : ''}>Kick</option>
          <option value="ban" ${cfg.punishment === 'ban' ? 'selected' : ''}>Ban</option>
        </select></div>
        <div class="form-row"><label>مدة Timeout (ms)</label><input type="number" id="as-tmo" value="${cfg.timeoutMs}"></div>
        <div class="form-row"><label>حذف الرسائل</label><label class="switch"><input type="checkbox" id="as-delete" ${cfg.deleteMessages ? 'checked' : ''}><span class="track"></span><span class="label-text">${cfg.deleteMessages ? 'مفعّل' : 'معطّل'}</span></label></div>
        <div class="form-row"><label>الحد الأقصى للحذف</label><input type="number" id="as-max-del" value="${cfg.maxDeleteCount}"></div>
      </div>
      <div class="btn-row"><button class="btn-primary" onclick="saveAntiSpam(this)">💾 حفظ</button></div>
    </div>`;
}

async function saveAntiSpam(btn) {
  btn.disabled = true;
  try {
    const cfg = {
      enabled: $('as-enabled').checked,
      maxMessages: Number($('as-max').value),
      intervalMs: Number($('as-interval').value),
      punishment: $('as-pun').value,
      timeoutMs: Number($('as-tmo').value),
      maxDuplicates: 4, maxMentions: 5, checkLinks: false, checkInvites: true,
      excludedChannels: [], excludedRoles: [], sendDM: true, logChannelId: null,
      deleteMessages: $('as-delete').checked,
      maxDeleteCount: Number($('as-max-del').value),
    };
    await api('/api/settings/antispam_config', { method: 'POST', body: JSON.stringify({ value: JSON.stringify(cfg) }) });
    toast('تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ============================================================
// Anti-Raid
// ============================================================
async function pageAntiRaid() {
  const settings = await api('/api/settings');
  let cfg = { enabled: false, joinThreshold: 10, intervalMs: 60000, alertOnly: true, alertChannelId: null };
  try { cfg = { ...cfg, ...JSON.parse(settings.antiraid_config || '{}') }; } catch { /* ignore */ }
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🚨 Anti-Raid</div></div>
      <div class="form-grid">
        <div class="form-row"><label>الحالة</label><label class="switch"><input type="checkbox" id="ar-enabled" ${cfg.enabled ? 'checked' : ''}><span class="track"></span><span class="label-text">تفعيل</span></label></div>
        <div class="form-row"><label>عدد الدخول</label><input type="number" id="ar-threshold" value="${cfg.joinThreshold}"></div>
        <div class="form-row"><label>الفترة (ms)</label><input type="number" id="ar-interval" value="${cfg.intervalMs}"></div>
        <div class="form-row"><label>قناة التنبيهات</label>${channelSelect(cfg.alertChannelId, 'ar-channel', { types: [0] })}</div>
      </div>
      <div class="btn-row"><button class="btn-primary" onclick="saveAntiRaid(this)">💾 حفظ</button></div>
    </div>`;
}

async function saveAntiRaid(btn) {
  btn.disabled = true;
  try {
    const cfg = {
      enabled: $('ar-enabled').checked,
      joinThreshold: Number($('ar-threshold').value),
      intervalMs: Number($('ar-interval').value),
      alertOnly: true,
      alertChannelId: document.querySelector('[data-setting="ar-channel"]').value || null,
    };
    await api('/api/settings/antiraid_config', { method: 'POST', body: JSON.stringify({ value: JSON.stringify(cfg) }) });
    toast('تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ============================================================
// Anti-Nuke + test
// ============================================================
async function pageAntiNuke() {
  const cfg = await api('/api/antinuke/config').catch(() => ({}));
  const events = await api('/api/antinuke/events').catch(() => []);
  const rules = cfg.rules || {};
  const ruleLabels = {
    channel_delete: '🗑️ حذف القنوات', channel_create: '📁 إنشاء القنوات',
    role_delete: '🗑️ حذف الرولات', role_create: '🎭 إنشاء الرولات',
    ban_add: '🔨 موجات الحظر', kick_add: '👢 موجات الطرد', webhook_delete: '🪝 حذف Webhooks',
  };

  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🛡️ Anti-Nuke</div></div>
      <div class="form-grid">
        <div class="form-row"><label>الحالة</label><label class="switch"><input type="checkbox" id="an-enabled" ${cfg.enabled ? 'checked' : ''}><span class="track"></span><span class="label-text">${cfg.enabled ? 'مفعّل' : 'معطّل'}</span></label></div>
        <div class="form-row"><label>وضع المراقبة (dry run)</label><label class="switch"><input type="checkbox" id="an-dryrun" ${cfg.dryRun !== false ? 'checked' : ''}><span class="track"></span><span class="label-text">${cfg.dryRun !== false ? 'لا يُنفذ عقوبات' : 'ينفذ عقوبات'}</span></label></div>
        <div class="form-row"><label>قناة السجلات</label>${channelSelect(cfg.logChannelId, 'an-log', { types: [0] })}</div>
        <div class="form-row"><label>Trusted Users</label><input type="text" id="an-users" value="${(cfg.trustedUsers || []).join(',')}"></div>
        <div class="form-row"><label>Trusted Roles</label><input type="text" id="an-roles" value="${(cfg.trustedRoles || []).join(',')}"></div>
      </div>
      <div style="margin-top:20px">
        <div class="panel-title" style="font-size:14px;margin-bottom:12px">قواعد الكشف</div>
        ${Object.keys(ruleLabels).map(key => {
          const r = rules[key] || { enabled: false, threshold: 3, windowMs: 10000, action: 'alert', severity: 'medium' };
          return `
            <div class="panel" style="background:var(--bg-elev-2); margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <strong>${ruleLabels[key]}</strong>
                <label class="switch"><input type="checkbox" data-an-rule="${key}" data-an-field="enabled" ${r.enabled ? 'checked' : ''}><span class="track"></span><span class="label-text">${r.enabled ? 'مفعّل' : 'معطّل'}</span></label>
              </div>
              <div class="form-grid">
                <div class="form-row"><label>الحد</label><input type="number" value="${r.threshold}" data-an-rule="${key}" data-an-field="threshold"></div>
                <div class="form-row"><label>الفترة (ms)</label><input type="number" value="${r.windowMs}" data-an-rule="${key}" data-an-field="windowMs" step="1000"></div>
                <div class="form-row"><label>الإجراء</label><select data-an-rule="${key}" data-an-field="action">
                  ${['alert','none','remove_roles','kick','ban'].map(a => `<option value="${a}" ${r.action === a ? 'selected' : ''}>${a}</option>`).join('')}
                </select></div>
                <div class="form-row"><label>الخطورة</label><select data-an-rule="${key}" data-an-field="severity">
                  ${['low','medium','high','critical'].map(s => `<option value="${s}" ${r.severity === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select></div>
              </div>
            </div>`;
        }).join('')}
      </div>
      <div class="btn-row"><button class="btn-primary" onclick="saveAntiNuke(this)">💾 حفظ</button></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🧪 اختبار Anti-Nuke</div></div>
      <div class="panel-desc" style="margin-bottom:12px">يختبر منطق الكشف الفعلي دون إنشاء/حذف موارد حقيقية.</div>
      <div class="btn-row"><button class="btn-primary" id="an-test-btn" onclick="anRunTest(this)">▶️ بدء الاختبار الآمن</button></div>
      <div id="an-test-result" style="margin-top:14px"></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📜 آخر الأحداث (${events.length})</div></div>
      ${events.length === 0 ? '<div class="empty">لا توجد أحداث.</div>' :
      `<table class="table">
        <thead><tr><th>النوع</th><th>الخطورة</th><th>المنفذ</th><th>الإجراء</th><th>الوقت</th></tr></thead>
        <tbody>${events.slice(0, 30).map(e => `<tr>
          <td>${escapeHtml(e.event_type)}</td>
          <td><span class="badge ${e.severity === 'critical' ? 'danger' : e.severity === 'high' ? 'warn' : 'info'}">${e.severity}</span></td>
          <td>${e.executor_id ? `<code>${e.executor_id}</code>` : '—'}</td>
          <td><span class="badge muted">${e.action_taken || 'logged'}</span></td>
          <td>${formatDate(e.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table>`}
    </div>`;
  attachSettingListeners();
}

async function anRunTest(btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⏳ جارٍ...';
  const resultBox = document.getElementById('an-test-result');
  if (resultBox) resultBox.innerHTML = '<div class="loader">جارٍ تنفيذ المحاكاة...</div>';
  try {
    const res = await api('/api/antinuke/test', { method: 'POST' });
    if (!res.ok) {
      if (resultBox) resultBox.innerHTML = `<div class="panel-desc" style="color:#ef4444">❌ ${escapeHtml(res.error || 'فشل')}</div>`;
      return;
    }
    const r = res.report;
    const rows = r.results.map(x => `
      <tr>
        <td>${escapeHtml(x.rule)}</td>
        <td>${x.enabled ? '✅' : '⏭️'}</td>
        <td>${x.threshold}</td>
        <td>${x.windowMs / 1000}s</td>
        <td>${x.countBefore} → ${x.countAfter}</td>
        <td>${x.wouldTrigger ? '⚡' : '—'}</td>
        <td>${x.pass ? '<span class="badge success">نجح</span>' : '<span class="badge danger">فشل</span>'}</td>
      </tr>`).join('');
    const notesHtml = r.notes.map(n => `<li>${escapeHtml(n)}</li>`).join('');
    if (resultBox) resultBox.innerHTML = `
      <div class="panel" style="background:var(--bg-elev); padding:14px; border-radius:10px">
        <div style="margin-bottom:10px">
          <strong>النتيجة:</strong>
          <span class="badge ${r.summary.failed === 0 ? 'success' : 'warn'}" style="margin-right:8px">${r.summary.passed} / ${r.summary.total} نجح</span>
          <span class="badge muted">${r.durationMs}ms</span>
        </div>
        <table class="table">
          <thead><tr><th>القاعدة</th><th>مفعّل</th><th>الحد</th><th>النافذة</th><th>العد</th><th>تنبيه</th><th>النتيجة</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="margin-top:12px; font-size:12px; color:var(--text-mute)">
          <strong>ملاحظات:</strong><ul style="padding-right:20px; margin:6px 0">${notesHtml}</ul>
        </div>
        ${r.errors?.length > 0 ? `<div style="margin-top:8px; color:#ef4444"><strong>أخطاء:</strong> ${r.errors.map(escapeHtml).join('، ')}</div>` : ''}
      </div>`;
    toast(`✅ اكتمل الاختبار: ${r.summary.passed}/${r.summary.total}`, 'success');
  } catch (e) {
    if (resultBox) resultBox.innerHTML = `<div class="panel-desc" style="color:#ef4444">❌ ${escapeHtml(e.message)}</div>`;
    toast('❌ ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function saveAntiNuke(btn) {
  btn.disabled = true;
  try {
    const rules = {};
    document.querySelectorAll('[data-an-rule]').forEach(el => {
      const key = el.dataset.anRule, field = el.dataset.anField;
      if (!rules[key]) rules[key] = {};
      if (el.type === 'checkbox') rules[key][field] = el.checked;
      else if (field === 'threshold' || field === 'windowMs') rules[key][field] = Number(el.value);
      else rules[key][field] = el.value;
    });
    const cfg = {
      enabled: $('an-enabled').checked,
      dryRun: $('an-dryrun').checked,
      logChannelId: document.querySelector('[data-setting="an-log"]').value || null,
      trustedUsers: $('an-users').value.split(',').map(s => s.trim()).filter(Boolean),
      trustedRoles: $('an-roles').value.split(',').map(s => s.trim()).filter(Boolean),
      rules,
    };
    await api('/api/antinuke/config', { method: 'POST', body: JSON.stringify(cfg) });
    toast('✅ تم الحفظ', 'success');
    pageAntiNuke();
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ============================================================
// Spam Trap
// ============================================================
async function pageSpamTrap() {
  const cfg = await api('/api/spamtrap');
  const logs = await api('/api/spamtrap/log').catch(() => []);
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🕳️ Spam Trap</div></div>
      <div class="form-grid">
        <div class="form-row"><label>الحالة</label><label class="switch"><input type="checkbox" id="st-enabled" ${cfg.enabled ? 'checked' : ''}><span class="track"></span><span class="label-text">${cfg.enabled ? 'مفعّل' : 'معطّل'}</span></label></div>
        <div class="form-row"><label>قناة المصيدة</label>${channelSelect(cfg.channelId, 'st-channel', { types: [0] })}</div>
        <div class="form-row"><label>قناة السجلات</label>${channelSelect(cfg.logChannelId, 'st-log', { types: [0] })}</div>
        <div class="form-row"><label>العقوبة</label><select id="st-pun">
          <option value="ban" ${cfg.punishment === 'ban' ? 'selected' : ''}>Ban</option>
          <option value="timeout" ${cfg.punishment === 'timeout' ? 'selected' : ''}>Timeout</option>
          <option value="kick" ${cfg.punishment === 'kick' ? 'selected' : ''}>Kick</option>
        </select></div>
        <div class="form-row"><label>مدة Timeout</label><select id="st-tmo">
          <option value="60000" ${cfg.timeoutMs === 60000 ? 'selected' : ''}>دقيقة</option>
          <option value="3600000" ${cfg.timeoutMs === 3600000 ? 'selected' : ''}>ساعة</option>
          <option value="86400000" ${cfg.timeoutMs === 86400000 ? 'selected' : ''}>يوم</option>
          <option value="604800000" ${cfg.timeoutMs === 604800000 ? 'selected' : ''}>أسبوع</option>
          <option value="2419200000" ${cfg.timeoutMs === 2419200000 ? 'selected' : ''}>28 يوم</option>
        </select></div>
        <div class="form-row"><label>تجاهل البوتات</label><label class="switch"><input type="checkbox" id="st-ignore-bots" ${cfg.ignoreBots ? 'checked' : ''}><span class="track"></span><span class="label-text">${cfg.ignoreBots ? 'مفعّل' : 'معطّل'}</span></label></div>
      </div>
      <div class="btn-row"><button class="btn-primary" onclick="saveSpamTrap(this)">💾 حفظ</button></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📋 سجل الحوادث (${logs.length})</div></div>
      ${logs.length === 0 ? '<div class="empty">لا توجد حوادث.</div>' :
      `<table class="table">
        <thead><tr><th>المستخدم</th><th>القناة</th><th>العقوبة</th><th>النتيجة</th><th>الوقت</th></tr></thead>
        <tbody>${logs.map(l => `<tr>
          <td><code>${l.user_id}</code></td><td><code>${l.channel_id}</code></td>
          <td><span class="badge warn">${l.punishment}</span></td>
          <td><span class="badge ${l.success ? 'success' : 'danger'}">${l.success ? 'نجح' : 'فشل'}</span></td>
          <td>${formatDate(l.created_at)}</td>
        </tr>`).join('')}</tbody>
      </table>`}
    </div>`;
  attachSettingListeners();
}

async function saveSpamTrap(btn) {
  btn.disabled = true;
  try {
    const cfg = {
      enabled: $('st-enabled').checked,
      channelId: document.querySelector('[data-setting="st-channel"]').value || null,
      logChannelId: document.querySelector('[data-setting="st-log"]').value || null,
      punishment: $('st-pun').value,
      timeoutMs: Number($('st-tmo').value),
      ignoreBots: $('st-ignore-bots').checked,
    };
    await api('/api/spamtrap', { method: 'POST', body: JSON.stringify(cfg) });
    toast('تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

// ============================================================
// Self Roles
// ============================================================
async function pageSelfRoles() {
  const roles = await api('/api/selfroles');
  const settings = await api('/api/settings');
  const roleOptions = discordRoles.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🎭 قناة لوحة الرولات</div></div>
      <div class="form-row"><label>القناة</label>${channelSelect(settings.self_roles_channel_id, 'self_roles_channel_id', { types: [0] })}</div>
      <div class="btn-row"><button class="btn-primary" onclick="saveSettings(this)">💾 حفظ</button></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📋 الرولات (${roles.length})</div></div>
      <div class="form-grid">
        <div class="form-row"><label>الرول</label><select id="sr-role">${roleOptions}</select></div>
        <div class="form-row"><label>Label</label><input type="text" id="sr-label"></div>
        <div class="form-row"><label>Emoji ID</label><input type="text" id="sr-emoji"></div>
        <div class="form-row"><label>الوصف</label><input type="text" id="sr-desc"></div>
      </div>
      <div class="btn-row"><button class="btn-success" onclick="addSelfRole()">➕ إضافة</button></div>
      <table class="table" style="margin-top:20px">
        <thead><tr><th>الرول</th><th>Label</th><th>Emoji</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${roles.map((r) => `<tr>
          <td>${escapeHtml(roleName(r.role_id))}</td>
          <td>${escapeHtml(r.label)}</td>
          <td>${r.emoji_id ? `<code>${r.emoji_id}</code>` : '—'}</td>
          <td><span class="badge ${r.enabled ? 'success' : 'muted'}">${r.enabled ? 'مفعّل' : 'معطّل'}</span></td>
          <td><button class="btn-danger" style="padding:5px 10px;font-size:12px" onclick="removeSelfRole(${r.id})">حذف</button></td>
        </tr>`).join('')}</tbody>
      </table>
    </div>`;
  attachSettingListeners();
}

async function addSelfRole() {
  const role_id = $('sr-role').value;
  const label = $('sr-label').value || roleName(role_id);
  const emoji_id = $('sr-emoji').value || null;
  const description = $('sr-desc').value || null;
  if (!role_id) { toast('اختر رولًا', 'error'); return; }
  try {
    await api('/api/selfroles', { method: 'POST', body: JSON.stringify({ role_id, label, emoji_id, description }) });
    toast('تمت الإضافة', 'success'); pageSelfRoles();
  } catch (e) { toast(e.message, 'error'); }
}

async function removeSelfRole(id) {
  if (!(await confirmModal('تأكيد', 'حذف هذا الرول من اللوحة؟'))) return;
  try {
    await api(`/api/selfroles/${id}`, { method: 'DELETE' });
    toast('تم الحذف', 'success'); pageSelfRoles();
  } catch (e) { toast(e.message, 'error'); }
}

// ============================================================
// Movie Night
// ============================================================
async function pageMovie() {
  const data = await api('/api/movie/status');
  const settings = await api('/api/settings');
  const active = data.active;
  const recent = data.recent || [];
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🎬 إعدادات Movie Night</div></div>
      <div class="form-grid">
        <div class="form-row"><label>قناة السينما الصوتية</label>${channelSelect(settings.movie_voice_channel_id, 'movie_voice_channel_id', { types: [2, 13] })}</div>
        <div class="form-row"><label>قناة المراجعات</label>${channelSelect(settings.movie_reviews_channel_id, 'movie_reviews_channel_id', { types: [0] })}</div>
      </div>
      <div class="btn-row"><button class="btn-primary" onclick="saveSettings(this)">💾 حفظ</button></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">🎥 ${active ? 'جلسة نشطة' : 'بدء جلسة'}</div></div>
      ${active ? `
        <div class="grid">
          <div class="card"><div class="label">🎥 الفيلم</div><div class="value" style="font-size:18px">${escapeHtml(active.movie_name)}</div></div>
          <div class="card"><div class="label">👥 المستلمون</div><div class="value">${active.recipientsCount}</div></div>
          <div class="card"><div class="label">⭐ المقيّمون</div><div class="value">${active.stats.count}</div></div>
          <div class="card"><div class="label">📊 المتوسط</div><div class="value">${active.stats.count > 0 ? active.stats.average.toFixed(2) + ' / 5' : '—'}</div></div>
        </div>
        <div class="btn-row"><button class="btn-danger" onclick="closeMovie()">🛑 إغلاق</button></div>
      ` : `
        <div class="form-row"><label>اسم الفيلم</label><input type="text" id="movie-name" placeholder="Interstellar"></div>
        <div class="btn-row"><button class="btn-primary" onclick="startMovie(this)">▶️ بدء</button></div>
      `}
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📅 الجلسات (${recent.length})</div></div>
      ${recent.length === 0 ? '<div class="empty">لا توجد جلسات.</div>' :
      `<table class="table"><thead><tr><th>الفيلم</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>
        ${recent.map((s) => `<tr>
          <td>${escapeHtml(s.movie_name)}</td>
          <td><span class="badge ${s.status === 'open' ? 'success' : 'muted'}">${s.status}</span></td>
          <td>${formatDate(s.started_at)}</td>
        </tr>`).join('')}
      </tbody></table>`}
    </div>`;
  attachSettingListeners();
}

async function startMovie(btn) {
  const name = $('movie-name')?.value?.trim();
  if (!name) { toast('أدخل اسم الفيلم', 'error'); return; }
  if (!(await confirmModal('تأكيد', `بدء "${name}"؟`))) return;
  btn.disabled = true;
  try {
    const res = await api('/api/movie/start', { method: 'POST', body: JSON.stringify({ movie: name }) });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`أُرسل لـ ${res.sent}/${res.total}`, 'success'); pageMovie();
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function closeMovie() {
  if (!(await confirmModal('تأكيد', 'إغلاق الجلسة؟'))) return;
  try {
    await api('/api/movie/close', { method: 'POST' });
    toast('تم الإغلاق', 'success'); pageMovie();
  } catch (e) { toast(e.message, 'error'); }
}

// ============================================================
// Media Show — with all customization + msAddChannel
// ============================================================
async function pageMediaShow() {
  const channels = await api('/api/media/channels');
  const archive = await api('/api/media/archive').catch(() => ({ channelId: null, valid: false, reason: 'unknown' }));
  const storage = await api('/api/media/storage').catch(() => null);
  const allChannels = discordChannels.filter(c => c.type === 0 || c.type === 5);
  const usedIds = new Set(channels.map(c => c.channel_id));
  const available = allChannels.filter(c => !usedIds.has(c.id));

  let archiveCard = '';
  {
    const statusIcon = archive.valid ? '✅' : (archive.channelId ? '⚠️' : '⛔');
    const statusText = archive.valid
      ? `متصل · #${escapeHtml(archive.channelName || '')}`
      : (archive.channelId ? `غير صالح — ${escapeHtml(archive.reason || '')}` : 'غير مضبوط (يستخدم القرص)');
    const permRows = archive.permissions
      ? `<div style="display:flex;gap:12px;flex-wrap:wrap;font-size:12px;margin-top:8px">
          ${['viewChannel','sendMessages','attachFiles','readMessageHistory'].map(k => {
            const ok = archive.permissions[k];
            return `<span class="badge ${ok ? 'success' : 'danger'}">${ok ? '✅' : '❌'} ${k}</span>`;
          }).join('')}
        </div>` : '';
    archiveCard = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">📦 قناة أرشيف الوسائط</div></div>
        <div class="panel-desc" style="margin-bottom:10px">تُخزَّن الصور والفيديوهات الجديدة في هذه القناة بدل تخزينها على القرص.</div>
        <div class="panel-desc" style="font-size:12px;margin-bottom:12px">
          ${statusIcon} <strong>الحالة:</strong> ${statusText}${permRows}
        </div>
        <div class="form-grid">
          <div class="form-row">
            <label>اختر قناة الأرشيف</label>
            <select id="ms-archive-channel">
              <option value="">— بدون (استخدام القرص) —</option>
              ${allChannels.map(c => `<option value="${c.id}" ${archive.channelId === c.id ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="btn-row" style="margin-top:14px">
          <button class="btn-primary" onclick="msSaveArchive(this)">💾 حفظ قناة الأرشيف</button>
        </div>
      </div>`;
  }

  let storageCard = '';
  if (storage && storage.ok) {
    const diskMb = (storage.disk.actualBytes / (1024 * 1024)).toFixed(2);
    storageCard = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">💾 إحصاءات التخزين</div></div>
        <div class="grid">
          <div class="card"><div class="label">📁 على القرص</div><div class="value">${diskMb} MB</div><div class="sub">${storage.disk.actualFiles} ملف · ${storage.disk.posts} منشور</div></div>
          <div class="card"><div class="label">📦 في الأرشيف</div><div class="value">${storage.archive.files}</div><div class="sub">ملف · لا يستهلك VPS</div></div>
          <div class="card"><div class="label">📊 الإجمالي</div><div class="value">${storage.total.dbFiles}</div><div class="sub">ملف · ${storage.total.posts} منشور</div></div>
        </div>
      </div>`;
  }

  contentArea.innerHTML = `
    ${archiveCard}
    ${storageCard}
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📸 إضافة قناة Media Show</div></div>
      <div class="form-grid">
        <div class="form-row">
          <label>القناة</label>
          <select id="ms-add-channel">
            <option value="">— اختر قناة —</option>
            ${available.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="btn-row"><button class="btn-success" onclick="msAddChannel(this)">➕ إضافة قناة</button></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📋 قنوات Media Show (${channels.length})</div></div>
      ${channels.length === 0 ? '<div class="empty">لا توجد قنوات مضافة بعد.</div>' : channels.map(ch => renderMediaChannel(ch)).join('')}
    </div>`;
  attachSettingListeners();
}

async function msSaveArchive(btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '...';
  try {
    const sel = $('ms-archive-channel');
    const channelId = sel?.value || '';
    await api('/api/media/archive', { method: 'POST', body: JSON.stringify({ channelId }) });
    toast('✅ تم حفظ قناة الأرشيف', 'success');
    pageMediaShow();
  } catch (e) {
    toast('❌ ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
}

async function msAddChannel(btn) {
  const sel = $('ms-add-channel');
  const id = sel?.value;
  if (!id) { toast('اختر قناة', 'error'); return; }
  btn.disabled = true;
  try {
    await api('/api/media/channels', { method: 'POST', body: JSON.stringify({ channelId: id }) });
    toast('✅ تم إضافة القناة', 'success');
    pageMediaShow();
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function msToggle(id, enabled) {
  try {
    await api(`/api/media/channels/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
    toast(enabled ? '✅ مفعّل' : '⏸️ معطّل', 'success');
    pageMediaShow();
  } catch (e) { toast(e.message, 'error'); }
}

async function msRemove(id) {
  if (!(await confirmModal('تأكيد', 'حذف هذه القناة؟'))) return;
  try {
    await api(`/api/media/channels/${id}`, { method: 'DELETE' });
    toast('تم الحذف', 'success');
    pageMediaShow();
  } catch (e) { toast(e.message, 'error'); }
}

async function msSave(channelId, btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '...';
  try {
    const values = {};
    document.querySelectorAll(`[data-ms-ch="${channelId}"][data-ms-field]`).forEach(el => {
      const key = el.dataset.msField;
      if (el.type === 'checkbox') values[key] = el.checked ? 1 : 0;
      else values[key] = el.value;
    });
    const emojiFields = [
      'author_emoji', 'reaction_emoji', 'comment_emoji', 'delete_emoji', 'viewall_emoji', 'share_emoji',
      'share_title_emoji', 'share_confirm_emoji', 'share_cancel_emoji',
      'button_open_post_emoji', 'viewall_prev_emoji', 'viewall_next_emoji',
    ];
    const looksInvalid = (v) => {
      if (!v || !v.trim()) return false;
      const t = v.trim();
      if (/^<a?:\w+:\d{17,20}>$/.test(t)) return false;
      if (/^\d{17,20}$/.test(t)) return false;
      return !/\p{Extended_Pictographic}/u.test(t) && !/[\u{1F1E6}-\u{1F1FF}]/u.test(t);
    };
    const badFields = emojiFields.filter(f => looksInvalid(values[f]));
    if (badFields.length > 0) {
      toast(`⚠️ حقول إيموجي مشبوهة: ${badFields.join(', ')} — ستُستبدل بالافتراضي`, 'info');
    }
    await api(`/api/media/channels/${channelId}`, { method: 'PUT', body: JSON.stringify(values) });
    toast('✅ تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

function renderMediaChannel(ch) {
  const chInfo = discordChannels.find(c => c.id === ch.channel_id);
  const name = chInfo ? `#${chInfo.name}` : ch.channel_id;
  const enabled = ch.enabled === 1;
  const authorEmoji = ch.author_emoji ?? '';
  const reactionEmoji = ch.reaction_emoji ?? '🎃';
  const commentEmoji = ch.comment_emoji ?? '💬';
  const deleteEmoji = ch.delete_emoji ?? '🗑️';
  const viewallEmoji = ch.viewall_emoji ?? '👥';
  const shareEmoji = ch.share_emoji ?? '📤';

  // Share interface
  const shareTitle = ch.share_title ?? 'مشاركة المنشور';
  const shareHint = ch.share_hint ?? 'اختر المستلمين ثم اضغط تأكيد.';
  const shareNote = ch.share_note ?? 'سيتم إرسال المنشور إلى المستلمين المحددين عبر رسالة خاصة.';
  const shareSelectPlaceholder = ch.share_select_placeholder ?? 'اختر مستلمًا أو أكثر...';
  const shareConfirmLabel = ch.share_confirm_label ?? 'تأكيد الإرسال';
  const shareCancelLabel = ch.share_cancel_label ?? 'إلغاء';
  const shareTitleEmoji = ch.share_title_emoji ?? '📤';
  const shareConfirmEmoji = ch.share_confirm_emoji ?? '✅';
  const shareCancelEmoji = ch.share_cancel_emoji ?? '❌';
  const shareColor = ch.share_color ?? '#f59e0b';
  const shareDmTitle = ch.share_dm_title ?? '📤 تمت مشاركة منشور معك';
  const shareSuccessMsg = ch.share_success_msg ?? '✅ تم الإرسال';
  const sharePartialMsg = ch.share_partial_msg ?? '⚠️ تعذّر إرسال رسالة خاصة إلى بعض المستلمين';
  const shareNoneMsg = ch.share_none_msg ?? '⚠️ لم تختر مستلمين';

  // View All buttons
  const btnOpenPostEmoji = ch.button_open_post_emoji ?? '🎃';
  const viewallPrevLabel = ch.viewall_prev_label ?? '';
  const viewallPrevEmoji = ch.viewall_prev_emoji ?? '◀️';
  const viewallNextLabel = ch.viewall_next_label ?? '';
  const viewallNextEmoji = ch.viewall_next_emoji ?? '▶️';

  return `
    <div class="panel" style="background:var(--bg-elev-2); margin-bottom:14px">
      <div class="panel-header" style="margin-bottom:14px">
        <div class="panel-title" style="font-size:15px">${enabled ? '✅' : '⏸️'} ${escapeHtml(name)}</div>
        <div class="btn-row" style="margin:0">
          <button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="msToggle('${ch.channel_id}', ${enabled ? 0 : 1})">${enabled ? '⏸️ إيقاف' : '▶️ تفعيل'}</button>
          <button class="btn-danger" style="padding:5px 10px;font-size:12px" onclick="msRemove('${ch.channel_id}')">🗑️ حذف</button>
        </div>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>عنوان المنشور (يدعم {user})</label><input type="text" value="${escapeHtml(ch.title_format)}" data-ms-field="title_format" data-ms-ch="${ch.channel_id}"></div>
        <div class="form-row"><label>لون الـ Embed</label><input type="color" value="${escapeHtml(ch.color)}" data-ms-field="color" data-ms-ch="${ch.channel_id}"></div>
        <div class="form-row"><label>بادئة المتفاعلين</label><input type="text" value="${escapeHtml(ch.footer_from_label)}" data-ms-field="footer_from_label" data-ms-ch="${ch.channel_id}"></div>
        <div class="form-row"><label>نص "و N آخرين"</label><input type="text" value="${escapeHtml(ch.footer_others_label)}" data-ms-field="footer_others_label" data-ms-ch="${ch.channel_id}"></div>
        <div class="form-row"><label>اسم Thread</label><input type="text" value="${escapeHtml(ch.thread_name_format)}" data-ms-field="thread_name_format" data-ms-ch="${ch.channel_id}"></div>
      </div>

      <div class="panel" style="background:var(--bg-elev); margin-top:14px; padding:14px; border-radius:10px">
        <div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:6px">🎨 تخصيص الإيموجيات</div>
        <div class="panel-desc" style="margin:0 0 12px; font-size:11px; color:var(--text-mute)">
          كل حقل يقبل: إيموجي Unicode واحد · <code>&lt;:name:id&gt;</code> · أو ID نقي. القيم غير الصالحة تُستبدل بالافتراضي.
        </div>
        <div class="form-grid">
          <div class="form-row"><label>إيموجي اسم الناشر</label><input type="text" value="${escapeHtml(authorEmoji)}" data-ms-field="author_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="🎃"></div>
          <div class="form-row"><label>إيموجي زر التفاعل</label><input type="text" value="${escapeHtml(reactionEmoji)}" data-ms-field="reaction_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="🎃"></div>
          <div class="form-row"><label>إيموجي زر التعليق</label><input type="text" value="${escapeHtml(commentEmoji)}" data-ms-field="comment_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="💬"></div>
          <div class="form-row"><label>إيموجي زر الحذف</label><input type="text" value="${escapeHtml(deleteEmoji)}" data-ms-field="delete_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="🗑️"></div>
          <div class="form-row"><label>إيموجي زر View All</label><input type="text" value="${escapeHtml(viewallEmoji)}" data-ms-field="viewall_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="👥"></div>
          <div class="form-row"><label>إيموجي زر المشاركة</label><input type="text" value="${escapeHtml(shareEmoji)}" data-ms-field="share_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="📤"></div>
        </div>
      </div>

      <div class="panel" style="background:var(--bg-elev); margin-top:14px; padding:14px; border-radius:10px">
        <div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:6px">📤 تخصيص واجهة المشاركة</div>
        <div class="form-grid">
          <div class="form-row"><label>العنوان</label><input type="text" value="${escapeHtml(shareTitle)}" data-ms-field="share_title" data-ms-ch="${ch.channel_id}" maxlength="150"></div>
          <div class="form-row"><label>النص التوضيحي</label><input type="text" value="${escapeHtml(shareHint)}" data-ms-field="share_hint" data-ms-ch="${ch.channel_id}" maxlength="300"></div>
          <div class="form-row"><label>Placeholder القائمة</label><input type="text" value="${escapeHtml(shareSelectPlaceholder)}" data-ms-field="share_select_placeholder" data-ms-ch="${ch.channel_id}" maxlength="100"></div>
          <div class="form-row"><label>نص زر التأكيد</label><input type="text" value="${escapeHtml(shareConfirmLabel)}" data-ms-field="share_confirm_label" data-ms-ch="${ch.channel_id}" maxlength="80"></div>
          <div class="form-row"><label>نص زر الإلغاء</label><input type="text" value="${escapeHtml(shareCancelLabel)}" data-ms-field="share_cancel_label" data-ms-ch="${ch.channel_id}" maxlength="80"></div>
          <div class="form-row"><label>إيموجي العنوان</label><input type="text" value="${escapeHtml(shareTitleEmoji)}" data-ms-field="share_title_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="📤"></div>
          <div class="form-row"><label>إيموجي التأكيد</label><input type="text" value="${escapeHtml(shareConfirmEmoji)}" data-ms-field="share_confirm_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="✅"></div>
          <div class="form-row"><label>إيموجي الإلغاء</label><input type="text" value="${escapeHtml(shareCancelEmoji)}" data-ms-field="share_cancel_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="❌"></div>
          <div class="form-row"><label>لون واجهة المشاركة</label><input type="color" value="${escapeHtml(shareColor)}" data-ms-field="share_color" data-ms-ch="${ch.channel_id}"></div>
          <div class="form-row"><label>عنوان الـ DM</label><input type="text" value="${escapeHtml(shareDmTitle)}" data-ms-field="share_dm_title" data-ms-ch="${ch.channel_id}" maxlength="150"></div>
          <div class="form-row"><label>رسالة النجاح</label><input type="text" value="${escapeHtml(shareSuccessMsg)}" data-ms-field="share_success_msg" data-ms-ch="${ch.channel_id}" maxlength="200"></div>
          <div class="form-row"><label>رسالة الفشل الجزئي</label><input type="text" value="${escapeHtml(sharePartialMsg)}" data-ms-field="share_partial_msg" data-ms-ch="${ch.channel_id}" maxlength="200"></div>
          <div class="form-row"><label>رسالة عدم الاختيار</label><input type="text" value="${escapeHtml(shareNoneMsg)}" data-ms-field="share_none_msg" data-ms-ch="${ch.channel_id}" maxlength="200"></div>
        </div>
      </div>

      <div class="panel" style="background:var(--bg-elev); margin-top:14px; padding:14px; border-radius:10px">
        <div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:6px">👁️ تخصيص أزرار View All</div>
        <div class="panel-desc" style="margin:0 0 12px; font-size:11px; color:var(--text-mute)">اترك الـ Label فارغًا لاستخدام الإيموجي فقط.</div>
        <div class="form-grid">
          <div class="form-row"><label>زر View All — النص</label><input type="text" value="${escapeHtml(ch.button_view_all_label)}" data-ms-field="button_view_all_label" data-ms-ch="${ch.channel_id}" maxlength="80"></div>
          <div class="form-row"><label>زر فتح المنشور — النص</label><input type="text" value="${escapeHtml(ch.button_open_post_label)}" data-ms-field="button_open_post_label" data-ms-ch="${ch.channel_id}" maxlength="80"></div>
          <div class="form-row"><label>زر فتح المنشور — الإيموجي</label><input type="text" value="${escapeHtml(btnOpenPostEmoji)}" data-ms-field="button_open_post_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="🎃"></div>
          <div class="form-row"><label>زر السابق — النص</label><input type="text" value="${escapeHtml(viewallPrevLabel)}" data-ms-field="viewall_prev_label" data-ms-ch="${ch.channel_id}" maxlength="80"></div>
          <div class="form-row"><label>زر السابق — الإيموجي</label><input type="text" value="${escapeHtml(viewallPrevEmoji)}" data-ms-field="viewall_prev_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="◀️"></div>
          <div class="form-row"><label>زر التالي — النص</label><input type="text" value="${escapeHtml(viewallNextLabel)}" data-ms-field="viewall_next_label" data-ms-ch="${ch.channel_id}" maxlength="80"></div>
          <div class="form-row"><label>زر التالي — الإيموجي</label><input type="text" value="${escapeHtml(viewallNextEmoji)}" data-ms-field="viewall_next_emoji" data-ms-ch="${ch.channel_id}" maxlength="100" placeholder="▶️"></div>
        </div>
      </div>

      <div class="form-grid" style="margin-top:12px">
        <div class="form-row"><label>سماح الإدارة بالتعديل</label><label class="switch"><input type="checkbox" ${ch.allow_admin_edit ? 'checked' : ''} data-ms-field="allow_admin_edit" data-ms-ch="${ch.channel_id}" data-type="bool"><span class="track"></span><span class="label-text">${ch.allow_admin_edit ? 'مفعّل' : 'معطّل'}</span></label></div>
        <div class="form-row"><label>سماح الإدارة بالحذف</label><label class="switch"><input type="checkbox" ${ch.allow_admin_delete ? 'checked' : ''} data-ms-field="allow_admin_delete" data-ms-ch="${ch.channel_id}" data-type="bool"><span class="track"></span><span class="label-text">${ch.allow_admin_delete ? 'مفعّل' : 'معطّل'}</span></label></div>
        <div class="form-row"><label>تجاهل البوتات</label><label class="switch"><input type="checkbox" ${ch.ignore_bots ? 'checked' : ''} data-ms-field="ignore_bots" data-ms-ch="${ch.channel_id}" data-type="bool"><span class="track"></span><span class="label-text">${ch.ignore_bots ? 'مفعّل' : 'معطّل'}</span></label></div>
      </div>
      <div class="btn-row" style="margin-top:14px"><button class="btn-primary" onclick="msSave('${ch.channel_id}', this)">💾 حفظ</button></div>
    </div>`;
}

// ============================================================
// Support
// ============================================================
async function pageSupport() {
  const settings = await api('/api/support/settings');
  const tickets = await api('/api/support/tickets').catch(() => []);
  const suggestions = await api('/api/support/suggestions').catch(() => []);
  const cfg = (k) => settings[k] ?? '';
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">🎫 Support Center (V2)</div>
        <button class="btn-primary" onclick="supportPublish(this)">📤 نشر/تحديث اللوحة</button>
      </div>
      <div class="form-grid">
        <div class="form-row"><label>الحالة</label><label class="switch"><input type="checkbox" id="sup-enabled" ${cfg('support_enabled') === 'true' ? 'checked' : ''}><span class="track"></span><span class="label-text">${cfg('support_enabled') === 'true' ? 'مفعّل' : 'معطّل'}</span></label></div>
        <div class="form-row"><label>قناة اللوحة</label>${channelSelect(cfg('support_panel_channel'), 'support_panel_channel', { types: [0] })}</div>
        <div class="form-row"><label>فئة التذاكر</label>${channelSelect(cfg('support_ticket_category'), 'support_ticket_category', { types: [4] })}</div>
        <div class="form-row"><label>قناة الاقتراحات</label>${channelSelect(cfg('support_suggestions_channel'), 'support_suggestions_channel', { types: [0] })}</div>
        <div class="form-row"><label>قناة الأرشفة</label>${channelSelect(cfg('support_transcript_channel'), 'support_transcript_channel', { types: [0] })}</div>
        <div class="form-row"><label>رول الإدارة</label><select data-setting="support_admin_role">
          <option value="">— بدون —</option>
          ${discordRoles.map(r => `<option value="${r.id}" ${cfg('support_admin_role') === r.id ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('')}
        </select></div>
        <div class="form-row"><label>الحد الأقصى للتذاكر</label><input type="number" id="sup-max" value="${cfg('support_max_open_per_user') || '3'}"></div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="form-row"><label>عنوان اللوحة</label><input type="text" id="sup-title" value="${escapeHtml(cfg('support_title'))}"></div>
        <div class="form-row"><label>لون اللوحة</label><input type="color" id="sup-color" value="${cfg('support_color') || '#5865f2'}"></div>
      </div>
      <div class="form-row"><label>وصف اللوحة</label><textarea id="sup-desc" rows="4">${escapeHtml(cfg('support_description'))}</textarea></div>
      <div class="panel" style="background:var(--bg-elev-2); margin-top:14px; padding:14px; border-radius:10px">
        <div style="font-size:13px; font-weight:600; color:#fff; margin-bottom:12px">🎯 نص قائمة الخدمات</div>
        <div class="form-grid">
          <div class="form-row"><label>نص Placeholder</label><input type="text" id="sup-placeholder-text" value="${escapeHtml(cfg('support_select_placeholder'))}" maxlength="150"></div>
          <div class="form-row"><label>الإيموجي البادئ</label><input type="text" id="sup-placeholder-emoji" value="${escapeHtml(cfg('support_select_placeholder_emoji'))}" maxlength="40"></div>
        </div>
      </div>
      <div class="form-grid" style="margin-top:14px">
        <div class="form-row"><label>Support — Label</label><input type="text" id="sup-opt-sup-label" value="${escapeHtml(cfg('support_option_support_label'))}"></div>
        <div class="form-row"><label>Support — Emoji</label><input type="text" id="sup-opt-sup-emoji" value="${escapeHtml(cfg('support_option_support_emoji'))}"></div>
        <div class="form-row"><label>Suggestions — Label</label><input type="text" id="sup-opt-sg-label" value="${escapeHtml(cfg('support_option_suggestion_label'))}"></div>
        <div class="form-row"><label>Suggestions — Emoji</label><input type="text" id="sup-opt-sg-emoji" value="${escapeHtml(cfg('support_option_suggestion_emoji'))}"></div>
      </div>
      <div class="btn-row"><button class="btn-primary" onclick="supportSave(this)">💾 حفظ الإعدادات</button></div>
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📋 التذاكر (${tickets.length})</div></div>
      ${tickets.length === 0 ? '<div class="empty">لا توجد تذاكر.</div>' :
      `<table class="table">
        <thead><tr><th>#</th><th>صاحبها</th><th>الموضوع</th><th>الحالة</th><th>أرشفة</th><th>التاريخ</th></tr></thead>
        <tbody>${tickets.slice(0, 40).map(t => `<tr>
          <td><code>#${t.number}</code></td><td><code>${t.user_id}</code></td>
          <td>${escapeHtml(t.subject)}</td>
          <td><span class="badge ${t.status === 'open' ? 'success' : 'muted'}">${t.status}</span></td>
          <td>${t.transcript_sent ? '<span class="badge success">✅</span>' : '<span class="badge muted">—</span>'}</td>
          <td>${formatDate(t.created_at)}</td>
        </tr>`).join('')}</tbody></table>`}
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">💡 الاقتراحات (${suggestions.length})</div></div>
      ${suggestions.length === 0 ? '<div class="empty">لا توجد اقتراحات.</div>' :
      `<table class="table">
        <thead><tr><th>#</th><th>العنوان</th><th>الحالة</th><th>👍/👎</th><th>التاريخ</th></tr></thead>
        <tbody>${suggestions.slice(0, 40).map(s => `<tr>
          <td><code>#${s.id}</code></td><td>${escapeHtml(s.title)}</td>
          <td><span class="badge ${s.status === 'approved' ? 'success' : s.status === 'rejected' ? 'danger' : 'warn'}">${s.status}</span></td>
          <td>${s.votes.up} / ${s.votes.down}</td>
          <td>${formatDate(s.created_at)}</td>
        </tr>`).join('')}</tbody></table>`}
    </div>`;
  attachSettingListeners();
}

async function supportSave(btn) {
  btn.disabled = true;
  try {
    const values = {
      support_enabled: $('sup-enabled').checked ? 'true' : 'false',
      support_panel_channel: document.querySelector('[data-setting="support_panel_channel"]').value,
      support_ticket_category: document.querySelector('[data-setting="support_ticket_category"]').value,
      support_suggestions_channel: document.querySelector('[data-setting="support_suggestions_channel"]').value,
      support_transcript_channel: document.querySelector('[data-setting="support_transcript_channel"]').value,
      support_admin_role: document.querySelector('[data-setting="support_admin_role"]').value,
      support_max_open_per_user: $('sup-max').value,
      support_title: $('sup-title').value,
      support_description: $('sup-desc').value,
      support_color: $('sup-color').value,
      support_select_placeholder: ($('sup-placeholder-text')?.value ?? '').trim(),
      support_select_placeholder_emoji: ($('sup-placeholder-emoji')?.value ?? '').trim(),
      support_option_support_label: $('sup-opt-sup-label').value,
      support_option_support_emoji: $('sup-opt-sup-emoji').value,
      support_option_suggestion_label: $('sup-opt-sg-label').value,
      support_option_suggestion_emoji: $('sup-opt-sg-emoji').value,
    };
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ values }) });
    toast('تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; }
}

async function supportPublish(btn) {
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await api('/api/support/publish', { method: 'POST' });
    if (res.ok) toast('✅ تم نشر اللوحة', 'success');
    else toast(res.error || 'فشل', 'error');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '📤 نشر/تحديث اللوحة'; }
}

// ============================================================
// Text Customizer
// ============================================================
let textRegistryState = { texts: [], categories: [], colors: [], filter: 'all', search: '', editBuffer: {}, diagnostics: null, loadingError: null };

async function pageTexts() {
  contentArea.innerHTML = '<div class="loader">جارٍ تحميل النصوص...</div>';
  textRegistryState.loadingError = null;
  try {
    const data = await api('/api/texts/registry');
    textRegistryState.texts = Array.isArray(data.texts) ? data.texts : [];
    textRegistryState.categories = Array.isArray(data.categories) ? data.categories : [];
    textRegistryState.colors = Array.isArray(data.colors) ? data.colors : [];
    textRegistryState.diagnostics = data.diagnostics || null;
    textRegistryState.editBuffer = {};
    contentArea.innerHTML = renderTextsPage();
    attachTextsListeners();
  } catch (e) {
    contentArea.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">✏️ Text Customizer</div></div>
        <div class="panel-desc" style="color:#ef4444">❌ فشل: <code>${escapeHtml(e.message)}</code></div>
        <div class="btn-row"><button class="btn-primary" onclick="pageTexts()">🔄 إعادة المحاولة</button></div>
      </div>`;
  }
}

function renderTextsPage() {
  const { texts, categories, colors, filter, search, diagnostics } = textRegistryState;
  let filtered = [...texts];
  if (filter !== 'all') filtered = filtered.filter(t => t.category === filter);
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(t =>
      t.key.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.defaultValue || '').toLowerCase().includes(q) ||
      (t.currentValue || '').toLowerCase().includes(q)
    );
  }
  const customized = texts.filter(t => t.isCustomized).length;
  return `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">✏️ Text Customizer</div>
        <div class="btn-row" style="margin:0">
          <input type="text" id="text-search" placeholder="🔍 بحث..." value="${escapeHtml(search)}" style="min-width:200px">
          <select id="text-filter">
            <option value="all" ${filter === 'all' ? 'selected' : ''}>جميع الفئات</option>
            ${categories.map(c => `<option value="${c}" ${filter === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}
          </select>
          <button class="btn-secondary" onclick="pageTexts()">🔄</button>
        </div>
      </div>
      <div class="panel-desc">📝 <strong>${texts.length}</strong> نص · <strong>${customized}</strong> مُخصَّص · <strong>${colors.length}</strong> لون</div>
      ${colors.length > 0 ? `
        <div class="panel" style="background:var(--bg-elev); margin-top:14px; padding:14px; border-radius:10px">
          <div style="font-size:14px; font-weight:600; color:#fff; margin-bottom:12px">🎨 ألوان Container</div>
          <div class="form-grid">
            ${colors.map(c => `
              <div class="form-row">
                <label>${escapeHtml(c.description)} <small style="color:#8e8e8e">(${escapeHtml(c.key)})</small></label>
                <div style="display:flex;gap:8px;align-items:center">
                  <input type="color" value="${c.currentValue}" data-color-key="${c.key}" style="width:60px;height:36px">
                  <input type="text" value="${c.currentValue}" data-color-text="${c.key}" style="flex:1">
                  <button class="btn-success" style="padding:5px 10px;font-size:12px" onclick="saveColor('${c.key}')">💾</button>
                  <button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="resetColorKey('${c.key}')">↺</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
    </div>
    <div class="panel">
      <div class="panel-header"><div class="panel-title">📋 النصوص (${filtered.length})</div></div>
      ${filtered.length === 0 ? `<div class="empty">لا توجد نصوص مطابقة.</div>` : `
        <table class="table">
          <thead><tr><th>المفتاح</th><th>الوصف</th><th>القيمة</th><th>المتغيرات</th><th>الحالة</th><th></th></tr></thead>
          <tbody>${filtered.map(t => {
            const value = textRegistryState.editBuffer[t.key] ?? t.currentValue;
            const isLong = value.includes('\n') || value.length > 80;
            return `
              <tr>
                <td><code style="font-size:11px">${escapeHtml(t.key)}</code></td>
                <td style="font-size:12px">${escapeHtml(t.description || '—')}</td>
                <td style="min-width:280px">${isLong
                  ? `<textarea data-text-key="${escapeHtml(t.key)}" rows="3" style="width:100%">${escapeHtml(value)}</textarea>`
                  : `<input type="text" value="${escapeHtml(value)}" data-text-key="${escapeHtml(t.key)}" style="width:100%">`}</td>
                <td style="font-size:11px">${(t.variables || []).length > 0 ? (t.variables || []).map(v => `<code>{${escapeHtml(v)}}</code>`).join(' ') : '—'}</td>
                <td>${t.isCustomized ? '<span class="badge success">مُخصَّص</span>' : '<span class="badge muted">افتراضي</span>'}</td>
                <td style="white-space:nowrap">
                  <button class="btn-success" style="padding:5px 10px;font-size:12px" onclick="saveTextKey('${escapeHtml(t.key)}')">💾</button>
                  <button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="resetTextKey('${escapeHtml(t.key)}')">↺</button>
                </td>
              </tr>`;
          }).join('')}</tbody>
        </table>`}
    </div>`;
}

function attachTextsListeners() {
  const search = $('text-search');
  if (search) search.addEventListener('input', (e) => {
    textRegistryState.search = e.target.value;
    clearTimeout(window.__textsDebounce);
    window.__textsDebounce = setTimeout(() => {
      contentArea.innerHTML = renderTextsPage(); attachTextsListeners();
    }, 300);
  });
  const filter = $('text-filter');
  if (filter) filter.addEventListener('change', (e) => {
    textRegistryState.filter = e.target.value;
    contentArea.innerHTML = renderTextsPage(); attachTextsListeners();
  });
  document.querySelectorAll('[data-text-key]').forEach(el => {
    el.addEventListener('input', (e) => { textRegistryState.editBuffer[e.target.dataset.textKey] = e.target.value; });
  });
  document.querySelectorAll('[data-color-key]').forEach(el => {
    el.addEventListener('input', (e) => {
      const key = e.target.dataset.colorKey;
      const textEl = document.querySelector(`[data-color-text="${key}"]`);
      if (textEl) textEl.value = e.target.value;
    });
  });
}

async function saveTextKey(key) {
  const input = document.querySelector(`[data-text-key="${key}"]`);
  if (!input) return;
  try {
    await api('/api/texts/registry/save', { method: 'POST', body: JSON.stringify({ key, value: input.value }) });
    toast('✅ تم الحفظ', 'success');
    delete textRegistryState.editBuffer[key];
    pageTexts();
  } catch (e) { toast(e.message, 'error'); }
}

async function resetTextKey(key) {
  if (!(await confirmModal('تأكيد', 'إعادة هذا النص إلى القيمة الافتراضية؟'))) return;
  try {
    await api('/api/texts/registry/reset', { method: 'POST', body: JSON.stringify({ key }) });
    toast('✅ تمت الاستعادة', 'success'); pageTexts();
  } catch (e) { toast(e.message, 'error'); }
}

async function saveColor(key) {
  const textInput = document.querySelector(`[data-color-text="${key}"]`);
  if (!textInput) return;
  const value = textInput.value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) { toast('صيغة اللون غير صحيحة', 'error'); return; }
  try {
    await api('/api/texts/registry/color', { method: 'POST', body: JSON.stringify({ key, value }) });
    toast('✅ تم حفظ اللون', 'success'); pageTexts();
  } catch (e) { toast(e.message, 'error'); }
}

async function resetColorKey(key) {
  if (!(await confirmModal('تأكيد', 'إعادة اللون إلى الافتراضي؟'))) return;
  try {
    await api('/api/texts/registry/color/reset', { method: 'POST', body: JSON.stringify({ key }) });
    toast('✅ تمت الاستعادة', 'success'); pageTexts();
  } catch (e) { toast(e.message, 'error'); }
}

// ============================================================
// Emoji Manager
// ============================================================
async function pageEmojis() {
  const list = await api('/api/emojis');
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">😀 إدارة الإيموجيات</div>
        <button class="btn-secondary" onclick="resetAllEmojis()">↺ استعادة الكل</button>
      </div>
      <table class="table">
        <thead><tr><th>المعاينة</th><th>المفتاح</th><th>الوصف</th><th>القيمة</th><th></th></tr></thead>
        <tbody>${list.map(e => `
          <tr>
            <td style="font-size:22px">${escapeHtml(e.resolved || e.value)}</td>
            <td><code>${escapeHtml(e.key)}</code></td>
            <td>${escapeHtml(e.description || '—')}</td>
            <td><input type="text" value="${escapeHtml(e.value)}" data-emoji-key="${escapeHtml(e.key)}" style="min-width:200px"></td>
            <td>
              <button class="btn-success" style="padding:5px 10px;font-size:12px" onclick="saveEmoji('${escapeHtml(e.key)}')">حفظ</button>
              <button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="resetEmoji('${escapeHtml(e.key)}')">↺</button>
            </td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`;
}

async function saveEmoji(key) {
  const input = document.querySelector(`[data-emoji-key="${key}"]`);
  if (!input) return;
  try {
    await api(`/api/emojis/${key}`, { method: 'POST', body: JSON.stringify({ value: input.value }) });
    toast('تم الحفظ', 'success'); pageEmojis();
  } catch (e) { toast(e.message, 'error'); }
}

async function resetEmoji(key) {
  try {
    await api(`/api/emojis/${key}/reset`, { method: 'POST' });
    toast('تمت الاستعادة', 'success'); pageEmojis();
  } catch (e) { toast(e.message, 'error'); }
}

async function resetAllEmojis() {
  if (!(await confirmModal('تأكيد', 'استعادة جميع الإيموجيات الافتراضية؟'))) return;
  try {
    await api('/api/emojis/reset-all', { method: 'POST' });
    toast('تمت الاستعادة', 'success'); pageEmojis();
  } catch (e) { toast(e.message, 'error'); }
}

// ============================================================
// Message Builder (Classic + V2 Support)
// ============================================================
let builderState = { 
  mode: 'classic',
  content: '', 
  embeds: [], 
  buttons: [], 
  v2Components: [],
  channelId: '' 
};

async function pageBuilder() {
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header">
        <div class="panel-title">🛠️ Message Builder</div>
        <div class="btn-row" style="margin:0">
          <button class="btn-secondary" onclick="mbLoadDrafts()">📁 المسودات</button>
          <button class="btn-secondary" onclick="mbImportJSON()">⬆️ استيراد</button>
          <button class="btn-secondary" onclick="mbExportJSON()">⬇️ تصدير</button>
        </div>
      </div>
      
      <div class="form-row" style="margin-bottom: 20px;">
        <label>نمط الرسالة (Mode)</label>
        <select id="mb-mode" onchange="mbSetMode(this.value)" style="max-width: 300px;">
          <option value="classic" ${builderState.mode === 'classic' ? 'selected' : ''}>Classic (Embeds & Buttons)</option>
          <option value="v2" ${builderState.mode === 'v2' ? 'selected' : ''}>Components V2 (Modern UI)</option>
        </select>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items:start">
        <div>
          <div class="form-row"><label>القناة</label><select id="mb-channel">${discordChannels.filter(c=>c.type===0||c.type===5).map(c=>`<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('')}</select></div>
          
          <div id="mb-classic-editor" style="display: ${builderState.mode === 'classic' ? 'block' : 'none'};">
            <div class="form-row"><label>المحتوى (Content)</label><textarea id="mb-content" rows="4" oninput="mbUpdate('content', this.value)">${escapeHtml(builderState.content)}</textarea></div>
            <div class="form-row"><label>Allowed Mentions</label><label class="switch"><input type="checkbox" id="mb-allow-everyone"><span class="track"></span><span class="label-text">السماح بـ @everyone</span></label></div>
            
            <div class="panel" style="background:var(--bg-elev-2); margin-top:14px">
              <div class="panel-header" style="margin-bottom:10px"><div class="panel-title" style="font-size:14px">Embeds</div><button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="mbAddEmbed()">+ إضافة</button></div>
              <div id="mb-embeds-list"></div>
            </div>

            <div class="panel" style="background:var(--bg-elev-2); margin-top:14px">
              <div class="panel-header" style="margin-bottom:10px"><div class="panel-title" style="font-size:14px">Buttons</div><button class="btn-secondary" style="padding:5px 10px;font-size:12px" onclick="mbAddButton()">+ إضافة</button></div>
              <div id="mb-buttons-list"></div>
            </div>
          </div>

          <div id="mb-v2-editor" style="display: ${builderState.mode === 'v2' ? 'block' : 'none'};">
            <div class="panel" style="background:var(--bg-elev-2); margin-bottom:14px">
              <div class="panel-header" style="margin-bottom:10px"><div class="panel-title" style="font-size:14px">إضافة عنصر (V2)</div></div>
              <div class="btn-row" style="margin-top:0">
                <button class="btn-secondary" onclick="mbAddV2('text')">+ نص / عنوان</button>
                <button class="btn-secondary" onclick="mbAddV2('separator')">+ فاصل (Separator)</button>
                <button class="btn-secondary" onclick="mbAddV2('section')">+ قسم مع صورة (Section)</button>
                <button class="btn-secondary" onclick="mbAddV2('gallery')">+ معرض صور (Gallery)</button>
              </div>
            </div>
            <div id="mb-v2-list"></div>
          </div>

          <div class="btn-row" style="margin-top:20px">
            <button class="btn-primary" onclick="mbSend(this)">📤 إرسال</button>
            <button class="btn-secondary" onclick="mbSaveDraft()">💾 حفظ كمسودة</button>
            <button class="btn-danger" onclick="mbReset()">🗑️ مسح</button>
          </div>
        </div>
        
        <div>
          <div class="panel-header"><div class="panel-title">👁️ المعاينة الحية</div></div>
          <div id="mb-preview" style="background:#1e1f22; border-radius:8px; padding:16px; min-height:400px; display:flex; flex-direction:column; gap:8px;"></div>
        </div>
      </div>
    </div>`;
  
  $('mb-channel').addEventListener('change', (e) => { builderState.channelId = e.target.value; });
  builderState.channelId = $('mb-channel').value || '';
  
  if (builderState.mode === 'classic') {
    renderBuilderEmbeds(); 
    renderBuilderButtons();
  } else {
    renderBuilderV2();
  }
  renderBuilderPreview();
}

function mbSetMode(mode) {
  builderState.mode = mode;
  $('mb-classic-editor').style.display = mode === 'classic' ? 'block' : 'none';
  $('mb-v2-editor').style.display = mode === 'v2' ? 'block' : 'none';
  if (mode === 'classic') { renderBuilderEmbeds(); renderBuilderButtons(); }
  else { renderBuilderV2(); }
  renderBuilderPreview();
}

// ===== V2 Functions =====
function mbAddV2(type) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2,5);
  if (type === 'text') builderState.v2Components.push({ id, type, content: 'نص جديد...' });
  if (type === 'separator') builderState.v2Components.push({ id, type, divider: true, spacing: 'small' });
  if (type === 'section') builderState.v2Components.push({ id, type, content: 'عنوان القسم', accessoryUrl: '' });
  if (type === 'gallery') builderState.v2Components.push({ id, type, imageUrls: '' });
  renderBuilderV2(); renderBuilderPreview();
}

function mbMoveV2(id, dir) {
  const idx = builderState.v2Components.findIndex(c => c.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= builderState.v2Components.length) return;
  const temp = builderState.v2Components[idx];
  builderState.v2Components[idx] = builderState.v2Components[newIdx];
  builderState.v2Components[newIdx] = temp;
  renderBuilderV2(); renderBuilderPreview();
}

function mbRemoveV2(id) {
  builderState.v2Components = builderState.v2Components.filter(c => c.id !== id);
  renderBuilderV2(); renderBuilderPreview();
}

function mbUpdateV2(id, field, value) {
  const c = builderState.v2Components.find(x => x.id === id);
  if (c) { c[field] = value; renderBuilderPreview(); }
}

function renderBuilderV2() {
  const box = $('mb-v2-list');
  if (!box) return;
  if (builderState.v2Components.length === 0) {
    box.innerHTML = '<div class="empty">لا توجد عناصر. أضف نصاً أو فاصلاً للبدء.</div>';
    return;
  }
  
  box.innerHTML = builderState.v2Components.map((c, i) => {
    let innerHtml = '';
    if (c.type === 'text') {
      innerHtml = `<textarea rows="3" style="width:100%" oninput="mbUpdateV2('${c.id}', 'content', this.value)">${escapeHtml(c.content||'')}</textarea>`;
    } else if (c.type === 'separator') {
      innerHtml = `
        <div class="form-grid" style="margin:0">
          <div class="form-row"><label>خط الفصل (Divider)</label>
            <select onchange="mbUpdateV2('${c.id}', 'divider', this.value === 'true')">
              <option value="true" ${c.divider ? 'selected' : ''}>مفعّل (خط)</option>
              <option value="false" ${!c.divider ? 'selected' : ''}>معطّل (فراغ فقط)</option>
            </select>
          </div>
          <div class="form-row"><label>المسافة (Spacing)</label>
            <select onchange="mbUpdateV2('${c.id}', 'spacing', this.value)">
              <option value="small" ${c.spacing === 'small' ? 'selected' : ''}>صغيرة (Small)</option>
              <option value="large" ${c.spacing === 'large' ? 'selected' : ''}>كبيرة (Large)</option>
            </select>
          </div>
        </div>`;
    } else if (c.type === 'section') {
      innerHtml = `
        <textarea rows="2" style="width:100%;margin-bottom:8px;" placeholder="نص القسم..." oninput="mbUpdateV2('${c.id}', 'content', this.value)">${escapeHtml(c.content||'')}</textarea>
        <input type="url" style="width:100%" placeholder="رابط الصورة المصغرة (Thumbnail URL)" value="${escapeHtml(c.accessoryUrl||'')}" oninput="mbUpdateV2('${c.id}', 'accessoryUrl', this.value)">
      `;
    } else if (c.type === 'gallery') {
      innerHtml = `<input type="text" style="width:100%" placeholder="روابط الصور مفصولة بفاصلة ," value="${escapeHtml(c.imageUrls||'')}" oninput="mbUpdateV2('${c.id}', 'imageUrls', this.value)">`;
    }

    return `
      <div class="panel" style="background:var(--bg-elev);margin-bottom:10px;border:1px solid var(--border);">
        <div class="panel-header" style="margin-bottom:8px;padding-bottom:8px;">
          <div class="panel-title" style="font-size:13px; text-transform:uppercase; color:#8e8e8e;">
            ${c.type === 'text' ? '📝 نص / Text' : c.type === 'separator' ? '➖ فاصل / Separator' : c.type === 'section' ? '🖼️ قسم / Section' : '🌄 معرض / Gallery'}
          </div>
          <div>
            <button class="btn-secondary" style="padding:2px 6px;font-size:11px" onclick="mbMoveV2('${c.id}', -1)" ${i === 0 ? 'disabled' : ''}>⬆️</button>
            <button class="btn-secondary" style="padding:2px 6px;font-size:11px" onclick="mbMoveV2('${c.id}', 1)" ${i === builderState.v2Components.length - 1 ? 'disabled' : ''}>⬇️</button>
            <button class="btn-danger" style="padding:2px 6px;font-size:11px" onclick="mbRemoveV2('${c.id}')">✕</button>
          </div>
        </div>
        ${innerHtml}
      </div>`;
  }).join('');
}

// ===== CLASSIC FUNCTIONS (RESTORED) =====
function mbUpdate(field, value) { builderState[field] = value; renderBuilderPreview(); }

function mbAddEmbed() {
  if (builderState.embeds.length >= 10) { toast('الحد الأقصى 10 Embeds', 'error'); return; }
  builderState.embeds.push({ title: '', description: '', color: '#5865f2', fields: [], timestamp: false });
  renderBuilderEmbeds(); renderBuilderPreview();
}

function mbRemoveEmbed(i) { builderState.embeds.splice(i, 1); renderBuilderEmbeds(); renderBuilderPreview(); }
function mbUpdateEmbed(i, field, value) { builderState.embeds[i][field] = value; renderBuilderPreview(); }

function mbAddField(i) {
  if (!builderState.embeds[i].fields) builderState.embeds[i].fields = [];
  if (builderState.embeds[i].fields.length >= 25) { toast('الحد الأقصى 25 حقل', 'error'); return; }
  builderState.embeds[i].fields.push({ name: '', value: '', inline: false });
  renderBuilderEmbeds(); renderBuilderPreview();
}

function mbUpdateField(i, j, field, value) { builderState.embeds[i].fields[j][field] = value; renderBuilderPreview(); }
function mbRemoveField(i, j) { builderState.embeds[i].fields.splice(j, 1); renderBuilderEmbeds(); renderBuilderPreview(); }

function renderBuilderEmbeds() {
  const box = $('mb-embeds-list');
  if (!box) return;
  if (builderState.embeds.length === 0) { box.innerHTML = '<div class="empty" style="padding:14px">لا توجد Embeds</div>'; return; }
  box.innerHTML = builderState.embeds.map((e, i) => `
    <div class="panel" style="background:var(--bg-elev);margin-bottom:10px">
      <div class="panel-header" style="margin-bottom:8px"><div class="panel-title" style="font-size:13px">Embed #${i+1}</div><button class="btn-danger" style="padding:4px 8px;font-size:12px" onclick="mbRemoveEmbed(${i})">✕</button></div>
      <div class="form-row"><label>العنوان</label><input type="text" value="${escapeHtml(e.title||'')}" oninput="mbUpdateEmbed(${i},'title',this.value)"></div>
      <div class="form-row"><label>الوصف</label><textarea rows="3" oninput="mbUpdateEmbed(${i},'description',this.value)">${escapeHtml(e.description||'')}</textarea></div>
      <div class="form-grid">
        <div class="form-row"><label>اللون</label><input type="color" value="${e.color||'#5865f2'}" oninput="mbUpdateEmbed(${i},'color',this.value)"></div>
        <div class="form-row"><label>URL</label><input type="url" value="${escapeHtml(e.url||'')}" oninput="mbUpdateEmbed(${i},'url',this.value)"></div>
      </div>
      <div class="form-row"><label>Author name</label><input type="text" value="${escapeHtml(e.author?.name||'')}" oninput="mbUpdateEmbed(${i},'author',{name:this.value})"></div>
      <div class="form-grid">
        <div class="form-row"><label>Thumbnail URL</label><input type="url" value="${escapeHtml(e.thumbnail?.url||'')}" oninput="mbUpdateEmbed(${i},'thumbnail',{url:this.value})"></div>
        <div class="form-row"><label>Image URL</label><input type="url" value="${escapeHtml(e.image?.url||'')}" oninput="mbUpdateEmbed(${i},'image',{url:this.value})"></div>
      </div>
      <div class="form-row"><label>Footer</label><input type="text" value="${escapeHtml(e.footer?.text||'')}" oninput="mbUpdateEmbed(${i},'footer',{text:this.value})"></div>
      <div class="form-row"><label class="switch"><input type="checkbox" ${e.timestamp?'checked':''} onchange="mbUpdateEmbed(${i},'timestamp',this.checked)"><span class="track"></span><span class="label-text">Timestamp</span></label></div>
      <div class="panel-header" style="margin:10px 0 6px"><div style="font-size:12px;color:var(--text-dim)">الحقول</div><button class="btn-secondary" style="padding:3px 8px;font-size:11px" onclick="mbAddField(${i})">+</button></div>
      ${(e.fields||[]).map((f,j)=>`
        <div class="form-grid" style="margin-bottom:6px">
          <input type="text" placeholder="Name" value="${escapeHtml(f.name||'')}" oninput="mbUpdateField(${i},${j},'name',this.value)">
          <input type="text" placeholder="Value" value="${escapeHtml(f.value||'')}" oninput="mbUpdateField(${i},${j},'value',this.value)">
          <label class="switch" style="font-size:12px"><input type="checkbox" ${f.inline?'checked':''} onchange="mbUpdateField(${i},${j},'inline',this.checked)"><span class="track"></span><span class="label-text">inline</span></label>
          <button class="btn-danger" style="padding:4px 8px;font-size:11px" onclick="mbRemoveField(${i},${j})">✕</button>
        </div>`).join('')}
    </div>`).join('');
}

function mbAddButton() {
  if (builderState.buttons.length >= 25) { toast('الحد الأقصى 25 زر', 'error'); return; }
  builderState.buttons.push({ type: 'secondary', label: 'زر', emoji: '', url: '' });
  renderBuilderButtons(); renderBuilderPreview();
}

function mbUpdateButton(i, field, value) { builderState.buttons[i][field] = value; renderBuilderPreview(); }
function mbRemoveButton(i) { builderState.buttons.splice(i, 1); renderBuilderButtons(); renderBuilderPreview(); }

function renderBuilderButtons() {
  const box = $('mb-buttons-list');
  if (!box) return;
  if (builderState.buttons.length === 0) { box.innerHTML = '<div class="empty" style="padding:14px">لا توجد أزرار</div>'; return; }
  box.innerHTML = builderState.buttons.map((b, i) => `
    <div class="form-grid" style="margin-bottom:8px">
      <select onchange="mbUpdateButton(${i},'type',this.value)">
        ${['primary','secondary','success','danger','link'].map(t=>`<option value="${t}" ${b.type===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <input type="text" placeholder="Label" value="${escapeHtml(b.label||'')}" oninput="mbUpdateButton(${i},'label',this.value)">
      <input type="text" placeholder="Emoji" value="${escapeHtml(b.emoji||'')}" oninput="mbUpdateButton(${i},'emoji',this.value)">
      ${b.type === 'link' ? `<input type="url" placeholder="URL" value="${escapeHtml(b.url||'')}" oninput="mbUpdateButton(${i},'url',this.value)">` : ''}
      <button class="btn-danger" style="padding:4px 8px;font-size:11px" onclick="mbRemoveButton(${i})">✕</button>
    </div>`).join('');
}

// ===== PREVIEW & ACTIONS =====
function renderBuilderPreview() {
  const box = $('mb-preview');
  if (!box) return;
  
  if (builderState.mode === 'v2') {
    let html = '<div style="background:#2b2d31; border-radius:8px; border-left:4px solid #5865f2; padding:12px; display:flex; flex-direction:column; gap:8px;">';
    for (const c of builderState.v2Components) {
      if (c.type === 'text') {
        html += `<div style="font-family:Tajawal,sans-serif; color:#dbdee1; font-size:15px; white-space:pre-wrap;">${escapeHtml(c.content || ' ')}</div>`;
      } else if (c.type === 'separator') {
        const margin = c.spacing === 'large' ? '16px' : '8px';
        if (c.divider) html += `<div style="height:1px; background:#3f4147; margin:${margin} 0;"></div>`;
        else html += `<div style="height:1px; opacity:0; margin:${margin} 0;"></div>`;
      } else if (c.type === 'section') {
        html += `
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
            <div style="flex:1; font-family:Tajawal,sans-serif; color:#dbdee1; font-size:15px; white-space:pre-wrap;">${escapeHtml(c.content || ' ')}</div>
            ${c.accessoryUrl ? `<img src="${escapeHtml(c.accessoryUrl)}" style="width:64px;height:64px;border-radius:8px;object-fit:cover;">` : ''}
          </div>`;
      } else if (c.type === 'gallery') {
        const urls = (c.imageUrls || '').split(',').map(u=>u.trim()).filter(u=>u.startsWith('http'));
        if (urls.length > 0) {
          html += `<div style="display:grid; grid-template-columns:repeat(${Math.min(urls.length, 3)}, 1fr); gap:4px;">`;
          for (const u of urls.slice(0, 3)) html += `<img src="${escapeHtml(u)}" style="width:100%;border-radius:4px;max-height:150px;object-fit:cover;">`;
          html += `</div>`;
        } else html += `<div style="color:#8e8e8e;font-size:12px;">لا توجد صور صالحة</div>`;
      }
    }
    if (builderState.v2Components.length === 0) html += '<div style="color:#6e6e6e;text-align:center;padding:20px">أضف عناصر للمعاينة</div>';
    html += '</div>';
    box.innerHTML = html;
    return;
  }

  const content = builderState.content || '';
  const embeds = builderState.embeds || [];
  const buttons = builderState.buttons || [];
  let html = '<div style="font-family:Tajawal,sans-serif;color:#e6e8eb">';
  if (content) html += `<div style="background:#2a2a2a;padding:14px 16px;border-radius:12px;margin-bottom:12px;white-space:pre-wrap">${escapeHtml(content)}</div>`;
  for (const e of embeds) {
    const borderColor = e.color || '#5865f2';
    html += `<div style="background:#2a2a2a;border-right:4px solid ${borderColor};border-radius:8px;padding:14px 16px;margin-bottom:12px">`;
    if (e.author?.name) html += `<div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:6px">${escapeHtml(e.author.name)}</div>`;
    if (e.title) html += `<div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:6px">${escapeHtml(e.title)}</div>`;
    if (e.description) html += `<div style="font-size:14px;color:#dbdee1;margin-bottom:10px;white-space:pre-wrap">${escapeHtml(e.description)}</div>`;
    if (e.fields && e.fields.length > 0) {
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">';
      for (const f of e.fields) html += `<div style="${f.inline?'':'grid-column:1/-1'}"><div style="font-size:12px;font-weight:700;color:#fff">${escapeHtml(f.name||'—')}</div><div style="font-size:13px;color:#dbdee1">${escapeHtml(f.value||'—')}</div></div>`;
      html += '</div>';
    }
    if (e.image?.url) html += `<img src="${escapeHtml(e.image.url)}" style="max-width:100%;border-radius:6px;margin-top:8px">`;
    if (e.footer?.text) html += `<div style="font-size:12px;color:#8e8e8e;margin-top:8px">${escapeHtml(e.footer.text)}</div>`;
    html += '</div>';
  }
  if (buttons.length > 0) {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap">';
    for (const b of buttons) {
      const colors = { primary:'#5865f2', secondary:'#4f545c', success:'#22c55e', danger:'#ef4444', link:'#4f545c' };
      html += `<div style="padding:8px 14px;border-radius:6px;background:${colors[b.type]||'#4f545c'};color:#fff;font-size:13px;font-weight:600">${b.emoji?escapeHtml(b.emoji)+' ':''}${escapeHtml(b.label||'')}</div>`;
    }
    html += '</div>';
  }
  if (!content && embeds.length === 0 && buttons.length === 0) html += '<div style="color:#6e6e6e;text-align:center;padding:40px">اكتب شيئًا لتراه هنا</div>';
  html += '</div>';
  box.innerHTML = html;
}

function mbBuildPayload() {
  const allowEveryone = $('mb-allow-everyone')?.checked;
  const payload = {
    mode: builderState.mode,
    allowedMentions: allowEveryone ? { parse: ['everyone', 'roles', 'users'] } : { parse: [] }
  };
  
  if (builderState.mode === 'v2') {
    payload.v2Components = builderState.v2Components;
    return payload;
  }

  payload.content = builderState.content || undefined;
  payload.embeds = builderState.embeds.length > 0 ? builderState.embeds.map(e => ({
    title: e.title || undefined, description: e.description || undefined,
    url: e.url || undefined, color: e.color || undefined,
    author: e.author?.name ? e.author : undefined,
    thumbnail: e.thumbnail?.url ? e.thumbnail : undefined,
    image: e.image?.url ? e.image : undefined,
    footer: e.footer?.text ? e.footer : undefined,
    timestamp: !!e.timestamp,
    fields: (e.fields || []).filter(f => f.name || f.value),
  })) : undefined;
  payload.buttons = builderState.buttons.length > 0 ? builderState.buttons.filter(b => b.label) : undefined;
  
  return payload;
}

async function mbSend(btn) {
  if (!builderState.channelId) { toast('اختر قناة', 'error'); return; }
  const payload = mbBuildPayload();
  
  if (builderState.mode === 'v2' && payload.v2Components.length === 0) {
    toast('❌ الرسالة فارغة (V2)', 'error'); return;
  }
  if (builderState.mode === 'classic' && !payload.content && (!payload.embeds || payload.embeds.length===0) && (!payload.buttons || payload.buttons.length===0)) {
    toast('❌ الرسالة فارغة (Classic)', 'error'); return;
  }
  
  if ($('mb-allow-everyone')?.checked && !(await confirmModal('تأكيد', 'الرسالة تحتوي على @everyone. متأكد؟'))) return;
  btn.disabled = true; btn.textContent = '...';
  try {
    const res = await api('/api/builder/send', { method: 'POST', body: JSON.stringify({ channelId: builderState.channelId, payload }) });
    if (res.ok) toast(`تم الإرسال! ID: ${res.messageId}`, 'success');
    else toast(res.error || 'فشل', 'error');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = '📤 إرسال'; }
}

async function mbSaveDraft() {
  const name = prompt('اسم المسودة:');
  if (!name) return;
  try {
    await api('/api/builder/drafts', { method: 'POST', body: JSON.stringify({ name, payload: mbBuildPayload() }) });
    toast('تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

async function mbLoadDrafts() {
  const list = await api('/api/builder/drafts');
  if (list.length === 0) { toast('لا توجد مسودات', 'info'); return; }
  const pick = prompt('اختر رقم المسودة:\n' + list.map((d,i) => `${i+1}. ${d.name}`).join('\n'));
  if (!pick) return;
  const idx = parseInt(pick, 10) - 1;
  if (!list[idx]) return;
  const full = await api(`/api/builder/drafts/${list[idx].id}`);
  
  builderState.mode = full.payload.mode || 'classic';
  builderState.content = full.payload.content || '';
  builderState.embeds = full.payload.embeds || [];
  builderState.buttons = full.payload.buttons || [];
  builderState.v2Components = full.payload.v2Components || [];
  
  pageBuilder();
  toast('تم التحميل', 'success');
}

function mbExportJSON() {
  const blob = new Blob([JSON.stringify(mbBuildPayload(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'bladex-message.json'; a.click();
}

function mbImportJSON() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      builderState.mode = payload.mode || 'classic';
      builderState.content = payload.content || '';
      builderState.embeds = payload.embeds || [];
      builderState.buttons = payload.buttons || [];
      builderState.v2Components = payload.v2Components || [];
      pageBuilder();
      toast('تم الاستيراد', 'success');
    } catch { toast('JSON غير صالح', 'error'); }
  };
  input.click();
}

function mbReset() {
  builderState = { mode: builderState.mode, content: '', embeds: [], buttons: [], v2Components: [], channelId: builderState.channelId };
  pageBuilder();
}

// ============================================================
// Settings
// ============================================================
async function pageSettings() {
  const s = await api('/api/stats');
  const me = await api('/api/me').catch(() => null);
  contentArea.innerHTML = `
    <div class="panel">
      <div class="panel-header"><div class="panel-title">⚙️ معلومات النظام</div></div>
      <table class="table">
        <tbody>
          <tr><td>البوت</td><td>${s.botOnline ? '✅ متصل' : '❌ غير متصل'}</td></tr>
          <tr><td>السيرفر</td><td>${escapeHtml(s.guildName || '—')} (<code>${s.guildId}</code>)</td></tr>
          <tr><td>الأعضاء</td><td>${s.memberCount ?? '—'}</td></tr>
          ${me ? `<tr><td>المستخدم</td><td>${escapeHtml(me.username)}</td></tr>
          <tr><td>انتهاء الجلسة</td><td>${me.expiresAt ? formatDate(me.expiresAt) : '—'}</td></tr>` : ''}
        </tbody>
      </table>
    </div>`;
}

// ============================================================
// Shared helpers
// ============================================================
function attachSettingListeners() {
  document.querySelectorAll('[data-setting][data-type="bool"]').forEach((el) => {
    el.addEventListener('change', () => {
      const lbl = el.parentElement.querySelector('.label-text');
      if (lbl) lbl.textContent = el.checked ? 'مفعّل' : 'معطّل';
    });
  });
}

async function saveSettings(btn) {
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '...';
  try {
    const values = {};
    document.querySelectorAll('[data-setting]').forEach((el) => {
      const k = el.dataset.setting;
      if (el.type === 'checkbox') values[k] = el.checked ? 'true' : 'false';
      else values[k] = el.value;
    });
    await api('/api/settings', { method: 'POST', body: JSON.stringify({ values }) });
    toast('تم الحفظ', 'success');
  } catch (e) { toast(e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = orig; }
}

// ============================================================
// Router
// ============================================================
const pages = {
  overview: { title: 'Overview', subtitle: 'نظرة عامة', fn: pageOverview },
  welcome: { title: 'Welcome System', subtitle: 'إعدادات الترحيب', fn: pageWelcome },
  'image-editor': { title: 'Welcome Image Editor', subtitle: 'تخصيص صورة الترحيب', fn: pageImageEditor },
  buttons: { title: 'Welcome Buttons', subtitle: 'أزرار الترحيب', fn: pageButtons },
  logs: { title: 'Log Channels', subtitle: 'قنوات السجلات', fn: pageLogs },
  activity: { title: 'Activity Log', subtitle: 'سجل الأحداث', fn: pageActivity },
  moderation: { title: 'Moderation', subtitle: 'سجل العقوبات', fn: pageModeration },
  antispam: { title: 'Anti-Spam', subtitle: 'مكافحة السبام', fn: pageAntiSpam },
  antiraid: { title: 'Anti-Raid', subtitle: 'مكافحة موجات الدخول', fn: pageAntiRaid },
  antinuke: { title: 'Anti-Nuke', subtitle: 'حماية من التخريب', fn: pageAntiNuke },
  spamtrap: { title: 'Spam Trap', subtitle: 'مصيدة الحسابات المخترقة', fn: pageSpamTrap },
  selfroles: { title: 'Self Roles', subtitle: 'لوحة الرولات', fn: pageSelfRoles },
  movie: { title: 'Movie Night Review', subtitle: 'تقييم فعالية السينما', fn: pageMovie },
  media: { title: 'Media Show', subtitle: 'عرض الصور والفيديوهات', fn: pageMediaShow },
  support: { title: 'Support Center', subtitle: 'التذاكر والاقتراحات', fn: pageSupport },
  texts: { title: 'Text Customizer', subtitle: 'تخصيص النصوص والألوان', fn: pageTexts },
  emojis: { title: 'Emoji Manager', subtitle: 'إدارة الإيموجيات', fn: pageEmojis },
  builder: { title: 'Message Builder', subtitle: 'إنشاء رسائل Discord', fn: pageBuilder },
  settings: { title: 'Settings', subtitle: 'معلومات النظام', fn: pageSettings },
};

async function navigate(section) {
  const page = pages[section] || pages.overview;
  pageTitle.textContent = page.title;
  pageSubtitle.textContent = page.subtitle;
  contentArea.innerHTML = '<div class="loader">جارٍ التحميل...</div>';
  document.querySelectorAll('#main-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.section === section);
  });
  history.replaceState({}, '', `#${section}`);

  let done = false;
  const watchdog = setTimeout(() => {
    if (done) return;
    done = true;
    contentArea.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">⏱️ انتهت مهلة التحميل</div></div>
        <div class="btn-row"><button class="btn-primary" onclick="navigate('${section}')">🔄 إعادة المحاولة</button></div>
      </div>`;
  }, 20000);

  try {
    await page.fn();
    done = true;
    clearTimeout(watchdog);
  } catch (e) {
    done = true;
    clearTimeout(watchdog);
    console.error(`[Blade X] navigate('${section}') failed:`, e);
    contentArea.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">❌ خطأ في تحميل القسم</div></div>
        <div class="panel-desc">${escapeHtml(e?.message || 'خطأ غير معروف')}</div>
        <div class="btn-row"><button class="btn-primary" onclick="navigate('${section}')">🔄 إعادة المحاولة</button></div>
      </div>`;
  }
}

document.querySelectorAll('#main-nav a').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(link.dataset.section);
  });
});

$('logout-btn').addEventListener('click', async () => {
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/auth/login';
});

// ============================================================
// Init
// ============================================================
async function init() {
  console.log('[Blade X] init() starting');
  try {
    await loadMe();
    await loadDiscordData();
    await refreshStatus();
    setInterval(refreshStatus, 30_000);
    const hash = window.location.hash.replace('#', '');
    navigate(pages[hash] ? hash : 'overview');
  } catch (e) {
    console.error('[Blade X] init() failed:', e);
    contentArea.innerHTML = `
      <div class="panel">
        <div class="panel-header"><div class="panel-title">❌ خطأ في تحميل Dashboard</div></div>
        <div class="panel-desc">${escapeHtml(e?.message || 'خطأ')}</div>
        <div class="btn-row"><button class="btn-primary" onclick="location.reload()">🔄 إعادة المحاولة</button></div>
      </div>`;
  }
}

init();