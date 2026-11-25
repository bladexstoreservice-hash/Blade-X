// ============================================================
// Blade X — Among Us Manager · Interactions & UI
// ============================================================

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
  UserSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
} from 'discord.js';
import {
  getActiveAmongUsSession,
  getAmongUsHelperIds,
  getAmongUsPlayer,
  getAmongUsPlayers,
  getAmongUsSettings,
  getAmongUsSession,
  setAmongUsChannels,
  setAmongUsControlMessage,
  setAmongUsRoles,
} from './database.js';
import { buildId, isAmongUsId, parseId } from './ids.js';
import { recordEvent } from './logger.js';
import {
  buildDashboardContainer,
  buildPanelLink,
  buildStatusContainer,
  updateDashboardMessage,
} from './panel.js';
import {
  canAccessSystem,
  canHost,
  canManageSessionHelpers,
  canManageSettings,
  canOperateSession,
  getAccessContext,
  type AccessContext,
} from './permissions.js';
import {
  acceptPendingPlayer,
  addSessionHelper,
  createSession,
  endRound,
  endSession,
  listEligibleMembers,
  markPlayerDead,
  removePendingPlayer,
  removeSessionHelper,
  resyncSession,
  restorePlayerAlive,
  restorePlayerControl,
  resumeGame,
  startGame,
  startMeeting,
} from './session.js';
import {
  handleSetupInteraction,
  runPermissionCheck,
  startSetup,
  type SetupCheckResult,
} from './setup.js';
import {
  PLAYER_STATUS_LABELS,
  type AmongUsPlayer,
  type AmongUsSession,
  type AmongUsSettings,
} from './types.js';
import { buildV2Panel, buildV2Payload } from '../ui/v2.js';
import { handleSpeakingInteraction } from './speaking/interactions.js';
import { buildDeadSelectPanel } from './speaking/ui.js';

// ============================================================
// Small shared helpers
// ============================================================
interface Ctx {
  guild: Guild;
  member: GuildMember;
  settings: AmongUsSettings;
  access: AccessContext;
}

interface CreationDraft {
  guildId: string;
  hostId: string;
  selected: Set<string>;
  available: Array<{ id: string; name: string }>;
  expiresAt: number;
}

const creationDrafts = new Map<string, CreationDraft>();
const CREATION_TTL_MS = 10 * 60_000;

interface MeetingDraft {
  guildId: string;
  hostId: string;
  sessionId: string;
  selected: Set<string>;
  available: Array<{ id: string; name: string }>;
  expiresAt: number;
}

const meetingDrafts = new Map<string, MeetingDraft>();
const MEETING_TTL_MS = 10 * 60_000;

function creationKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function cleanupCreationDrafts(): void {
  const now = Date.now();
  for (const [key, draft] of creationDrafts) {
    if (draft.expiresAt < now) creationDrafts.delete(key);
  }
}

function formatChannel(id: string | null | undefined): string {
  return id ? `<#${id}>` : '`غير مضبوط`';
}

function formatRoles(ids: string[]): string {
  return ids.length > 0 ? ids.map((id) => `<@&${id}>`).join('، ') : '`لا يوجد`';
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
    // Interaction expired or already acknowledged.
  }
}

async function deferEphemeral(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable() || interaction.replied || interaction.deferred) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);
}

async function deferUpdateSafe(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent() || interaction.replied || interaction.deferred) return;
  await interaction.deferUpdate().catch(() => undefined);
}

async function updateV2(
  interaction: Interaction,
  container: ReturnType<typeof buildV2Panel>,
): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const payload = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.update(payload);
  } catch {
    // Old/stale ephemeral message.
  }
}

async function editV2(
  interaction: Interaction,
  container: ReturnType<typeof buildV2Panel>,
): Promise<void> {
  if (!interaction.isRepliable()) return;
  const payload = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
  } catch {
    // Interaction expired.
  }
}

async function requireCtx(interaction: Interaction): Promise<Ctx | null> {
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
    await replyEphemeral(interaction, '⚠️ نظام Among Us غير معد. استخدم `/amongus` لإكمال الإعداد.');
    return null;
  }
  return { guild, member, settings, access: getAccessContext(member, settings) };
}

async function refreshPanel(
  interaction: Interaction,
  ctx: Ctx,
  session: AmongUsSession | null,
): Promise<string | null> {
  const freshSettings = await getAmongUsSettings(ctx.guild.id);
  if (!freshSettings) return 'إعدادات النظام غير موجودة.';
  const freshSession = session
    ? await getAmongUsSession(session.session_id)
    : await getActiveAmongUsSession(ctx.guild.id);
  const result = await updateDashboardMessage(
    interaction.client,
    ctx.guild.id,
    freshSettings,
    freshSession,
  );
  return result.ok ? null : result.error ?? 'تعذر تحديث لوحة التحكم.';
}

async function loadSessionOrReply(
  interaction: Interaction,
  ctx: Ctx,
  sessionId: string,
): Promise<AmongUsSession | null> {
  const session = await getAmongUsSession(sessionId);
  if (!session || session.guild_id !== ctx.guild.id || session.status !== 'active') {
    await replyEphemeral(interaction, '⌛ هذه الجلسة لم تعد نشطة. تم تحديث اللوحة.');
    await refreshPanel(interaction, ctx, null);
    return null;
  }
  return session;
}

async function canOperateOrReply(
  interaction: Interaction,
  ctx: Ctx,
  session: AmongUsSession,
): Promise<boolean> {
  const helpers = await getAmongUsHelperIds(session.session_id);
  if (!canOperateSession(ctx.access, session, helpers)) {
    await replyEphemeral(interaction, '❌ لا تملك صلاحية تنفيذ هذا الإجراء في الجلسة.');
    return false;
  }
  return true;
}

// ============================================================
// Slash command
// ============================================================
export async function handleAmongUsCommand(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({
      content: '❌ هذا الأمر للسيرفرات فقط.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Acknowledge early: setup/render and panel updates can take a few seconds.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply({ content: '❌ تعذر جلب عضويتك في السيرفر.' }).catch(() => undefined);
    return;
  }

  const settings = await getAmongUsSettings(guild.id);
  const access = getAccessContext(member, settings);

  if (!settings || settings.setup_completed !== 1) {
    if (!canManageSettings(access)) {
      await interaction
        .editReply({ content: '❌ نظام Among Us لم يُعد بعد، وليس لديك صلاحية إعداده.' })
        .catch(() => undefined);
      return;
    }
    await startSetup(interaction);
    return;
  }

  if (!canAccessSystem(access)) {
    await interaction
      .editReply({ content: '❌ لا تملك صلاحية الوصول إلى Among Us Manager في هذا السيرفر.' })
      .catch(() => undefined);
    return;
  }

  const session = await getActiveAmongUsSession(guild.id);
  const panel = await updateDashboardMessage(interaction.client, guild.id, settings, session);
  const players = session ? await getAmongUsPlayers(session.session_id) : [];
  const link = buildPanelLink(
    guild.id,
    panel.channelId ?? settings.control_channel_id,
    panel.messageId ?? settings.control_message_id,
  );

  const container = buildStatusContainer(
    guild,
    settings,
    session,
    players,
    link,
    panel.ok ? null : panel.error ?? 'تعذر تحديث اللوحة.',
    canManageSettings(access),
  );

  const payload = buildV2Payload(container);
  await interaction.editReply({
    ...(payload as any),
    flags: payload.flags,
    allowedMentions: { parse: [] },
  }).catch(() => undefined);
}

// ============================================================
// Interaction router
// ============================================================
export async function handleAmongUsInteraction(interaction: Interaction): Promise<boolean> {
  // Modals are not MessageComponents — route them before the guard below.
  if (interaction.isModalSubmit() && isAmongUsId(interaction.customId)) {
    await handleSpeakingInteraction(interaction);
    return true;
  }
  if (!interaction.isMessageComponent()) return false;
  if (!isAmongUsId(interaction.customId)) return false;

  const parts = parseId(interaction.customId);
  switch (parts[1]) {
    case 'setup':
      await handleSetupInteraction(interaction);
      return true;
    case 'panel':
      await handlePanelInteraction(interaction);
      return true;
    case 'settings':
      await handleSettingsInteraction(interaction);
      return true;
    case 'create':
      await handleCreateInteraction(interaction);
      return true;
    case 'players':
      await handlePlayersInteraction(interaction);
      return true;
    case 'pact':
      await handlePlayerAction(interaction);
      return true;
    case 'helpers':
      await handleHelpersInteraction(interaction);
      return true;
    case 'speak':
      await handleSpeakingInteraction(interaction);
      return true;
    case 'meet':
      await handleDeadSelectionInteraction(interaction);
      return true;
    default:
      return true;
  }
}

// ============================================================
// Panel buttons
// ============================================================
async function handlePanelInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  const parts = parseId(interaction.customId);
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return;

  const ctx = await requireCtx(interaction);
  if (!ctx) return;
  if (!canAccessSystem(ctx.access)) {
    await replyEphemeral(interaction, '❌ لا تملك صلاحية الوصول إلى Among Us Manager.');
    return;
  }

  const action = parts[3];
  const sessionId = parts[4] ?? null;

  if (action === 'create') {
    if (!canHost(ctx.access)) {
      await replyEphemeral(interaction, '❌ إنشاء الجلسات متاح للمضيفين المصرّح لهم فقط.');
      return;
    }
    await deferEphemeral(interaction);
    const active = await getActiveAmongUsSession(guild.id);
    if (active) {
      await editPlain(interaction, '❌ توجد جلسة نشطة بالفعل. أنهِها أولًا.');
      return;
    }
    cleanupCreationDrafts();
    const members = await listEligibleMembers(guild, ctx.settings);
    if (members.length === 0) {
      await editPlain(interaction, '❌ لا يوجد أعضاء غير بوت داخل الروم الصوتي الثابت.');
      return;
    }
    const draft: CreationDraft = {
      guildId: guild.id,
      hostId: interaction.user.id,
      selected: new Set<string>(),
      available: members.map((m) => ({ id: m.id, name: m.displayName })),
      expiresAt: Date.now() + CREATION_TTL_MS,
    };
    creationDrafts.set(creationKey(guild.id, interaction.user.id), draft);
    await editV2(interaction, buildCreatePanel(ctx, draft));
    return;
  }

  if (action === 'settings') {
    if (!canManageSettings(ctx.access)) {
      await replyEphemeral(interaction, '❌ إعدادات السيرفر متاحة لمالك السيرفر أو الإدارة فقط.');
      return;
    }
    await deferEphemeral(interaction);
    const session = await getActiveAmongUsSession(guild.id);
    await editV2(interaction, buildSettingsPanel(ctx, session));
    return;
  }

  if (action === 'refresh') {
    await deferEphemeral(interaction);
    const error = await refreshPanel(interaction, ctx, null);
    await editPlain(interaction, error ? `⚠️ ${error}` : '✅ تم تحديث لوحة التحكم.');
    return;
  }

  if (!sessionId) {
    await replyEphemeral(interaction, '❌ معرف الجلسة مفقود.');
    return;
  }
  const session = await loadSessionOrReply(interaction, ctx, sessionId);
  if (!session) return;
  if (!(await canOperateOrReply(interaction, ctx, session))) return;

  if (action === 'players') {
    await deferEphemeral(interaction);
    const players = await getAmongUsPlayers(session.session_id);
    await editV2(interaction, buildPlayerListPanel(ctx, session, players));
    return;
  }

  if (action === 'helpers') {
    if (!canManageSessionHelpers(ctx.access, session)) {
      await replyEphemeral(interaction, '❌ إدارة المضيفين المساعدين متاحة للمضيف الأساسي أو الإدارة فقط.');
      return;
    }
    await deferEphemeral(interaction);
    const helpers = await getAmongUsHelperIds(session.session_id);
    await editV2(interaction, buildHelpersPanel(ctx, session, helpers));
    return;
  }

  if (action === 'endsession') {
    await deferEphemeral(interaction);
    await editV2(interaction, buildEndSessionConfirm(ctx, session));
    return;
  }

  if (action === 'endsession-cancel') {
    await updateV2(
      interaction,
      buildV2Panel({
        accentColor: 0x747f8d,
        title: '✖️ End Session Cancelled',
        sections: [{ text: 'لم يتم إنهاء الجلسة.' }],
        footerText: 'Blade X · Among Us Manager',
      }),
    );
    return;
  }

  // Start Meeting now opens a dead-player selection window first.
  if (action === 'meeting') {
    await deferEphemeral(interaction);
    await showDeadSelection(interaction, ctx, session);
    return;
  }

  await deferEphemeral(interaction);

  let result;
  if (action === 'start') {
    result = await startGame(guild, ctx.settings, session.session_id, interaction.user.id);
  } else if (action === 'resume') {
    result = await resumeGame(guild, ctx.settings, session.session_id, interaction.user.id);
  } else if (action === 'endround') {
    result = await endRound(guild, ctx.settings, session.session_id, interaction.user.id);
  } else if (action === 'endsession-confirm') {
    result = await endSession(guild, ctx.settings, session.session_id, interaction.user.id);
  } else if (action === 'resync') {
    result = await resyncSession(guild, ctx.settings, session.session_id, interaction.user.id);
  } else {
    await editPlain(interaction, '❌ إجراء غير معروف.');
    return;
  }

  const panelError = await refreshPanel(interaction, ctx, result.session ?? null);
  await editPlain(
    interaction,
    `${result.message}${panelError ? `\n⚠️ ${panelError}` : ''}`,
  );
}

async function editPlain(interaction: Interaction, content: string): Promise<void> {
  if (!interaction.isRepliable()) return;
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch {
    // Expired interaction.
  }
}

// ============================================================
// Start Meeting → Select Dead Players (ephemeral User/User-like select)
// Uses a StringSelectMenu over session participants because Discord
// does not allow User Select Menus inside a Modal.
// ============================================================
function meetingKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

async function showDeadSelection(
  interaction: Interaction,
  ctx: Ctx,
  session: AmongUsSession,
  notice?: string,
): Promise<void> {
  const players = await getAmongUsPlayers(session.session_id);
  const available = players
    .filter((p) => p.player_status !== 'dead' && p.player_status !== 'pending')
    .map((p) => ({ id: p.user_id, name: p.display_name ?? p.user_id }));
  const key = meetingKey(ctx.guild.id, interaction.user.id);
  const draft: MeetingDraft = {
    guildId: ctx.guild.id,
    hostId: interaction.user.id,
    sessionId: session.session_id,
    selected: new Set<string>(),
    available,
    expiresAt: Date.now() + MEETING_TTL_MS,
  };
  meetingDrafts.set(key, draft);
  await editV2(interaction, buildDeadSelectPanel(ctx.guild.id, session.session_id, draft, notice));
}

async function handleDeadSelectionInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const parts = parseId(interaction.customId);
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return;

  const ctx = await requireCtx(interaction);
  if (!ctx) return;
  const session = await loadSessionOrReply(interaction, ctx, parts[3]);
  if (!session) return;
  if (!(await canOperateOrReply(interaction, ctx, session))) return;

  const key = meetingKey(guild.id, interaction.user.id);
  const draft = meetingDrafts.get(key);
  if (!draft || draft.expiresAt < Date.now() || draft.sessionId !== session.session_id) {
    meetingDrafts.delete(key);
    await replyEphemeral(interaction, '⌛ انتهت صلاحية نافذة اختيار الأموات. اضغط Start Meeting من جديد.');
    return;
  }

  const action = parts[4];
  if (action === 'select' && interaction.isStringSelectMenu()) {
    for (const userId of interaction.values) {
      if (draft.available.some((m) => m.id === userId)) draft.selected.add(userId);
    }
    draft.expiresAt = Date.now() + MEETING_TTL_MS;
    await updateV2(interaction, buildDeadSelectPanel(guild.id, session.session_id, draft));
    return;
  }

  if (action === 'cancel') {
    meetingDrafts.delete(key);
    await updateV2(
      interaction,
      buildV2Panel({
        accentColor: 0x747f8d,
        title: '✖️ Start Meeting Cancelled',
        sections: [{ text: 'تم الإلغاء — لم تتغير المرحلة أو حالات اللاعبين أو المايكات.' }],
        footerText: 'Blade X · Among Us Manager',
      }),
    );
    return;
  }

  await deferUpdateSafe(interaction);

  if (action === 'confirm') {
    // Server-side validation: only current session participants may be marked dead.
    const validSelected: string[] = [];
    for (const userId of draft.selected) {
      const player = await getAmongUsPlayer(session.session_id, userId);
      if (!player || player.player_status === 'dead' || player.player_status === 'pending') continue;
      validSelected.push(userId);
    }
    for (const userId of validSelected) {
      await markPlayerDead(guild, ctx.settings, session.session_id, userId, interaction.user.id);
    }
  }
  // Skip intentionally keeps every previous dead state untouched.

  const result = await startMeeting(guild, ctx.settings, session.session_id, interaction.user.id);
  meetingDrafts.delete(key);
  const panelError = await refreshPanel(interaction, ctx, result.session ?? null);
  await editPlain(
    interaction,
    `${result.message}${panelError ? `\n⚠️ ${panelError}` : ''}`,
  );
}

// ============================================================
// Create session UI
// ============================================================
function buildCreatePanel(ctx: Ctx, draft: CreationDraft): ReturnType<typeof buildV2Panel> {
  const selectedNames = draft.available
    .filter((m) => draft.selected.has(m.id))
    .map((m) => m.name);

  const sections: Array<{ text: string }> = [
    {
      text:
        `**الروم الصوتي:** ${formatChannel(ctx.settings.voice_channel_id)}\n` +
        `**المتاحون في الروم:** ${draft.available.length}\n` +
        `**المحددون:** ${draft.selected.size}`,
    },
    {
      text:
        selectedNames.length > 0
          ? `**اللاعبون المحددون:**\n${selectedNames.slice(0, 40).join('، ')}${selectedNames.length > 40 ? '…' : ''}`
          : '-# اختر اللاعبين من القوائم أدناه، أو اضغط **Select All**.',
    },
  ];

  const rows: ActionRowBuilder<any>[] = [];
  const chunks: Array<Array<{ id: string; name: string }>> = [];
  for (let i = 0; i < draft.available.length; i += 25) {
    chunks.push(draft.available.slice(i, i + 25));
    if (chunks.length >= 4) break;
  }

  chunks.forEach((chunk, index) => {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildId('create', ctx.guild.id, 'select', index))
      .setPlaceholder(`اختر اللاعبين (${index + 1}/${chunks.length})...`)
      .setMinValues(0)
      .setMaxValues(chunk.length)
      .addOptions(
        chunk.map((m) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(m.name.slice(0, 100))
            .setValue(m.id)
            .setDescription(draft.selected.has(m.id) ? '✅ محدد' : 'اضغط للتحديد')
            .setEmoji(draft.selected.has(m.id) ? '✅' : '👤'),
        ),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  });

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('create', ctx.guild.id, 'all'))
      .setLabel('Select All')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('create', ctx.guild.id, 'clear'))
      .setLabel('Clear')
      .setEmoji('🧹')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('create', ctx.guild.id, 'confirm'))
      .setLabel('Create Session')
      .setEmoji('🚀')
      .setStyle(ButtonStyle.Success)
      .setDisabled(draft.selected.size === 0),
    new ButtonBuilder()
      .setCustomId(buildId('create', ctx.guild.id, 'cancel'))
      .setLabel('Cancel')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Danger),
  );
  rows.push(buttonRow);

  return buildV2Panel({
    accentColor: 0x5865f2,
    title: '➕ Create Among Us Session',
    description: `-# ${ctx.guild.name}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows as any,
    footerText: 'Blade X · Among Us Manager',
  });
}

async function handleCreateInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const parts = parseId(interaction.customId);
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return;

  const ctx = await requireCtx(interaction);
  if (!ctx) return;
  if (!canHost(ctx.access)) {
    await replyEphemeral(interaction, '❌ إنشاء الجلسات متاح للمضيفين المصرّح لهم فقط.');
    return;
  }

  const key = creationKey(guild.id, interaction.user.id);
  const draft = creationDrafts.get(key);
  if (!draft || draft.expiresAt < Date.now()) {
    creationDrafts.delete(key);
    await replyEphemeral(interaction, '⌛ انتهت صلاحية شاشة الإنشاء. اضغط Create Session من جديد.');
    return;
  }

  const action = parts[3];
  if (action === 'select' && interaction.isStringSelectMenu()) {
    for (const id of interaction.values) {
      if (draft.available.some((m) => m.id === id)) draft.selected.add(id);
    }
    draft.expiresAt = Date.now() + CREATION_TTL_MS;
    await updateV2(interaction, buildCreatePanel(ctx, draft));
    return;
  }

  if (action === 'all' && interaction.isButton()) {
    draft.selected = new Set(draft.available.map((m) => m.id));
    draft.expiresAt = Date.now() + CREATION_TTL_MS;
    await updateV2(interaction, buildCreatePanel(ctx, draft));
    return;
  }

  if (action === 'clear' && interaction.isButton()) {
    draft.selected.clear();
    draft.expiresAt = Date.now() + CREATION_TTL_MS;
    await updateV2(interaction, buildCreatePanel(ctx, draft));
    return;
  }

  if (action === 'cancel' && interaction.isButton()) {
    creationDrafts.delete(key);
    await updateV2(
      interaction,
      buildV2Panel({
        accentColor: 0x747f8d,
        title: '✖️ Creation Cancelled',
        sections: [{ text: 'تم إلغاء إنشاء الجلسة.' }],
        footerText: 'Blade X · Among Us Manager',
      }),
    );
    return;
  }

  if (action === 'confirm' && interaction.isButton()) {
    await deferUpdateSafe(interaction);
    const result = await createSession(guild, ctx.settings, interaction.user.id, [...draft.selected]);
    if (!result.ok) {
      await editPlain(interaction, result.message);
      return;
    }
    creationDrafts.delete(key);
    const panelError = await refreshPanel(interaction, ctx, result.session ?? null);
    const link = buildPanelLink(
      guild.id,
      ctx.settings.control_channel_id,
      (await getAmongUsSettings(guild.id))?.control_message_id,
    );
    await editPlain(
      interaction,
      `${result.message}${link ? `\n[فتح لوحة التحكم](${link})` : ''}${
        panelError ? `\n⚠️ ${panelError}` : ''
      }`,
    );
    return;
  }
}

// ============================================================
// Player management UI
// ============================================================
function buildPlayerListPanel(
  ctx: Ctx,
  session: AmongUsSession,
  players: AmongUsPlayer[],
): ReturnType<typeof buildV2Panel> {
  const alive = players.filter((p) => p.player_status === 'alive').length;
  const dead = players.filter((p) => p.player_status === 'dead').length;
  const pending = players.filter((p) => p.player_status === 'pending').length;

  const sections: Array<{ text: string }> = [
    {
      text:
        `**الجلسة:** ${session.session_id}\n` +
        `**المرحلة:** ${session.current_phase}\n` +
        `**اللاعبون:** ${players.length} · 🟢 ${alive} · 💀 ${dead}` +
        (pending > 0 ? ` · 🟡 ${pending} pending` : ''),
    },
    {
      text:
        'اختر لاعبًا من القائمة لعرض حالته وتغييرها. ' +
        'اللاعبون الأموات يبقون مكتومين أثناء الاجتماع.',
    },
  ];

  const rows: ActionRowBuilder<any>[] = [];
  const chunks: AmongUsPlayer[][] = [];
  for (let i = 0; i < players.length; i += 25) {
    chunks.push(players.slice(i, i + 25));
    if (chunks.length >= 4) break;
  }

  chunks.forEach((chunk, index) => {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(buildId('players', ctx.guild.id, session.session_id, 'select', index))
      .setPlaceholder(`اختر لاعبًا (${index + 1}/${chunks.length})...`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        chunk.map((p) =>
          new StringSelectMenuOptionBuilder()
            .setLabel((p.display_name ?? p.user_id).slice(0, 100))
            .setValue(p.user_id)
            .setDescription(
              `${PLAYER_STATUS_LABELS[p.player_status]} · ${
                p.is_connected ? 'متصل' : 'غير متصل'
              }${p.external_override ? ' · ⚠️ Override' : ''}`.slice(0, 100),
            )
            .setEmoji(p.player_status === 'dead' ? '💀' : p.player_status === 'pending' ? '🟡' : '🟢'),
        ),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  });

  const buttonRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId('players', ctx.guild.id, session.session_id, 'helpers'))
      .setLabel('Session Helpers')
      .setEmoji('🤝')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('players', ctx.guild.id, session.session_id, 'refresh'))
      .setLabel('Refresh')
      .setEmoji('🔄')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(buildId('players', ctx.guild.id, session.session_id, 'close'))
      .setLabel('Close')
      .setEmoji('✖️')
      .setStyle(ButtonStyle.Secondary),
  );
  rows.push(buttonRow);

  if (players.length === 0) {
    sections.push({ text: '⚠️ لا يوجد لاعبون مسجلون في هذه الجلسة.' });
  }

  return buildV2Panel({
    accentColor: 0x5865f2,
    title: '👥 Manage Players',
    description: `-# ${ctx.guild.name}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows as any,
    footerText: 'Blade X · Among Us Manager',
  });
}

function buildPlayerActionPanel(
  ctx: Ctx,
  session: AmongUsSession,
  player: AmongUsPlayer,
  notice?: string,
): ReturnType<typeof buildV2Panel> {
  const sections: Array<{ text: string }> = [
    {
      text:
        `**اللاعب:** <@${player.user_id}>\n` +
        `**الحالة:** ${PLAYER_STATUS_LABELS[player.player_status]}\n` +
        `**الاتصال:** ${player.is_connected ? '🟢 متصل' : '⚪ غير متصل'}\n` +
        `**المرحلة:** ${session.current_phase}`,
    },
    {
      text:
        `**Server Mute الأصلي:** ${player.original_server_mute ? '🔇 مكتوم' : '🔊 مفتوح'}\n` +
        `**إدارة البوت للكتم:** ${player.bot_managed_mute ? '✅ نعم' : '➖ لا'}\n` +
        `**تعديل خارجي:** ${player.external_override ? '⚠️ نعم' : '✅ لا'}\n` +
        `**آخر تحديث:** <t:${Math.floor(player.last_updated / 1000)}:R>`,
    },
  ];
  if (notice) sections.push({ text: notice });

  const buttons: ButtonBuilder[] = [];
  if (player.player_status === 'alive') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildId('pact', ctx.guild.id, session.session_id, player.user_id, 'dead'))
        .setLabel('Mark as Dead')
        .setEmoji('💀')
        .setStyle(ButtonStyle.Danger),
    );
  }
  if (player.player_status === 'dead') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildId('pact', ctx.guild.id, session.session_id, player.user_id, 'alive'))
        .setLabel('Restore as Alive')
        .setEmoji('🟢')
        .setStyle(ButtonStyle.Success),
    );
  }
  if (player.player_status === 'pending') {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildId('pact', ctx.guild.id, session.session_id, player.user_id, 'accept'))
        .setLabel('Accept Player')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildId('pact', ctx.guild.id, session.session_id, player.user_id, 'remove'))
        .setLabel('Remove Pending')
        .setEmoji('🗑️')
        .setStyle(ButtonStyle.Danger),
    );
  }
  if (player.external_override) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(buildId('pact', ctx.guild.id, session.session_id, player.user_id, 'control'))
        .setLabel('Restore Control')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Primary),
    );
  }
  buttons.push(
    new ButtonBuilder()
      .setCustomId(buildId('pact', ctx.guild.id, session.session_id, player.user_id, 'back'))
      .setLabel('Back')
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary),
  );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons.slice(i, i + 5)));
  }

  return buildV2Panel({
    accentColor: player.player_status === 'dead' ? 0xed4245 : 0x5865f2,
    title: `👤 ${player.display_name ?? 'Player'}`,
    description: `-# ${ctx.guild.name}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows as any,
    footerText: 'Blade X · Among Us Manager',
  });
}

async function handlePlayersInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const parts = parseId(interaction.customId);
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return;

  const ctx = await requireCtx(interaction);
  if (!ctx) return;

  const sessionId = parts[3];
  const action = parts[4];
  const session = await loadSessionOrReply(interaction, ctx, sessionId);
  if (!session) return;
  if (!(await canOperateOrReply(interaction, ctx, session))) return;

  if (action === 'select' && interaction.isStringSelectMenu()) {
    const userId = interaction.values[0];
    const player = await getAmongUsPlayer(session.session_id, userId);
    if (!player) {
      await replyEphemeral(interaction, '❌ اللاعب غير موجود في الجلسة.');
      return;
    }
    await updateV2(interaction, buildPlayerActionPanel(ctx, session, player));
    return;
  }

  if (action === 'refresh' || action === 'back') {
    const players = await getAmongUsPlayers(session.session_id);
    await updateV2(interaction, buildPlayerListPanel(ctx, session, players));
    return;
  }

  if (action === 'helpers') {
    if (!canManageSessionHelpers(ctx.access, session)) {
      await replyEphemeral(interaction, '❌ إدارة المساعدين متاحة للمضيف الأساسي أو الإدارة فقط.');
      return;
    }
    const helpers = await getAmongUsHelperIds(session.session_id);
    await updateV2(interaction, buildHelpersPanel(ctx, session, helpers));
    return;
  }

  if (action === 'close') {
    await updateV2(
      interaction,
      buildV2Panel({
        accentColor: 0x747f8d,
        title: '👥 Manage Players Closed',
        sections: [{ text: 'تم إغلاق قائمة اللاعبين. استخدم اللوحة للعودة.' }],
        footerText: 'Blade X · Among Us Manager',
      }),
    );
  }
}

async function handlePlayerAction(interaction: Interaction): Promise<void> {
  if (!interaction.isButton()) return;
  const parts = parseId(interaction.customId);
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return;

  const ctx = await requireCtx(interaction);
  if (!ctx) return;

  const sessionId = parts[3];
  const targetUserId = parts[4];
  const action = parts[5];
  const session = await loadSessionOrReply(interaction, ctx, sessionId);
  if (!session) return;
  if (!(await canOperateOrReply(interaction, ctx, session))) return;

  if (action === 'back') {
    const players = await getAmongUsPlayers(session.session_id);
    await updateV2(interaction, buildPlayerListPanel(ctx, session, players));
    return;
  }

  await deferUpdateSafe(interaction);

  let result;
  if (action === 'dead') {
    result = await markPlayerDead(guild, ctx.settings, session.session_id, targetUserId, interaction.user.id);
  } else if (action === 'alive') {
    result = await restorePlayerAlive(guild, ctx.settings, session.session_id, targetUserId, interaction.user.id);
  } else if (action === 'accept') {
    result = await acceptPendingPlayer(guild, ctx.settings, session.session_id, targetUserId, interaction.user.id);
  } else if (action === 'remove') {
    result = await removePendingPlayer(guild, ctx.settings, session.session_id, targetUserId, interaction.user.id);
  } else if (action === 'control') {
    result = await restorePlayerControl(guild, ctx.settings, session.session_id, targetUserId, interaction.user.id);
  } else {
    await editPlain(interaction, '❌ إجراء غير معروف.');
    return;
  }

  const panelError = await refreshPanel(interaction, ctx, result.session ?? null);
  const freshSession = await getAmongUsSession(session.session_id);
  const freshPlayer = await getAmongUsPlayer(session.session_id, targetUserId);

  if (freshSession && freshPlayer) {
    await editV2(
      interaction,
      buildPlayerActionPanel(
        ctx,
        freshSession,
        freshPlayer,
        `${result.message}${panelError ? `\n⚠️ ${panelError}` : ''}`,
      ),
    );
  } else {
    const players = freshSession ? await getAmongUsPlayers(freshSession.session_id) : [];
    await editV2(
      interaction,
      buildPlayerListPanel(
        ctx,
        freshSession ?? session,
        players,
      ),
    );
  }
}

// ============================================================
// Assistant hosts UI
// ============================================================
function buildHelpersPanel(
  ctx: Ctx,
  session: AmongUsSession,
  helperIds: string[],
): ReturnType<typeof buildV2Panel> {
  const sections: Array<{ text: string }> = [
    {
      text:
        `**المضيف الأساسي:** <@${session.host_user_id}>\n` +
        `**المضيفون المساعدون:** ${helperIds.length > 0 ? helperIds.map((id) => `<@${id}>`).join('، ') : '`لا يوجد`'}`,
    },
    {
      text:
        'المضيف المساعد يستطيع تنفيذ إجراءات الجلسة (بدء الجولة، الاجتماع، إدارة اللاعبين) ' +
        'لكنه لا يستطيع تغيير إعدادات السيرفر.',
    },
  ];

  const rows: ActionRowBuilder<any>[] = [];
  rows.push(
    new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(buildId('helpers', ctx.guild.id, session.session_id, 'add'))
        .setPlaceholder('أضف مضيفًا مساعدًا...')
        .setMinValues(1)
        .setMaxValues(5),
    ),
  );

  if (helperIds.length > 0) {
    const removeMenu = new StringSelectMenuBuilder()
      .setCustomId(buildId('helpers', ctx.guild.id, session.session_id, 'remove'))
      .setPlaceholder('اختر مساعدًا لإزالته...')
      .setMinValues(1)
      .setMaxValues(Math.min(helperIds.length, 10))
      .addOptions(
        helperIds.slice(0, 25).map((id) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(id)
            .setValue(id)
            .setDescription('إزالة من المضيفين المساعدين')
            .setEmoji('➖'),
        ),
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeMenu));
  }

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('players', ctx.guild.id, session.session_id, 'back'))
        .setLabel('Back')
        .setEmoji('◀️')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return buildV2Panel({
    accentColor: 0x5865f2,
    title: '🤝 Session Helpers',
    description: `-# ${ctx.guild.name}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows as any,
    footerText: 'Blade X · Among Us Manager',
  });
}

async function handleHelpersInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const parts = parseId(interaction.customId);
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return;

  const ctx = await requireCtx(interaction);
  if (!ctx) return;

  const sessionId = parts[3];
  const action = parts[4];
  const session = await loadSessionOrReply(interaction, ctx, sessionId);
  if (!session) return;
  if (!canManageSessionHelpers(ctx.access, session)) {
    await replyEphemeral(interaction, '❌ إدارة المساعدين متاحة للمضيف الأساسي أو الإدارة فقط.');
    return;
  }

  if (action === 'add' && interaction.isUserSelectMenu()) {
    const notices: string[] = [];
    for (const userId of interaction.values) {
      const result = await addSessionHelper(guild, session.session_id, userId, interaction.user.id);
      notices.push(result.message);
    }
    const helpers = await getAmongUsHelperIds(session.session_id);
    await updateV2(interaction, buildHelpersPanel(ctx, session, helpers));
    if (notices.length > 0) {
      await interaction.followUp({ content: notices.join('\n'), flags: MessageFlags.Ephemeral }).catch(() => undefined);
    }
    return;
  }

  if (action === 'remove' && interaction.isStringSelectMenu()) {
    for (const userId of interaction.values) {
      await removeSessionHelper(guild, session.session_id, userId, interaction.user.id);
    }
    const helpers = await getAmongUsHelperIds(session.session_id);
    await updateV2(interaction, buildHelpersPanel(ctx, session, helpers));
    return;
  }
}

// ============================================================
// Settings UI
// ============================================================
function buildSettingsPanel(
  ctx: Ctx,
  session: AmongUsSession | null,
  notice?: string,
  check?: SetupCheckResult,
): ReturnType<typeof buildV2Panel> {
  const hostRoles = safeRoles(ctx.settings.host_role_ids);
  const helperRoles = safeRoles(ctx.settings.helper_role_ids);

  const sections: Array<{ text: string }> = [
    {
      text:
        `**الروم الصوتي:** ${formatChannel(ctx.settings.voice_channel_id)}\n` +
        `**قناة التحكم:** ${formatChannel(ctx.settings.control_channel_id)}\n` +
        `**قناة السجلات:** ${formatChannel(ctx.settings.log_channel_id)}`,
    },
    {
      text:
        `**رتب المضيفين:** ${formatRoles(hostRoles)}\n` +
        `**رتب المساعدين:** ${formatRoles(helperRoles)}\n` +
        `**حالة النظام:** ${ctx.settings.setup_completed ? '✅ معد' : '❌ غير معد'}` +
        (session ? `\n**جلسة نشطة:** ${session.current_phase}` : '\n**جلسة نشطة:** لا'),
    },
  ];

  if (session) {
    sections.push({
      text: '⚠️ لا يمكن تغيير الروم الصوتي أثناء وجود جلسة نشطة. أنهِ الجلسة أولًا.',
    });
  }
  if (notice) sections.push({ text: notice });
  if (check) {
    sections.push({
      text:
        `**فحص الصلاحيات:** ${check.ok ? '✅ جاهز' : '❌ توجد مشاكل'}\n` +
        check.lines.join('\n'),
    });
  }

  const rows: ActionRowBuilder<any>[] = [];

  const voiceSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId('settings', ctx.guild.id, 'voice'))
    .setPlaceholder('تغيير الروم الصوتي الثابت...')
    .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    .setMinValues(1)
    .setMaxValues(1)
    .setDisabled(!!session);
  rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(voiceSelect));

  const controlSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId('settings', ctx.guild.id, 'control'))
    .setPlaceholder('تغيير قناة لوحة التحكم...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(controlSelect));

  const hostSelect = new RoleSelectMenuBuilder()
    .setCustomId(buildId('settings', ctx.guild.id, 'hosts'))
    .setPlaceholder('تعديل رتب المضيفين...')
    .setMinValues(0)
    .setMaxValues(10);
  rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(hostSelect));

  const helperSelect = new RoleSelectMenuBuilder()
    .setCustomId(buildId('settings', ctx.guild.id, 'helpers'))
    .setPlaceholder('تعديل رتب المساعدين...')
    .setMinValues(0)
    .setMaxValues(10);
  rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(helperSelect));

  const logSelect = new ChannelSelectMenuBuilder()
    .setCustomId(buildId('settings', ctx.guild.id, 'logs'))
    .setPlaceholder('تغيير قناة السجلات...')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(1)
    .setMaxValues(1);
  rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(logSelect));

  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('settings', ctx.guild.id, 'check'))
        .setLabel('Check Permissions')
        .setEmoji('🔍')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildId('settings', ctx.guild.id, 'republish'))
        .setLabel('Republish Panel')
        .setEmoji('📌')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(buildId('speak', ctx.guild.id, 'settings'))
        .setLabel('Speaking Settings')
        .setEmoji('🗣️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildId('settings', ctx.guild.id, 'back'))
        .setLabel('Close')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Secondary),
    ),
  );

  return buildV2Panel({
    accentColor: 0x5865f2,
    title: '⚙️ Among Us Settings',
    description: `-# ${ctx.guild.name}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows as any,
    footerText: 'Blade X · Among Us Manager',
  });
}

function safeRoles(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildVoiceConfirmPanel(
  ctx: Ctx,
  channelId: string,
  kind: 'voice' | 'control',
): ReturnType<typeof buildV2Panel> {
  const label = kind === 'voice' ? 'الروم الصوتي' : 'قناة لوحة التحكم';
  const confirmAction = kind === 'voice' ? 'confirmvoice' : 'confirmcontrol';
  return buildV2Panel({
    accentColor: 0xf59e0b,
    title: `⚠️ Confirm ${label}`,
    description: `-# ${ctx.guild.name}`,
    sections: [
      {
        text:
          `هل تريد تغيير **${label}** إلى <#${channelId}>؟\n` +
          (kind === 'control'
            ? 'سيتم إنشاء لوحة تحكم جديدة في القناة الجديدة وحذف الرسالة القديمة إن أمكن.'
            : 'لن يتم تغيير الروم أثناء وجود جلسة نشطة.'),
      },
    ],
    actionRows: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('settings', ctx.guild.id, confirmAction, channelId))
          .setLabel('Confirm')
          .setEmoji('✅')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(buildId('settings', ctx.guild.id, 'cancel'))
          .setLabel('Cancel')
          .setEmoji('✖️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ] as any,
    footerText: 'Blade X · Among Us Manager',
  });
}

async function handleSettingsInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const parts = parseId(interaction.customId);
  const guild = interaction.guild;
  if (!guild || parts[2] !== guild.id) return;

  const ctx = await requireCtx(interaction);
  if (!ctx) return;
  if (!canManageSettings(ctx.access)) {
    await replyEphemeral(interaction, '❌ إعدادات السيرفر متاحة لمالك السيرفر أو الإدارة فقط.');
    return;
  }

  const action = parts[3];
  const session = await getActiveAmongUsSession(guild.id);

  if (action === 'voice' && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0];
    if (session) {
      await updateV2(
        interaction,
        buildSettingsPanel(ctx, session, '⚠️ لا يمكن تغيير الروم الصوتي أثناء وجود جلسة نشطة.'),
      );
      return;
    }
    await updateV2(interaction, buildVoiceConfirmPanel(ctx, channelId, 'voice'));
    return;
  }

  if (action === 'control' && interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0];
    await updateV2(interaction, buildVoiceConfirmPanel(ctx, channelId, 'control'));
    return;
  }

  if (action === 'hosts' && interaction.isRoleSelectMenu()) {
    await setAmongUsRoles(guild.id, { host_role_ids: [...new Set(interaction.values)].slice(0, 10) });
    const fresh = await getAmongUsSettings(guild.id);
    if (!fresh) return;
    ctx.settings = fresh;
    await updateV2(interaction, buildSettingsPanel(ctx, session, '✅ تم تحديث رتب المضيفين.'));
    return;
  }

  if (action === 'helpers' && interaction.isRoleSelectMenu()) {
    await setAmongUsRoles(guild.id, {
      helper_role_ids: [...new Set(interaction.values)].slice(0, 10),
    });
    const fresh = await getAmongUsSettings(guild.id);
    if (!fresh) return;
    ctx.settings = fresh;
    await updateV2(interaction, buildSettingsPanel(ctx, session, '✅ تم تحديث رتب المساعدين.'));
    return;
  }

  if (action === 'logs' && interaction.isChannelSelectMenu()) {
    await setAmongUsChannels(guild.id, { log_channel_id: interaction.values[0] });
    const fresh = await getAmongUsSettings(guild.id);
    if (!fresh) return;
    ctx.settings = fresh;
    await updateV2(interaction, buildSettingsPanel(ctx, session, '✅ تم تحديث قناة السجلات.'));
    return;
  }

  if (action === 'check' && interaction.isButton()) {
    const check = await runPermissionCheck(guild, {
      voiceChannelId: ctx.settings.voice_channel_id,
      controlChannelId: ctx.settings.control_channel_id,
      logChannelId: ctx.settings.log_channel_id,
    });
    await updateV2(interaction, buildSettingsPanel(ctx, session, undefined, check));
    return;
  }

  if (action === 'republish' && interaction.isButton()) {
    await deferUpdateSafe(interaction);
    const error = await refreshPanel(interaction, ctx, session);
    await editV2(
      interaction,
      buildSettingsPanel(
        ctx,
        session,
        error ? `⚠️ ${error}` : '✅ تم تحديث/إعادة نشر لوحة التحكم.',
      ),
    );
    return;
  }

  if (action === 'back' && interaction.isButton()) {
    await updateV2(
      interaction,
      buildV2Panel({
        accentColor: 0x747f8d,
        title: '⚙️ Settings Closed',
        sections: [{ text: 'تم إغلاق الإعدادات. استخدم `/amongus` أو زر Settings للعودة.' }],
        footerText: 'Blade X · Among Us Manager',
      }),
    );
    return;
  }

  if (action === 'cancel' && interaction.isButton()) {
    await updateV2(interaction, buildSettingsPanel(ctx, session, 'تم إلغاء التغيير.'));
    return;
  }

  if (action === 'confirmvoice' && interaction.isButton()) {
    const channelId = parts[4];
    await deferUpdateSafe(interaction);
    if (session) {
      await editV2(
        interaction,
        buildSettingsPanel(ctx, session, '⚠️ لا يمكن تغيير الروم الصوتي أثناء وجود جلسة نشطة.'),
      );
      return;
    }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      await editV2(interaction, buildSettingsPanel(ctx, session, '❌ القناة الصوتية غير صالحة.'));
      return;
    }
    await setAmongUsChannels(guild.id, { voice_channel_id: channel.id });
    const fresh = await getAmongUsSettings(guild.id);
    if (!fresh) return;
    ctx.settings = fresh;
    const panelError = await refreshPanel(interaction, ctx, null);
    await editV2(
      interaction,
      buildSettingsPanel(
        ctx,
        null,
        `✅ تم تغيير الروم الصوتي إلى <#${channel.id}>.${panelError ? `\n⚠️ ${panelError}` : ''}`,
      ),
    );
    await recordEvent({
      guildId: guild.id,
      actorUserId: interaction.user.id,
      action: 'voice_channel_changed',
      newState: channel.id,
      logText: `🎙️ غيّر <@${interaction.user.id}> الروم الصوتي إلى <#${channel.id}>.`,
      client: interaction.client,
      guild,
      settings: fresh,
    });
    return;
  }

  if (action === 'confirmcontrol' && interaction.isButton()) {
    const channelId = parts[4];
    await deferUpdateSafe(interaction);
    const oldSettings = ctx.settings;
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
      await editV2(interaction, buildSettingsPanel(ctx, session, '❌ القناة النصية غير صالحة.'));
      return;
    }

    await setAmongUsChannels(guild.id, { control_channel_id: channel.id });
    await setAmongUsControlMessage(guild.id, channel.id, null);
    const fresh = await getAmongUsSettings(guild.id);
    if (!fresh) return;

    const panel = await updateDashboardMessage(interaction.client, guild.id, fresh, session);
    if (!panel.ok) {
      // Revert to the previous control channel.
      await setAmongUsChannels(guild.id, {
        control_channel_id: oldSettings.control_channel_id,
      });
      await setAmongUsControlMessage(
        guild.id,
        oldSettings.control_channel_id,
        oldSettings.control_message_id,
      );
      const reverted = await getAmongUsSettings(guild.id);
      if (reverted) ctx.settings = reverted;
      await editV2(
        interaction,
        buildSettingsPanel(ctx, session, `❌ فشل نشر اللوحة في القناة الجديدة: ${panel.error ?? 'خطأ'}`),
      );
      return;
    }

    // Remove the old panel message (only if it is different from the new one).
    if (
      oldSettings.control_channel_id &&
      oldSettings.control_message_id &&
      !(oldSettings.control_channel_id === channel.id && oldSettings.control_message_id === panel.messageId)
    ) {
      try {
        const oldChannel =
          guild.channels.cache.get(oldSettings.control_channel_id) ??
          (await guild.channels.fetch(oldSettings.control_channel_id).catch(() => null));
        if (oldChannel && oldChannel.type === ChannelType.GuildText) {
          const oldMessage = await (oldChannel as TextChannel).messages
            .fetch(oldSettings.control_message_id)
            .catch(() => null);
          if (oldMessage) await oldMessage.delete().catch(() => undefined);
        }
      } catch {
        // Old panel may already be gone.
      }
    }

    const refreshed = await getAmongUsSettings(guild.id);
    if (refreshed) ctx.settings = refreshed;
    await editV2(
      interaction,
      buildSettingsPanel(
        ctx,
        session,
        `✅ تم تغيير قناة التحكم إلى <#${channel.id}> ونشر اللوحة.`,
      ),
    );
    await recordEvent({
      guildId: guild.id,
      actorUserId: interaction.user.id,
      action: 'control_channel_changed',
      newState: channel.id,
      logText: `💬 غيّر <@${interaction.user.id}> قناة التحكم إلى <#${channel.id}>.`,
      client: interaction.client,
      guild,
      settings: refreshed,
    });
    return;
  }
}

// ============================================================
// End session confirmation
// ============================================================
function buildEndSessionConfirm(
  ctx: Ctx,
  session: AmongUsSession,
): ReturnType<typeof buildV2Panel> {
  return buildV2Panel({
    accentColor: 0xed4245,
    title: '⚠️ End Among Us Session',
    description: `-# ${ctx.guild.name}`,
    sections: [
      {
        text:
          'هل أنت متأكد من إنهاء الجلسة؟\n' +
          'سيتم إيقاف إدارة المايكات واستعادة الحالات التي غيّرها البوت فقط، ' +
          'مع احترام الكتم الأصلي وأي تعديل خارجي.',
      },
      {
        text: `**المرحلة الحالية:** ${session.current_phase}\n**المضيف:** <@${session.host_user_id}>`,
      },
    ],
    actionRows: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('panel', ctx.guild.id, 'endsession-confirm', session.session_id))
          .setLabel('Confirm End Session')
          .setEmoji('⛔')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(buildId('panel', ctx.guild.id, 'endsession-cancel', session.session_id))
          .setLabel('Cancel')
          .setEmoji('✖️')
          .setStyle(ButtonStyle.Secondary),
      ),
    ] as any,
    footerText: 'Blade X · Among Us Manager',
  });
}
