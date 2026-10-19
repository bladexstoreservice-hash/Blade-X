import { getSetting, setSetting, getAllSettings } from './database.js';
import { config } from './config.js';
import {
  getText as registryGetText,
  getRawText as registryGetRawText,
  resolveTemplate,
} from './textRegistry.js';

/**
 * T() — unified text reader
 * Priority: custom_texts override → config.defaultTexts → settings → fallback
 */
export function T(key: string, fallback = ''): string {
  // 1. Try text registry first (custom_texts DB)
  const registryValue = registryGetRawText(key);
  if (registryValue) return registryValue;

  // 2. Legacy: settings table
  const dbVal = getSetting(key);
  if (dbVal !== null && dbVal !== '') return dbVal;

  // 3. config.defaultTexts
  const def = (config.defaultTexts as Record<string, string>)[key];
  return def ?? fallback;
}

export function render(template: string, vars: Record<string, string | number>): string {
  return resolveTemplate(template, vars);
}

export function C(key: string, fallback = '#2b2d31'): number {
  const raw = T(key, fallback);
  try { return parseInt(raw.replace('#', ''), 16); } catch { return parseInt(fallback.replace('#', ''), 16); }
}

export function seedDefaultTexts(): void {
  const existing = getAllSettings();
  let added = 0;
  for (const [k, v] of Object.entries(config.defaultTexts)) {
    if (!(k in existing)) {
      setSetting(k, v);
      added++;
    }
  }
  if (added > 0) console.log(`[Blade X] ✅ Seeded ${added} default text keys.`);
}

export function getTextsByPrefix(prefix: string): Record<string, string> {
  const all = getAllSettings();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(prefix)) out[k] = v;
  }
  return out;
}

// Re-export registry for convenience
export { getText, setText, resetText, listAllTexts, listCategories } from './textRegistry.js';