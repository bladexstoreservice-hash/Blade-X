// ============================================================
// Blade X — Among Us Manager · Custom ID helpers
// ============================================================

export const AUS_PREFIX = 'aus';

/** Build a namespaced custom id. Keeps ids short enough for Discord. */
export function buildId(...parts: Array<string | number>): string {
  return [AUS_PREFIX, ...parts.map(String)].join(':');
}

export function parseId(customId: string): string[] {
  return customId.split(':');
}

export function isAmongUsId(customId: string): boolean {
  return customId === AUS_PREFIX || customId.startsWith(`${AUS_PREFIX}:`);
}
