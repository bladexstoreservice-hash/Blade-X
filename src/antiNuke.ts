import {
  Client, Events, AuditLogEvent, Guild, TextChannel, EmbedBuilder,
  PermissionFlagsBits, User,
} from 'discord.js';
import { config } from './config.js';
import db, {
  getSetting, getSettingJSON, setSettingJSON, logNukeEvent, countRecentNukeEvents,
} from './database.js';
import { getEmoji } from './emojiRegistry.js';
import { discordTime } from './utils.js';

interface NukeRule {
  enabled: boolean;
  threshold: number;
  windowMs: number;
  action: 'alert' | 'remove_roles' | 'kick' | 'ban' | 'none';
  severity: 'low' | 'medium' | 'high' | 'critical';
}

interface NukeConfig {
  enabled: boolean;
  logChannelId: string | null;
  trustedUsers: string[];
  trustedRoles: string[];
  dryRun: boolean;
  rules: {
    channel_delete: NukeRule;
    channel_create: NukeRule;
    role_delete: NukeRule;
    role_create: NukeRule;
    ban_add: NukeRule;
    kick_add: NukeRule;
    webhook_delete: NukeRule;
  };
}

const defaultConfig: NukeConfig = {
  enabled: false,
  logChannelId: null,
  trustedUsers: [],
  trustedRoles: [],
  dryRun: true,
  rules: {
    channel_delete: { enabled: true, threshold: 3, windowMs: 10_000, action: 'alert', severity: 'high' },
    channel_create: { enabled: true, threshold: 5, windowMs: 10_000, action: 'alert', severity: 'medium' },
    role_delete:   { enabled: true, threshold: 3, windowMs: 10_000, action: 'alert', severity: 'high' },
    role_create:   { enabled: true, threshold: 5, windowMs: 10_000, action: 'alert', severity: 'medium' },
    ban_add:       { enabled: true, threshold: 5, windowMs: 15_000, action: 'alert', severity: 'critical' },
    kick_add:      { enabled: true, threshold: 5, windowMs: 15_000, action: 'alert', severity: 'high' },
    webhook_delete:{ enabled: true, threshold: 3, windowMs: 10_000, action: 'alert', severity: 'medium' },
  },
};

function getConfig(): NukeConfig {
  const raw = getSetting('antinuke_config');
  if (!raw) return defaultConfig;
  try {
    const parsed = JSON.parse(raw);
    return { ...defaultConfig, ...parsed, rules: { ...defaultConfig.rules, ...(parsed.rules ?? {}) } };
  } catch { return defaultConfig; }
}

export function saveConfig(patch: Partial<NukeConfig>): void {
  const current = getConfig();
  const merged = { ...current, ...patch, rules: { ...current.rules, ...(patch.rules ?? {}) } };
  setSettingJSON('antinuke_config', merged);
}

// ===== تحديد المنفذ من Audit Log =====
async function resolveExecutor(
  guild: Guild,
  action: AuditLogEvent,
  targetId: string | null,
): Promise<string | null> {
  try {
    const logs = await guild.fetchAuditLogs({ type: action, limit: 3 });
    const cutoff = Date.now() - 5000;
    for (const entry of logs.entries.values()) {
      if (entry.createdTimestamp < cutoff) continue;
      if (targetId === null) return entry.executor?.id ?? null;
      const target = entry.target as any;
      if (target?.id === targetId) return entry.executor?.id ?? null;
    }
  } catch { /* no perms */ }
  return null;
}

function isTrusted(executorId: string | null, cfg: NukeConfig, guild: Guild): boolean {
  if (!executorId) return true;
  if (executorId === guild.ownerId) return true;
  if (executorId === guild.client.user?.id) return true;
  if (cfg.trustedUsers.includes(executorId)) return true;
  const member = guild.members.cache.get(executorId);
  if (member && cfg.trustedRoles.some(r => member.roles.cache.has(r))) return true;
  return false;
}

// ===== معالج الحدث =====
async function handleNukeEvent(
  client: Client,
  guild: Guild,
  eventType: keyof NukeConfig['rules'],
  targetId: string | null,
  details: string,
  auditAction: AuditLogEvent,
): Promise<void> {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const rule = cfg.rules[eventType];
  if (!rule.enabled) return;

  const executorId = await resolveExecutor(guild, auditAction, targetId);
  if (isTrusted(executorId, cfg, guild)) return;

  const recentCount = countRecentNukeEvents(guild.id, eventType, rule.windowMs) + 1;

  logNukeEvent({
    guild_id: guild.id,
    event_type: eventType,
    executor_id: executorId,
    target_id: targetId,
    details,
    severity: rule.severity,
    action_taken: recentCount >= rule.threshold ? rule.action : 'logged',
  });

  if (recentCount < rule.threshold) return;

  const embed = new EmbedBuilder()
    .setColor(rule.severity === 'critical' ? 0xed4245 : rule.severity === 'high' ? 0xf59e0b : 0x3b82f6)
    .setTitle(`${getEmoji('log_security', '🛡️')} Anti-Nuke: ${eventType}`)
    .setDescription(
      `**تم اكتشاف نشاط مريب**\n\n` +
      `📊 **عدد الأحداث:** ${recentCount}/${rule.threshold} خلال ${Math.round(rule.windowMs / 1000)}ث\n` +
      `⚠️ **مستوى الخطورة:** ${rule.severity.toUpperCase()}\n` +
      `🎯 **الإجراء المطلوب:** ${rule.action}${cfg.dryRun ? ' *(وضع المراقبة — لن يُنفذ)*' : ''}`
    )
    .addFields(
      { name: '👤 المنفذ', value: executorId ? `<@${executorId}> (\`${executorId}\`)` : '*غير معروف*', inline: false },
      { name: '🎯 الهدف', value: targetId ? `\`${targetId}\`` : '*غير محدد*', inline: true },
      { name: '📝 التفاصيل', value: details.slice(0, 1000) || '—', inline: false },
      { name: '🕐 الوقت', value: discordTime(Date.now(), 'F'), inline: false },
    )
    .setFooter({ text: `${config.botName} · Security` });

  if (cfg.logChannelId) {
    const ch = guild.channels.cache.get(cfg.logChannelId);
    if (ch?.isTextBased() && !ch.isDMBased()) {
      try { await (ch as TextChannel).send({ embeds: [embed] }); } catch { /* ignore */ }
    }
  }

  if (cfg.dryRun || !executorId) return;

  const member = guild.members.cache.get(executorId);
  if (!member) return;
  const me = guild.members.me;
  if (!me) return;
  if (member.roles.highest.position >= me.roles.highest.position) return;

  try {
    switch (rule.action) {
      case 'remove_roles': {
        const rolesToRemove = member.roles.cache.filter(r =>
          !r.managed &&
          r.id !== guild.id &&
          r.permissions.has(PermissionFlagsBits.Administrator) &&
          r.position < me.roles.highest.position
        );
        for (const [id] of rolesToRemove) {
          await member.roles.remove(id, `Anti-Nuke: ${eventType}`).catch(() => {});
        }
        break;
      }
      case 'kick':
        if (member.kickable) await member.kick(`Anti-Nuke: ${eventType}`);
        break;
      case 'ban':
        if (member.bannable) await guild.bans.create(member.id, { reason: `Anti-Nuke: ${eventType}` });
        break;
      case 'alert':
      case 'none':
      default:
        break;
    }
  } catch (e) {
    console.error('[Blade X] ❌ Anti-Nuke action failed:', e);
  }
}

// ============================================================
// Anti-Nuke Test — Safe Simulation
// ============================================================
export interface AntiNukeTestResult {
  rule: string;
  enabled: boolean;
  threshold: number;
  windowMs: number;
  countBefore: number;
  countAfter: number;
  wouldTrigger: boolean;
  pass: boolean;
}

export interface AntiNukeTestReport {
  runId: string;
  mode: 'simulation';
  runAt: number;
  durationMs: number;
  configEnabled: boolean;
  dryRun: boolean;
  results: AntiNukeTestResult[];
  errors: string[];
  summary: { total: number; passed: number; failed: number };
  notes: string[];
}

/**
 * Simulates Anti-Nuke detection by inserting TEST-marked events into the
 * nuke_events table (never touching real Discord channels/roles), running the
 * REAL `countRecentNukeEvents` against them, and comparing to the REAL
 * thresholds. All test rows are deleted afterwards by runId.
 *
 * Safe by design:
 *   - No channels created/deleted
 *   - No roles created/deleted
 *   - No punishments applied
 *   - Test events use executor_id='TEST_BOT' and details prefix 'TEST:<runId>'
 */
export async function runAntiNukeSimulation(
  guildId: string,
  runBy: string,
): Promise<AntiNukeTestReport> {
  const start = Date.now();
  const runId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cfg = getConfig();

  const testableRules: (keyof NukeConfig['rules'])[] = [
    'channel_create', 'channel_delete', 'role_create', 'role_delete',
  ];

  const results: AntiNukeTestResult[] = [];
  const errors: string[] = [];

  try {
    for (const ruleName of testableRules) {
      const rule = cfg.rules[ruleName];
      if (!rule) continue;

      try {
        const countBefore = countRecentNukeEvents(guildId, ruleName, rule.windowMs);

        for (let i = 0; i < rule.threshold; i++) {
          db.prepare(`INSERT INTO nuke_events
            (guild_id, event_type, executor_id, target_id, details, severity, action_taken, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(
              guildId, ruleName, 'TEST_BOT', `TEST:${runId}:${i}`,
              `TEST:${runId}`, rule.severity, 'test_event', Date.now(),
            );
        }

        const countAfter = countRecentNukeEvents(guildId, ruleName, rule.windowMs);
        const wouldTrigger = countAfter >= rule.threshold;
        const actualDelta = countAfter - countBefore;
        const pass = actualDelta >= rule.threshold && wouldTrigger;

        results.push({
          rule: ruleName,
          enabled: rule.enabled,
          threshold: rule.threshold,
          windowMs: rule.windowMs,
          countBefore,
          countAfter,
          wouldTrigger,
          pass,
        });
      } catch (e: any) {
        errors.push(`${ruleName}: ${e?.message ?? 'unknown'}`);
      }
    }
  } finally {
    try {
      const info = db.prepare("DELETE FROM nuke_events WHERE details LIKE ? AND executor_id = 'TEST_BOT'")
        .run(`TEST:${runId}%`);
      if (info.changes > 0) {
        console.log(`[Blade X] ✅ Anti-Nuke test cleanup: ${info.changes} rows removed`);
      }
    } catch (e) {
      errors.push(`cleanup: ${(e as Error)?.message ?? 'unknown'}`);
    }
  }

  const passed = results.filter(r => r.pass).length;
  const failed = results.length - passed;

  const notes: string[] = [
    'اختبار محاكاة آمن — لم يتم إنشاء أو حذف أي قناة أو رول حقيقي.',
    'لم يتم تطبيق أي عقوبة على الأعضاء أو تعديل صلاحياتهم.',
    'الأحداث الاختبارية مُعلَّمة بـ TEST: في nuke_events وتم حذفها بعد الاختبار.',
    'الاختبار الحي (إنشاء/حذف فعلي) غير منفّذ — يتطلب تأكيدًا إضافيًا ولم يُنفَّذ هنا.',
  ];

  if (!cfg.enabled) {
    notes.push('⚠️ Anti-Nuke معطّل في الإعدادات — الاختبار يتحقق من منطق الكشف فقط، وليس العقوبات.');
  }
  if (cfg.dryRun) {
    notes.push('ℹ️ وضع dryRun مفعّل — حتى لو تجاوزت الأحداث الحد، لن تُنفَّذ عقوبات في الواقع.');
  }

  try {
    db.prepare(`INSERT INTO nuke_events
      (guild_id, event_type, executor_id, target_id, details, severity, action_taken, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        guildId, 'antinuke_test', runBy, null,
        `TEST_REPORT:${runId} passed=${passed}/${results.length}`,
        'low', 'test_completed', Date.now(),
      );
  } catch { /* ignore */ }

  return {
    runId,
    mode: 'simulation',
    runAt: start,
    durationMs: Date.now() - start,
    configEnabled: cfg.enabled,
    dryRun: cfg.dryRun,
    results,
    errors,
    summary: { total: results.length, passed, failed },
    notes,
  };
}

export function registerAntiNuke(client: Client): void {
  client.on(Events.ChannelDelete, async (ch) => {
    if (ch.isDMBased() || !ch.guild) return;
    await handleNukeEvent(client, ch.guild, 'channel_delete', ch.id, `حذف قناة: ${ch.name}`, AuditLogEvent.ChannelDelete);
  });
  client.on(Events.ChannelCreate, async (ch) => {
    if (ch.isDMBased() || !ch.guild) return;
    await handleNukeEvent(client, ch.guild, 'channel_create', ch.id, `إنشاء قناة: ${ch.name}`, AuditLogEvent.ChannelCreate);
  });
  client.on(Events.GuildRoleDelete, async (role) => {
    await handleNukeEvent(client, role.guild, 'role_delete', role.id, `حذف رول: ${role.name}`, AuditLogEvent.RoleDelete);
  });
  client.on(Events.GuildRoleCreate, async (role) => {
    await handleNukeEvent(client, role.guild, 'role_create', role.id, `إنشاء رول: ${role.name}`, AuditLogEvent.RoleCreate);
  });
  client.on(Events.GuildBanAdd, async (ban) => {
    await handleNukeEvent(client, ban.guild, 'ban_add', ban.user.id, `حظر: ${ban.user.tag}`, AuditLogEvent.MemberBanAdd);
  });
  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const logs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 3 });
      const cutoff = Date.now() - 5000;
      for (const e of logs.entries.values()) {
        if (e.createdTimestamp < cutoff) continue;
        if ((e.target as any)?.id === member.id) {
          await handleNukeEvent(client, member.guild, 'kick_add', member.id, `طرد: ${member.user?.tag ?? member.id}`, AuditLogEvent.MemberKick);
          return;
        }
      }
    } catch { /* ignore */ }
  });

  console.log('[Blade X] ✅ Anti-Nuke registered (simulation test available)');
}