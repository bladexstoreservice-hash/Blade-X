// ============================================================
// اختبار اتصال Turso — للقراءة فقط (آمن تمامًا)
// التشغيل: npm run test:turso
// ============================================================

import { createClient } from '@libsql/client';
import 'dotenv/config';

const EXPECTED_TABLES = [
  'settings', 'welcome_phrases', 'welcome_buttons', 'self_roles',
  'moderation_log', 'activity_log', 'member_history',
  'movie_sessions', 'movie_recipients', 'movie_ratings', 'movie_drafts',
  'sessions', 'emoji_registry', 'mb_drafts', 'mb_history',
  'spam_trap_log',
  'media_channels', 'media_posts', 'media_files', 'media_reactions',
  'tickets', 'suggestions', 'suggestion_votes',
  'moderation_events', 'nuke_events',
  'spam_sessions', 'spam_session_messages',
  'componentsv2_jobs',
];

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (/^(libsql|https?|wss?|file):/.test(t)) return t;
  return `libsql://${t}`;
}

async function main(): Promise<void> {
  const rawUrl = process.env.TURSO_DATABASE_URL;
  const token = process.env.TURSO_AUTH_TOKEN;

  if (!rawUrl) {
    console.error('❌ TURSO_DATABASE_URL غير موجود في .env');
    process.exit(1);
  }
  if (!token) {
    console.error('❌ TURSO_AUTH_TOKEN غير موجود في .env');
    process.exit(1);
  }

  const url = normalizeUrl(rawUrl);
  console.log('🔌 Connecting to Turso...');
  console.log(`   URL: ${url}`);
  console.log(`   Token: ${token.slice(0, 6)}… (len=${token.length})`);

  const client = createClient({ url, authToken: token });

  try {
    const ping = await client.execute('SELECT 1 as ok');
    console.log('✅ [1/5] Connection OK');

    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.rows.map((r) => String(r.name));
    console.log(`✅ [2/5] Schema: ${tableNames.length} tables`);

    const missing = EXPECTED_TABLES.filter((t) => !tableNames.includes(t));
    if (missing.length > 0) {
      console.warn(`⚠️  [3/5] Missing (will be created by initDatabase): ${missing.join(', ')}`);
    } else {
      console.log('✅ [3/5] All expected tables exist');
    }

    const settings = await client.execute('SELECT COUNT(*) as c FROM settings');
    const settingsCount = Number(settings.rows[0]?.c ?? 0);
    console.log(`✅ [4/5] settings: ${settingsCount} rows`);

    if (settingsCount > 0) {
      const sample = await client.execute('SELECT key, value FROM settings LIMIT 5');
      console.log('   Sample:');
      for (const row of sample.rows) {
        const val = String(row.value ?? '').slice(0, 40);
        console.log(`   • ${row.key} = ${val}${val.length >= 40 ? '…' : ''}`);
      }
    }

    const counts = await Promise.all([
      client.execute('SELECT COUNT(*) as c FROM welcome_phrases').then((r) => Number(r.rows[0]?.c ?? 0)),
      client.execute('SELECT COUNT(*) as c FROM self_roles').then((r) => Number(r.rows[0]?.c ?? 0)),
      client.execute('SELECT COUNT(*) as c FROM media_channels').then((r) => Number(r.rows[0]?.c ?? 0)),
      client.execute('SELECT COUNT(*) as c FROM tickets').then((r) => Number(r.rows[0]?.c ?? 0)),
    ]);
    console.log(`✅ [5/5] Welcome phrases: ${counts[0]}, Self roles: ${counts[1]}, Media channels: ${counts[2]}, Tickets: ${counts[3]}`);

    console.log('\n✅✅ Turso connection test PASSED — Ready to migrate');
    process.exit(0);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('\n❌ Turso test FAILED:', msg);
    console.error('\nتحقق من:');
    console.error('  1. TURSO_DATABASE_URL صحيح (يبدأ بـ libsql://)');
    console.error('  2. TURSO_AUTH_TOKEN صالح وغير منتهي');
    console.error('  3. الشبكة تسمح بالاتصالات الصادرة إلى Turso');
    process.exit(1);
  }
}

void main();