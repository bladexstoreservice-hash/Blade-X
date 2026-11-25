// ============================================================
// Blade X — Among Us Manager · Speaking Manager interactions
// ============================================================

import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import {
  getActiveAmongUsSession,
  getAmongUsHelperIds,
  getAmongUsSettings,
  getAmongUsSession,
} from '../database.js';
import { buildId, isAmongUsId, parseId } from '../ids.js';
import {
  canManageSettings,
  canOperateSession,
  getAccessContext,
  type AccessContext,
} from '../permissions.js';
import { resumeGame } from '../session.js';
import type { AmongUsSession, AmongUsSettings } from '../types.js';
import {
  currentViewKind,
  goBack,
  navigateTo,
  renderPanelView,
  type PanelView,
} from '../navigation.js';
import {
  endSpeakingDiscussion,
  extendCurrentTurn,
  pauseSpeaking,
  prioritizeSpeakingPlayer,
  removeSpeakingPlayer,
  requestToSpeak,
  resumeSpeaking,
  setQuickPrioritySetting,
  setSpeakingDuration,
  setSpeakingToggleSetting,
  skipCurrentSpeaker,
  toggleSpeakingFeature,
} from './engine.js';
import { getSpeakingSettings, getSpeakingState } from './database.js';
import { buildSpeakingHub, buildSpeakingSettingsPanel } from './ui.js';
import {
  DURATION_FIELD_LABELS,
  type SpeakingDurationField,
  type SpeakingResult,
} from './types.js';

interface SpeakCtx {
  guild: Guild;
  member: GuildMember;
  settings: AmongUsSettings;
  access: AccessContext;
}

async function replyEphemeral(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  } catch {
    // Interaction expired.
  }
}

async function deferEphemeral(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent() || interaction.replied || interaction.deferred) return;
  await interaction.deferUpdate().catch(() => undefined);
}

/** All view changes edit the one shared panel message. */
async function editV2(interaction: Interaction, notice?: string): Promise<void> {
  if (!interaction.guild) return;
  await renderPanelView(interaction.client, interaction.guild.id, notice, interaction);
}

async function updateV2(interaction: Interaction, notice?: string): Promise<void> {
  await editV2(interaction, notice);
}

async function requireCtx(interaction: Interaction): Promise<SpeakCtx | null> {
  const guild = interaction.guild;
  if (!guild) {
    await replyEphemeral(interaction, '❌ هذا النظام يعمل داخل السيرفرات فقط.');
    return null;
  }
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await replyEphemeral(interaction, '❌ تعذر جلب عضويتك في السيرفر.');
    return null;
  }
  const settings = await getAmongUsSettings(guild.id);
  if (!settings || settings.setup_completed !== 1) {
    await replyEphemeral(interaction, '⚠️ نظام Among Us غير معد. استخدم `/amongus` أولًا.');
    return null;
  }
  return { guild, member, settings, access: getAccessContext(member, settings) };
}

async function canOperate(
  ctx: SpeakCtx,
  session: AmongUsSession | null,
): Promise<boolean> {
  if (canManageSettings(ctx.access)) return true;
  if (!session) return false;
  const helpers = await getAmongUsHelperIds(session.session_id);
  return canOperateSession(ctx.access, session, helpers);
}

export function speakingHubView(
  guild: Guild,
  userId: string,
  sessionId?: string | null,
): PanelView {
  return {
    kind: 'speaking',
    sessionId,
    render: async (notice) => {
      const settings = await getSpeakingSettings(guild.id);
      const active = await getActiveAmongUsSession(guild.id);
      const sid = sessionId ?? active?.session_id ?? null;
      const state = sid ? await getSpeakingState(sid) : null;
      return buildSpeakingHub(guild.id, settings, state, notice ?? undefined, sid);
    },
  };
}

/** Used by Start Meeting when the optional layer is enabled. */
export async function openSpeakingHubFromPanel(
  interaction: Interaction,
  guild: Guild,
  sessionId: string,
): Promise<void> {
  await navigateTo(
    interaction.client,
    guild.id,
    speakingHubView(guild, interaction.user.id, sessionId),
    interaction,
  );
}

function speakingSettingsView(guild: Guild): PanelView {
  return {
    kind: 'speaking-settings',
    render: async (notice) =>
      buildSpeakingSettingsPanel(
        guild.id,
        await getSpeakingSettings(guild.id),
        notice ?? undefined,
      ),
  };
}

async function showHub(
  interaction: Interaction,
  ctx: SpeakCtx,
  notice?: string,
  sessionId?: string | null,
): Promise<void> {
  if (currentViewKind(ctx.guild.id) === 'speaking') {
    await editV2(interaction, notice);
    return;
  }
  await navigateTo(
    interaction.client,
    ctx.guild.id,
    speakingHubView(ctx.guild, interaction.user.id, sessionId),
    interaction,
  );
  if (notice) await editV2(interaction, notice);
}

async function applyResult(
  interaction: Interaction,
  result: SpeakingResult,
  ctx: SpeakCtx,
  sessionId?: string | null,
): Promise<void> {
  const notice = `${result.ok ? '✅' : '❌'} ${result.message}`;
  await showHub(interaction, ctx, notice, sessionId);
}

function isDurationField(value: string | undefined): value is SpeakingDurationField {
  return !!value && Object.prototype.hasOwnProperty.call(DURATION_FIELD_LABELS, value);
}

async function handleModal(interaction: Interaction): Promise<boolean> {
  if (!interaction.isModalSubmit()) return false;
  if (!isAmongUsId(interaction.customId)) return false;
  const parts = parseId(interaction.customId);
  if (parts[1] !== 'speak') return false;
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id || parts[3] !== 'modal') return false;

  const ctx = await requireCtx(interaction);
  if (!ctx) return true;
  if (!canManageSettings(ctx.access)) {
    await replyEphemeral(interaction, '❌ الإعدادات متاحة للإدارة فقط.');
    return true;
  }
  if (!isDurationField(parts[4])) {
    await replyEphemeral(interaction, '❌ حقل إعداد غير معروف.');
    return true;
  }
  const raw = interaction.fields.getTextInputValue('duration');
  const result = await setSpeakingDuration(guild.id, parts[4], raw, interaction.user.id);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
  await renderPanelView(
    interaction.client,
    guild.id,
    `${result.ok ? '✅' : '❌'} ${result.message}`,
  );
  await interaction
    .editReply({ content: `${result.ok ? '✅' : '❌'} ${result.message}` })
    .catch(() => undefined);
  return true;
}

export async function handleSpeakingInteraction(interaction: Interaction): Promise<boolean> {
  if (await handleModal(interaction)) return true;
  if (!interaction.isMessageComponent()) return false;
  if (!isAmongUsId(interaction.customId)) return false;
  const parts = parseId(interaction.customId);
  if (parts[1] !== 'speak') return false;

  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return false;
  const ctx = await requireCtx(interaction);
  if (!ctx) return true;

  const action = parts[3];
  const sessionId = parts[4] && parts[4] !== guild.id ? parts[4] : null;
  const session = sessionId ? await getAmongUsSession(sessionId) : await getActiveAmongUsSession(guild.id);
  const validSession = session && session.guild_id === guild.id && session.status === 'active' ? session : null;

  if (action === 'enable' || action === 'disable') {
    if (!(await canOperate(ctx, validSession))) {
      await replyEphemeral(interaction, '❌ لا تملك صلاحية تفعيل/تعطيل Speaking Manager.');
      return true;
    }
    await deferEphemeral(interaction);
    const result = await toggleSpeakingFeature(guild.id, action === 'enable', interaction.user.id);
    await applyResult(interaction, result, ctx, validSession?.session_id);
    return true;
  }

  if (action === 'settings') {
    if (!canManageSettings(ctx.access)) {
      await replyEphemeral(interaction, '❌ Speaking Settings متاحة للإدارة فقط.');
      return true;
    }
    await navigateTo(interaction.client, guild.id, speakingSettingsView(guild), interaction);
    return true;
  }

  if (action === 'modal') {
    if (!canManageSettings(ctx.access)) {
      await replyEphemeral(interaction, '❌ الإعدادات متاحة للإدارة فقط.');
      return true;
    }
    if (!isDurationField(parts[4])) {
      await replyEphemeral(interaction, '❌ حقل إعداد غير معروف.');
      return true;
    }
    // showModal must be the first response — never defer before this.
    const modal = new ModalBuilder()
      .setCustomId(buildId('speak', guild.id, 'modal', parts[4]))
      .setTitle(DURATION_FIELD_LABELS[parts[4]]);
    const input = new TextInputBuilder()
      .setCustomId('duration')
      .setLabel('Duration (seconds)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('5-300')
      .setMinLength(1)
      .setMaxLength(3)
      .setRequired(true);
    const settings = await getSpeakingSettings(guild.id);
    input.setValue(String(settings[parts[4]]));
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'toggle-quick' || action === 'toggle-rr' || action === 'toggle-priority') {
    if (!canManageSettings(ctx.access)) {
      await replyEphemeral(interaction, '❌ الإعدادات متاحة للإدارة فقط.');
      return true;
    }
    const settings = await getSpeakingSettings(guild.id);
    let result: SpeakingResult;
    if (action === 'toggle-quick') {
      result = await setSpeakingToggleSetting(guild.id, 'quickEnabled', !settings.quickEnabled, interaction.user.id);
    } else if (action === 'toggle-rr') {
      result = await setSpeakingToggleSetting(guild.id, 'mandatoryRoundRobin', !settings.mandatoryRoundRobin, interaction.user.id);
    } else {
      result = await setQuickPrioritySetting(
        guild.id,
        settings.quickPriority === 'end' ? 'after-current' : 'end',
        interaction.user.id,
      );
    }
    await editV2(interaction, `${result.ok ? '✅' : '❌'} ${result.message}`);
    return true;
  }

  if (action === 'back') {
    await goBack(interaction.client, guild.id, interaction);
    return true;
  }

  if (action === 'hub') {
    if (currentViewKind(guild.id) === 'speaking-settings') {
      await goBack(interaction.client, guild.id, interaction);
    } else {
      await showHub(interaction, ctx, undefined, validSession?.session_id);
    }
    return true;
  }

  if (action === 'refresh') {
    await editV2(interaction);
    return true;
  }

  if (!validSession) {
    await replyEphemeral(interaction, '⌛ لا توجد جلسة نشطة.');
    return true;
  }

  if (action === 'request' || action === 'quick') {
    await deferEphemeral(interaction);
    const result = await requestToSpeak(
      validSession.session_id,
      interaction.user.id,
      action === 'quick' ? 'quick' : 'round_robin',
      interaction.user.id,
    );
    await applyResult(interaction, result, ctx, validSession.session_id);
    return true;
  }

  if (!(await canOperate(ctx, validSession))) {
    await replyEphemeral(interaction, '❌ لا تملك صلاحية أدوات المضيف هذه.');
    return true;
  }

  if (action === 'skip' || action === 'extend' || action === 'pause' || action === 'resume' || action === 'end' || action === 'vote') {
    await deferEphemeral(interaction);
    let result: SpeakingResult;
    if (action === 'skip') result = await skipCurrentSpeaker(validSession.session_id, interaction.user.id);
    else if (action === 'extend') result = await extendCurrentTurn(validSession.session_id, interaction.user.id);
    else if (action === 'pause') result = await pauseSpeaking(validSession.session_id, interaction.user.id);
    else if (action === 'resume') result = await resumeSpeaking(validSession.session_id, interaction.user.id);
    else {
      const stopped = await endSpeakingDiscussion(validSession.session_id, interaction.user.id);
      const game = await resumeGame(ctx.guild, ctx.settings, validSession.session_id, interaction.user.id);
      result = {
        ok: stopped.ok && game.ok,
        message: `${stopped.message}\n${game.message}`,
      };
    }
    await applyResult(interaction, result, ctx, validSession.session_id);
    return true;
  }

  if (action === 'prioritize' && interaction.isUserSelectMenu()) {
    const notices: string[] = [];
    for (const userId of interaction.values) {
      const result = await prioritizeSpeakingPlayer(validSession.session_id, userId, interaction.user.id);
      notices.push(`${result.ok ? '✅' : '❌'} ${result.message}`);
    }
    await showHub(interaction, ctx, notices.join('\n'), validSession.session_id);
    return true;
  }

  if (action === 'remove' && interaction.isStringSelectMenu()) {
    const notices: string[] = [];
    for (const userId of interaction.values) {
      const result = await removeSpeakingPlayer(validSession.session_id, userId, interaction.user.id);
      notices.push(`${result.ok ? '✅' : '❌'} ${result.message}`);
    }
    await showHub(interaction, ctx, notices.join('\n'), validSession.session_id);
    return true;
  }

  return true;
}
