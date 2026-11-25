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
import { buildV2Payload } from '../../ui/v2.js';
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
  if (!interaction.isRepliable() || interaction.replied || interaction.deferred) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

async function editV2(
  interaction: Interaction,
  container: ReturnType<typeof buildSpeakingHub>,
): Promise<void> {
  if (!interaction.isRepliable()) return;
  const payload = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
  } catch {
    // Stale interaction.
  }
}

async function updateV2(
  interaction: Interaction,
  container: ReturnType<typeof buildSpeakingHub>,
): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const payload = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
  } catch {
    // Stale interaction.
  }
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

async function showHub(
  interaction: Interaction,
  ctx: SpeakCtx,
  notice?: string,
  sessionId?: string | null,
): Promise<void> {
  const session = sessionId
    ? await getAmongUsSession(sessionId)
    : await getActiveAmongUsSession(ctx.guild.id);
  const settings = await getSpeakingSettings(ctx.guild.id);
  const state = session ? await getSpeakingState(session.session_id) : null;
  await updateV2(
    interaction,
    buildSpeakingHub(ctx.guild.id, settings, state, notice, session?.session_id),
  );
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
  await deferEphemeral(interaction);
  const settings = await getSpeakingSettings(guild.id);
  await editV2(
    interaction,
    buildSpeakingSettingsPanel(guild.id, settings, `${result.ok ? '✅' : '❌'} ${result.message}`),
  );
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
    const settings = await getSpeakingSettings(guild.id);
    await updateV2(interaction, buildSpeakingSettingsPanel(guild.id, settings));
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
    const fresh = await getSpeakingSettings(guild.id);
    await updateV2(interaction, buildSpeakingSettingsPanel(guild.id, fresh, `${result.ok ? '✅' : '❌'} ${result.message}`));
    return true;
  }

  if (action === 'hub' || action === 'refresh' || action === 'back') {
    await showHub(interaction, ctx, action === 'back' ? 'تم الرجوع إلى لوحة Speaking Manager.' : undefined, validSession?.session_id);
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
