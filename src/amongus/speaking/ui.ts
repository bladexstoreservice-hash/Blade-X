// ============================================================
// Blade X — Among Us Manager · Speaking Manager UI
// Components V2 panels built with the project's existing helper.
// ============================================================

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
} from 'discord.js';
import { buildId } from '../ids.js';
import { buildV2Panel } from '../../ui/v2.js';
import {
  DURATION_FIELD_LABELS,
  formatClock,
  type SpeakingDurationField,
  type SpeakingSettings,
  type SpeakingState,
} from './types.js';

function button(guildId: string, action: string, label: string, emoji: string, style: ButtonStyle, extra?: string | number): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(buildId('speak', guildId, action, ...(extra === undefined ? [] : [extra])))
    .setLabel(label)
    .setEmoji(emoji)
    .setStyle(style);
}

/** Compact, read-only summary for the main dashboard. */
export function describeSpeakingStatus(
  settings: SpeakingSettings,
  state: SpeakingState | null,
  phase: string,
): string {
  const feature = settings.enabled ? '✅ Enabled' : '❌ Disabled';
  if (!settings.enabled) return `**Speaking Manager:** ${feature} · Inactive`;
  if (phase !== 'meeting' || !state?.active) {
    return `**Speaking Manager:** ${feature} · Inactive (applies during meetings)`;
  }
  const mode = state.paused
    ? '⏸️ Paused'
    : state.stage === 'round_robin'
      ? '🔄 Round Robin'
      : '💬 Open Discussion';
  const current = state.current ? `<@${state.current.userId}>` : '—';
  const remaining =
    state.turnEndsAt && !state.paused
      ? formatClock(state.turnEndsAt - Date.now())
      : formatClock(state.remainingMs);
  return (
    `**Speaking Manager:** ${feature} · Active During Meeting · ${mode}\n` +
    `**Current:** ${current} · **Remaining:** ${remaining} · **Queue:** ${state.queue.length}`
  );
}

export function buildSpeakingHub(
  guildId: string,
  settings: SpeakingSettings,
  state: SpeakingState | null,
  notice?: string,
  sessionId?: string | null,
): ReturnType<typeof buildV2Panel> {
  const feature = settings.enabled ? '✅ Enabled' : '❌ Disabled';
  const active = state?.active ? (state.paused ? '⏸️ Paused' : '🟢 Active During Meeting') : '⚪ Inactive';
  const stage = state ? state.stage : '—';
  const current = state?.current ? `<@${state.current.userId}>` : '—';
  const remaining = state
    ? state.paused
      ? formatClock(state.remainingMs)
      : state.turnEndsAt
        ? formatClock(state.turnEndsAt - Date.now())
        : '00:00'
    : '00:00';

  const queueLines = state && state.queue.length > 0
    ? state.queue
        .map((entry, i) => `${i + 1}. <@${entry.userId}> — ${entry.kind}${entry.prioritized ? ' (prioritized)' : ''}`)
        .slice(0, 20)
        .join('\n')
    : '`قائمة الانتظار فارغة`';

  const sections: Array<{ text: string }> = [
    {
      text:
        `**Feature:** ${feature}\n` +
        `**Status:** ${active}\n` +
        `**Stage:** ${stage}\n` +
        `**Current speaker:** ${current}\n` +
        `**Remaining:** ${remaining}`,
    },
    { text: `**Speaking Queue**\n${queueLines}` },
    {
      text:
        `**Durations:** RR ${settings.roundRobinSeconds}s · Open ${settings.openDiscussionSeconds}s · ` +
        `Quick ${settings.quickInterjectionSeconds}s · Extension ${settings.extensionSeconds}s\n` +
        `**Quick Interjection:** ${settings.quickEnabled ? '✅ Enabled' : '❌ Disabled'} · ` +
        `**Mandatory Round Robin:** ${settings.mandatoryRoundRobin ? '✅ Enabled' : '❌ Disabled'}\n` +
        `**Quick priority:** ${settings.quickPriority}`,
    },
  ];
  if (state?.error) sections.push({ text: `⚠️ **Voice state notice:** ${state.error}` });
  if (state?.lastAction) sections.push({ text: `-# Last action: ${state.lastAction}` });
  if (notice) sections.push({ text: notice });

  const sid = sessionId ?? state?.sessionId;
  const rows: any[] = [];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(guildId, 'enable', 'Enable', '✅', ButtonStyle.Success),
      button(guildId, 'disable', 'Disable', '⛔', ButtonStyle.Danger),
      button(guildId, 'settings', 'Speaking Settings', '⚙️', ButtonStyle.Secondary),
      button(guildId, 'refresh', 'Current Status', '🔄', ButtonStyle.Secondary),
    ),
  );
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(guildId, 'request', 'Request to Speak', '🙋', ButtonStyle.Primary, sid ?? guildId),
      button(guildId, 'quick', 'Quick Interjection', '⚡', ButtonStyle.Secondary, sid ?? guildId),
      button(guildId, 'vote', 'Start Voting', '🗳️', ButtonStyle.Primary, sid ?? guildId),
      button(guildId, 'back', 'Back', '◀️', ButtonStyle.Secondary),
    ),
  );

  if (sid) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        button(guildId, 'skip', 'Skip Speaker', '⏭️', ButtonStyle.Secondary, sid),
        button(guildId, 'extend', `Add ${settings.extensionSeconds}s`, '⏱️', ButtonStyle.Secondary, sid),
        button(guildId, 'pause', 'Pause', '⏸️', ButtonStyle.Secondary, sid),
        button(guildId, 'resume', 'Resume', '▶️', ButtonStyle.Success, sid),
        button(guildId, 'end', 'End Discussion', '🏁', ButtonStyle.Danger, sid),
      ),
    );
    rows.push(
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(buildId('speak', guildId, 'prioritize', sid))
          .setPlaceholder('Prioritize a player in the queue...')
          .setMinValues(1)
          .setMaxValues(1),
      ),
    );
    // Second select row would exceed five rows; removal is available through
    // the same queue panel via a string select below when there are entries.
    if (state && state.queue.length > 0) {
      rows.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(buildId('speak', guildId, 'remove', sid))
            .setPlaceholder('Remove a player from the queue...')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
              state.queue.slice(0, 25).map((entry) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel((entry.userId.slice(0, 32)))
                  .setValue(entry.userId)
                  .setDescription(`Position ${state.queue.indexOf(entry) + 1} · ${entry.kind}`)
                  .setEmoji('🗑️'),
              ),
            ),
        ),
      );
    }
  }

  return buildV2Panel({
    accentColor: settings.enabled ? 0xfee75c : 0x747f8d,
    title: '🗣️ Speaking Manager',
    description: `-# ${guildId} · optional meeting layer`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows,
    footerText: 'Blade X · Speaking Manager',
  });
}

export function buildSpeakingSettingsPanel(
  guildId: string,
  settings: SpeakingSettings,
  notice?: string,
): ReturnType<typeof buildV2Panel> {
  const fields: SpeakingDurationField[] = [
    'roundRobinSeconds',
    'openDiscussionSeconds',
    'quickInterjectionSeconds',
    'extensionSeconds',
  ];
  const sections: Array<{ text: string }> = [
    {
      text:
        `**Feature:** ${settings.enabled ? '✅ Enabled' : '❌ Disabled'}\n` +
        '-# التفعيل من لوحة Speaking Manager أو من زر Enable/Disable في الجلسة.',
    },
    {
      text: fields
        .map((f) => `**${DURATION_FIELD_LABELS[f]}:** ${settings[f]}s`)
        .join('\n'),
    },
    {
      text:
        `**Quick Interjection:** ${settings.quickEnabled ? '✅' : '❌'} · ` +
        `**Mandatory Round Robin:** ${settings.mandatoryRoundRobin ? '✅' : '❌'}\n` +
        `**Quick priority:** ${settings.quickPriority}`,
    },
  ];
  if (notice) sections.push({ text: notice });

  const rows: any[] = [];
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...fields.map((f) =>
        button(guildId, 'modal', DURATION_FIELD_LABELS[f], '⏱️', ButtonStyle.Secondary, f),
      ),
    ),
  );
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      button(guildId, 'toggle-quick', 'Quick: ' + (settings.quickEnabled ? 'ON' : 'OFF'), '⚡', ButtonStyle.Secondary),
      button(guildId, 'toggle-rr', 'Round Robin: ' + (settings.mandatoryRoundRobin ? 'ON' : 'OFF'), '🔄', ButtonStyle.Secondary),
      button(guildId, 'toggle-priority', 'Priority: ' + (settings.quickPriority === 'end' ? 'END' : 'NEXT'), '📊', ButtonStyle.Secondary),
      button(guildId, 'back', 'Close', '✖️', ButtonStyle.Secondary),
    ),
  );

  return buildV2Panel({
    accentColor: 0x5865f2,
    title: '⚙️ Speaking Settings',
    description: `-# ${guildId} · admins only`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows,
    footerText: 'Blade X · Speaking Manager',
  });
}

export interface DeadSelectDraftView {
  available: Array<{ id: string; name: string }>;
  selected: Set<string>;
}

/** Ephemeral "Select Dead Players" window used by Start Meeting. */
export function buildDeadSelectPanel(
  guildId: string,
  sessionId: string,
  draft: DeadSelectDraftView,
  notice?: string,
): ReturnType<typeof buildV2Panel> {
  const sections: Array<{ text: string }> = [
    { text: 'Select the players who are dead. Their microphones will remain muted during this meeting.' },
    {
      text:
        `**المتاحون:** ${draft.available.length}\n` +
        `**المحددون:** ${draft.selected.size}` +
        (draft.selected.size > 0
          ? `\n**الأموات المحددون:**\n${[...draft.selected].map((id) => `<@${id}>`).join('، ')}`
          : '\n-# لم يتم تحديد أحد — استخدم Skip إن لم يكن هناك أموات.'),
    },
  ];
  if (notice) sections.push({ text: notice });

  const rows: any[] = [];
  const chunks: Array<Array<{ id: string; name: string }>> = [];
  for (let i = 0; i < draft.available.length; i += 25) {
    chunks.push(draft.available.slice(i, i + 25));
    if (chunks.length >= 4) break;
  }
  chunks.forEach((chunk, index) => {
    rows.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(buildId('meet', guildId, sessionId, 'select', index))
          .setPlaceholder(`Select dead players (${index + 1}/${chunks.length})...`)
          .setMinValues(0)
          .setMaxValues(chunk.length)
          .addOptions(
            chunk.map((m) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(m.name.slice(0, 100))
                .setValue(m.id)
                .setDescription(draft.selected.has(m.id) ? '✅ محدد كميت' : 'اضغط للتحديد')
                .setEmoji(draft.selected.has(m.id) ? '💀' : '👤'),
            ),
          ),
      ),
    );
  });

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('meet', guildId, sessionId, 'confirm'))
        .setLabel('Confirm Selection')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildId('meet', guildId, sessionId, 'skip'))
        .setLabel('Skip – No One Dead')
        .setEmoji('⏭️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildId('meet', guildId, sessionId, 'cancel'))
        .setLabel('Cancel')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Danger),
    ),
  );

  return buildV2Panel({
    accentColor: 0xfee75c,
    title: '💀 Select Dead Players',
    description: `-# ${guildId}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows,
    footerText: 'Blade X · Among Us Manager',
  });
}
