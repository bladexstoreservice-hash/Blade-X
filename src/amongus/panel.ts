// ============================================================
// Blade X — Among Us Manager · Dashboard panel (Components V2)
// ============================================================

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  TextChannel,
  type Client,
  type Guild,
  type Message,
} from 'discord.js';
import {
  getActiveAmongUsSession,
  getAmongUsHelperIds,
  getAmongUsPlayers,
  getAmongUsSession,
  setAmongUsControlMessage,
  setAmongUsSessionPanelRefs,
} from './database.js';
import { buildId } from './ids.js';
import { getSpeakingSettings, getSpeakingState } from './speaking/database.js';
import { describeSpeakingStatus } from './speaking/ui.js';
import type { SpeakingSettings, SpeakingState } from './speaking/types.js';
import {
  PHASE_COLORS,
  PHASE_LABELS,
  type AmongUsPhase,
  type AmongUsPlayer,
  type AmongUsSession,
  type AmongUsSettings,
} from './types.js';
import { buildV2Panel, buildV2Payload } from '../ui/v2.js';

export interface DashboardData {
  guild: Guild;
  settings: AmongUsSettings;
  session: AmongUsSession | null;
  players: AmongUsPlayer[];
  helpers: string[];
  speaking?: { settings: SpeakingSettings; state: SpeakingState | null };
}

export interface PanelUpdateResult {
  ok: boolean;
  messageId?: string;
  channelId?: string;
  error?: string;
}

function phaseInfo(session: AmongUsSession | null): { label: string; color: number } {
  if (!session) return { label: '⚪ No Active Session', color: 0x747f8d };
  if (session.recovery_mode === 1) return { label: '🟠 System Recovery', color: 0xf59e0b };
  const phase = session.current_phase as AmongUsPhase;
  return {
    label: PHASE_LABELS[phase] ?? phase,
    color: PHASE_COLORS[phase] ?? 0x5865f2,
  };
}

function formatChannel(id: string | null): string {
  return id ? `<#${id}>` : '`غير مضبوط`';
}

function buildActionRows(data: DashboardData): ActionRowBuilder<ButtonBuilder>[] {
  const { guild, session } = data;
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const row1 = new ActionRowBuilder<ButtonBuilder>();
  const row2 = new ActionRowBuilder<ButtonBuilder>();

  if (!session) {
    row1.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('panel', guild.id, 'create'))
        .setLabel('Create Session')
        .setEmoji('➕')
        .setStyle(ButtonStyle.Success),
    );
  } else {
    if (session.recovery_mode === 1) {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('panel', guild.id, 'resync', session.session_id))
          .setLabel('Resume Control')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Success),
      );
    }

    if (session.current_phase === 'waiting' || session.current_phase === 'round_ended') {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('panel', guild.id, 'start', session.session_id))
          .setLabel('Start Game')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Primary),
      );
    } else if (session.current_phase === 'in_game') {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('panel', guild.id, 'meeting', session.session_id))
          .setLabel('Start Meeting')
          .setEmoji('🚨')
          .setStyle(ButtonStyle.Primary),
      );
    } else if (session.current_phase === 'meeting') {
      row1.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('panel', guild.id, 'resume', session.session_id))
          .setLabel('Resume Game')
          .setEmoji('⏯️')
          .setStyle(ButtonStyle.Success),
      );
    }

    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('panel', guild.id, 'players', session.session_id))
        .setLabel('Manage Players')
        .setEmoji('👥')
        .setStyle(ButtonStyle.Secondary),
    );

    if (session.current_phase === 'in_game' || session.current_phase === 'meeting') {
      row2.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('panel', guild.id, 'endround', session.session_id))
          .setLabel('End Round')
          .setEmoji('🏁')
          .setStyle(ButtonStyle.Secondary),
      );
    }

    row2.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('panel', guild.id, 'endsession', session.session_id))
        .setLabel('End Session')
        .setEmoji('⛔')
        .setStyle(ButtonStyle.Danger),
    );
  }

  row2.addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('panel', guild.id, 'settings'))
      .setLabel('Settings')
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('panel', guild.id, 'refresh'))
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
  );

  // Independent optional layer — always reachable without affecting core actions.
  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('speak', guild.id, 'hub'))
      .setLabel('Speaking Manager')
      .setEmoji('🗣️')
      .setStyle(ButtonStyle.Secondary),
  );
  if (
    session?.current_phase === 'meeting' &&
    data.speaking?.settings.enabled &&
    data.speaking.state?.active
  ) {
    row3.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('speak', guild.id, 'request', session.session_id))
        .setLabel('Request to Speak')
        .setEmoji('🙋')
        .setStyle(ButtonStyle.Primary),
    );
    if (data.speaking.settings.quickEnabled) {
      row3.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('speak', guild.id, 'quick', session.session_id))
          .setLabel('Quick Interjection')
          .setEmoji('⚡')
          .setStyle(ButtonStyle.Secondary),
      );
    }
  }

  if (row1.components.length > 0) rows.push(row1);
  if (row2.components.length > 0) rows.push(row2);
  if (row3.components.length > 0) rows.push(row3);
  return rows;
}

export function buildDashboardContainer(data: DashboardData): ReturnType<typeof buildV2Panel> {
  const { guild, settings, session, players } = data;
  const info = phaseInfo(session);

  const participants = players.filter((p) => p.player_status !== 'pending');
  const pending = players.filter((p) => p.player_status === 'pending');
  const alive = participants.filter((p) => p.player_status === 'alive').length;
  const dead = participants.filter((p) => p.player_status === 'dead').length;
  const connected = participants.filter((p) => p.is_connected === 1).length;
  const muted = players.filter((p) => p.is_connected === 1 && p.expected_server_mute === 1).length;
  const open = players.filter((p) => p.is_connected === 1 && p.expected_server_mute === 0).length;
  const overrides = players.filter((p) => p.external_override === 1).length;

  const sections: Array<{ text: string }> = [
    {
      text:
        `**Server:** ${guild.name}\n` +
        `**Voice Room:** ${formatChannel(settings.voice_channel_id)}\n` +
        `**Control:** ${formatChannel(settings.control_channel_id)}`,
    },
    {
      text:
        `**Status:** ${info.label}\n` +
        `**Host:** ${session ? `<@${session.host_user_id}>` : '—'}\n` +
        `**Players:** ${participants.length} · 🟢 ${alive} alive · 💀 ${dead} dead\n` +
        `**Connected:** ${connected}/${participants.length}` +
        (pending.length > 0 ? ` · 🟡 ${pending.length} pending` : ''),
    },
    {
      text:
        `**Mics:** 🔇 ${muted} muted · 🔊 ${open} open` +
        (overrides > 0 ? ` · ⚠️ ${overrides} override` : ''),
    },
    {
      text: `**Last action:** ${session?.last_action ?? '—'}`,
    },
  ];

  if (session?.recovery_mode === 1) {
    sections.push({
      text:
        '🟠 **System Recovery**\n' +
        'تمت استعادة الجلسة بعد إعادة تشغيل البوت. التحكم التلقائي بالمايكات متوقف حتى يراجع المضيف الحالات ويضغط **Resume Control**.',
    });
  }

  if (overrides > 0) {
    sections.push({
      text:
        '⚠️ **External Mute Override**\n' +
        'تم رصد تعديل Server Mute من خارج اللوحة. البوت لن يرفع أو يفرض الكتم تلقائيًا. راجع اللاعب من **Manage Players**.',
    });
  }

  if (data.speaking) {
    sections.push({
      text: describeSpeakingStatus(data.speaking.settings, data.speaking.state, session?.current_phase ?? 'ended'),
    });
  }

  if (!session) {
    sections.push({ text: '-# اضغط **Create Session** لبدء جلسة جديدة من الروم الصوتي المحدد.' });
  } else if (session.current_phase === 'waiting') {
    sections.push({ text: '-# **Start Meeting** يتاح بعد بدء الجولة. لا يتم كتم أحد في مرحلة الانتظار.' });
  } else if (session.current_phase === 'in_game') {
    sections.push({ text: '-# **Resume Game** يتاح أثناء الاجتماع فقط.' });
  }

  return buildV2Panel({
    accentColor: info.color,
    title: '🚀 Among Us Manager',
    description: `-# ${guild.name} · Blade X`,
    sections,
    separatorBetweenSections: true,
    actionRows: buildActionRows(data) as any,
    footerText: 'Blade X · Among Us Manager',
  });
}

function isUnknownMessageError(e: unknown): boolean {
  const code = (e as { code?: number })?.code;
  if (code === 10008) return true;
  return String((e as { message?: string })?.message ?? '').toLowerCase().includes('unknown message');
}

// Serialise panel edits per guild so two interactions cannot create two panels.
const panelChains = new Map<string, Promise<unknown>>();

function withPanelLock<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
  const previous = panelChains.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  panelChains.set(guildId, next.catch(() => undefined));
  return next;
}

/** Create or update the single dashboard message for a guild. */
export function updateDashboardMessage(
  client: Client,
  guildId: string,
  settings: AmongUsSettings,
  session: AmongUsSession | null,
): Promise<PanelUpdateResult> {
  return withPanelLock(guildId, () => updateDashboardMessageInternal(client, guildId, settings, session));
}

async function updateDashboardMessageInternal(
  client: Client,
  guildId: string,
  settings: AmongUsSettings,
  session: AmongUsSession | null,
): Promise<PanelUpdateResult> {
  try {
    const guild =
      client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return { ok: false, error: 'السيرفر غير متاح.' };
    if (!settings.control_channel_id) {
      return { ok: false, error: 'قناة لوحة التحكم غير مضبوطة.' };
    }

    // Re-read the current state so queued updates never render stale data.
    const freshSession = session
      ? await getAmongUsSession(session.session_id)
      : await getActiveAmongUsSession(guildId);

    const channel =
      guild.channels.cache.get(settings.control_channel_id) ??
      (await guild.channels.fetch(settings.control_channel_id).catch(() => null));
    if (!channel || channel.type !== ChannelType.GuildText) {
      return { ok: false, error: 'قناة لوحة التحكم غير موجودة أو ليست قناة نصية.' };
    }

    const players = freshSession ? await getAmongUsPlayers(freshSession.session_id) : [];
    const helpers = freshSession ? await getAmongUsHelperIds(freshSession.session_id) : [];
    const speaking = {
      settings: await getSpeakingSettings(guildId),
      state: freshSession ? await getSpeakingState(freshSession.session_id) : null,
    };
    const container = buildDashboardContainer({
      guild,
      settings,
      session: freshSession,
      players,
      helpers,
      speaking,
    });
    const payload = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };

    let message: Message | null = null;
    if (settings.control_message_id) {
      try {
        message = await (channel as TextChannel).messages.fetch(settings.control_message_id);
      } catch (e) {
        if (!isUnknownMessageError(e)) {
          return {
            ok: false,
            error: `تعذر جلب رسالة اللوحة: ${(e as { message?: string })?.message ?? 'خطأ غير معروف'}`,
          };
        }
      }
    }

    if (message) {
      await message.edit(payload);
    } else {
      message = await (channel as TextChannel).send(payload);
      await setAmongUsControlMessage(guildId, channel.id, message.id);
      if (freshSession) {
        await setAmongUsSessionPanelRefs(freshSession.session_id, channel.id, message.id);
      }
    }

    return { ok: true, messageId: message.id, channelId: channel.id };
  } catch (e: unknown) {
    return {
      ok: false,
      error: (e as { message?: string })?.message ?? 'فشل تحديث لوحة التحكم.',
    };
  }
}

export function buildPanelLink(
  guildId: string,
  channelId: string | null | undefined,
  messageId: string | null | undefined,
): string | null {
  if (!channelId || !messageId) return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

/** Compact status card used by /amongus (ephemeral). */
export function buildStatusContainer(
  guild: Guild,
  settings: AmongUsSettings,
  session: AmongUsSession | null,
  players: AmongUsPlayer[],
  panelLink: string | null,
  panelError: string | null,
  canSettings: boolean,
): ReturnType<typeof buildV2Panel> {
  const info = phaseInfo(session);
  const participants = players.filter((p) => p.player_status !== 'pending');
  const alive = participants.filter((p) => p.player_status === 'alive').length;
  const dead = participants.filter((p) => p.player_status === 'dead').length;

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (panelLink) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Open Control Panel')
        .setEmoji('🚀')
        .setStyle(ButtonStyle.Link)
        .setURL(panelLink),
    );
  }
  if (canSettings) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('panel', guild.id, 'settings'))
        .setLabel('Settings')
        .setEmoji('⚙️')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  if (row.components.length > 0) rows.push(row);

  const sections = [
    {
      text:
        `**Server:** ${guild.name}\n` +
        `**Voice Room:** ${formatChannel(settings.voice_channel_id)}\n` +
        `**Status:** ${info.label}\n` +
        `**Host:** ${session ? `<@${session.host_user_id}>` : '—'}`,
    },
    {
      text:
        `**Players:** ${participants.length} · 🟢 ${alive} · 💀 ${dead}` +
        (session ? `\n**Last action:** ${session.last_action ?? '—'}` : ''),
    },
  ];

  if (panelError) {
    sections.push({ text: `⚠️ **Panel error:** ${panelError}` });
  }

  return buildV2Panel({
    accentColor: info.color,
    title: '🚀 Among Us Manager',
    description: `-# ${guild.name}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows as any,
    footerText: 'Blade X · Among Us Manager',
  });
}
