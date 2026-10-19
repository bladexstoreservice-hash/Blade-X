import fs from 'node:fs';
import path from 'node:path';
import db from './database.js';
import { config } from './config.js';

// ============================================================
// Blade X — Global Emoji Scanner
// ============================================================

export type EmojiType = 'unicode' | 'custom';
export type UsageKind = 'file' | 'settings' | 'registry' | 'table';

export interface UsageSource {
  kind: UsageKind;
  location: string;
  context?: string;
}

export interface EmojiUsage {
  emoji: string;
  type: EmojiType;
  name?: string;
  id?: string;
  animated?: boolean;
  sources: UsageSource[];
  count: number;
}

export interface ScanReport {
  scannedAt: number;
  filesScanned: number;
  totalEmojis: number;
  emojis: EmojiUsage[];
  errors: string[];
}

const UNICODE_EMOJI_RE = /\p{Extended_Pictographic}/gu;
const CUSTOM_EMOJI_RE = /<(a?):([a-zA-Z0-9_]+):(\d{17,20})>/g;

const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'data', 'public']);
const ALLOWED_EXT = new Set(['.ts', '.js', '.mjs', '.cjs']);

function walkDir(rootDir: string, results: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) walkDir(full, results);
    else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ALLOWED_EXT.has(ext)) results.push(full);
    }
  }
  return results;
}

function extractFromText(
  text: string,
  sourceLocation: string,
  kind: UsageKind = 'file',
): Map<string, EmojiUsage> {
  const out = new Map<string, EmojiUsage>();

  const customMatches = [...text.matchAll(CUSTOM_EMOJI_RE)];
  for (const m of customMatches) {
    const [, anim, name, id] = m;
    const raw = m[0];
    const existing = out.get(raw);
    if (existing) {
      existing.count += 1;
      if (!existing.sources.some((s) => s.location === sourceLocation)) {
        existing.sources.push({ kind, location: sourceLocation });
      }
    } else {
      out.set(raw, {
        emoji: raw,
        type: 'custom',
        name,
        id,
        animated: anim === 'a',
        sources: [{ kind, location: sourceLocation }],
        count: 1,
      });
    }
  }

  const cleaned = text.replace(CUSTOM_EMOJI_RE, ' ').replace(/\d{17,20}/g, ' ');

  for (const m of cleaned.matchAll(UNICODE_EMOJI_RE)) {
    const ch = m[0];
    if (/[\u0000-\u007F]/.test(ch)) continue;

    const existing = out.get(ch);
    if (existing) {
      existing.count += 1;
      if (!existing.sources.some((s) => s.location === sourceLocation)) {
        existing.sources.push({ kind, location: sourceLocation });
      }
    } else {
      out.set(ch, {
        emoji: ch,
        type: 'unicode',
        sources: [{ kind, location: sourceLocation }],
        count: 1,
      });
    }
  }

  return out;
}

function mergeUsage(target: Map<string, EmojiUsage>, source: Map<string, EmojiUsage>): void {
  for (const [k, v] of source) {
    const existing = target.get(k);
    if (existing) {
      existing.count += v.count;
      for (const s of v.sources) {
        if (!existing.sources.some((x) => x.location === s.location && x.kind === s.kind)) {
          existing.sources.push(s);
        }
      }
    } else {
      target.set(k, { ...v, sources: [...v.sources] });
    }
  }
}

function scanFiles(): { usages: Map<string, EmojiUsage>; filesScanned: number; errors: string[] } {
  const usages = new Map<string, EmojiUsage>();
  const errors: string[] = [];
  const root = process.cwd();

  const srcDir = path.join(root, 'src');
  const files: string[] = [];
  if (fs.existsSync(srcDir)) walkDir(srcDir, files);

  let filesScanned = 0;
  for (const filePath of files) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      filesScanned++;
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      const fileUsages = extractFromText(content, rel, 'file');
      mergeUsage(usages, fileUsages);
    } catch (e: any) {
      errors.push(`Failed reading ${filePath}: ${e?.message ?? 'unknown'}`);
    }
  }

  return { usages, filesScanned, errors };
}

function scanDb(): { usages: Map<string, EmojiUsage>; errors: string[] } {
  const usages = new Map<string, EmojiUsage>();
  const errors: string[] = [];

  try {
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    for (const row of rows) {
      if (!row.value) continue;
      const extracted = extractFromText(row.value, `settings.${row.key}`, 'settings');
      for (const [, u] of extracted) {
        for (const s of u.sources) s.context = row.value.slice(0, 80);
      }
      mergeUsage(usages, extracted);
    }
  } catch (e: any) {
    errors.push(`settings scan failed: ${e?.message ?? 'unknown'}`);
  }

  try {
    const rows = db.prepare('SELECT key, value FROM emoji_registry').all() as { key: string; value: string }[];
    for (const row of rows) {
      if (!row.value) continue;
      const extracted = extractFromText(row.value, `emoji_registry.${row.key}`, 'registry');
      for (const [, u] of extracted) {
        for (const s of u.sources) s.context = row.value.slice(0, 80);
      }
      mergeUsage(usages, extracted);
    }
  } catch (e: any) {
    errors.push(`emoji_registry scan failed: ${e?.message ?? 'unknown'}`);
  }

  try {
    const rows = db.prepare('SELECT * FROM media_channels').all() as any[];
    const fields = [
      'title_format', 'author_emoji', 'reaction_emoji', 'comment_emoji',
      'delete_emoji', 'viewall_emoji', 'footer_from_label', 'footer_others_label',
    ];
    for (const row of rows) {
      for (const field of fields) {
        const val = row[field];
        if (typeof val !== 'string' || !val) continue;
        const loc = `media_channels[${row.channel_id}].${field}`;
        const extracted = extractFromText(val, loc, 'table');
        for (const [, u] of extracted) {
          for (const s of u.sources) s.context = val.slice(0, 80);
        }
        mergeUsage(usages, extracted);
      }
    }
  } catch (e: any) {
    errors.push(`media_channels scan failed: ${e?.message ?? 'unknown'}`);
  }

  try {
    const client = (globalThis as any).__bladeClient;
    const guild = client?.guilds?.cache?.get(config.guildId);
    const rows = db
      .prepare('SELECT id, label, emoji_id FROM self_roles')
      .all() as { id: number; label: string; emoji_id: string | null }[];

    for (const row of rows) {
      if (!row.emoji_id) continue;
      if (!/^\d{17,20}$/.test(row.emoji_id)) continue;
      if (!guild) continue;

      const e = guild.emojis.cache.get(row.emoji_id);
      if (!e) continue;

      const raw = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
      const loc = `self_roles[${row.id}]`;
      const existing = usages.get(raw);

      if (existing) {
        existing.count += 1;
        if (!existing.sources.some((s) => s.location === loc)) {
          existing.sources.push({ kind: 'table', location: loc, context: row.label });
        }
      } else {
        usages.set(raw, {
          emoji: raw,
          type: 'custom',
          name: e.name,
          id: e.id,
          animated: e.animated ?? false,
          sources: [{ kind: 'table', location: loc, context: row.label }],
          count: 1,
        });
      }
    }
  } catch (e: any) {
    errors.push(`self_roles scan failed: ${e?.message ?? 'unknown'}`);
  }

  return { usages, errors };
}

let cachedReport: ScanReport | null = null;
let cacheTime = 0;
const CACHE_MS = 60_000;

export function runEmojiScan(force = false): ScanReport {
  const now = Date.now();
  if (!force && cachedReport && now - cacheTime < CACHE_MS) {
    return cachedReport;
  }

  const fileResult = scanFiles();
  const dbResult = scanDb();

  const usages = new Map<string, EmojiUsage>();
  mergeUsage(usages, fileResult.usages);
  mergeUsage(usages, dbResult.usages);

  const emojis = [...usages.values()].sort((a, b) => b.count - a.count);

  const report: ScanReport = {
    scannedAt: now,
    filesScanned: fileResult.filesScanned,
    totalEmojis: emojis.length,
    emojis,
    errors: [...fileResult.errors, ...dbResult.errors],
  };

  cachedReport = report;
  cacheTime = now;
  return report;
}

export function invalidateScanCache(): void {
  cachedReport = null;
  cacheTime = 0;
}