// ============================================================
// Blade X — Among Us Manager · Single-panel navigation
//
// One persistent message per guild is the ONLY control surface.
// Sub-pages replace its content; Back returns to the previous
// view using the same message id. No per-action chat messages.
// ============================================================

import {
  ChannelType,
  TextChannel,
  type Client,
  type Interaction,
  type Message,
  type TextBasedChannel,
} from 'discord.js';
import {
  getActiveAmongUsSession,
  getAmongUsSettings,
  setAmongUsControlMessage,
  setAmongUsSessionPanelRefs,
} from './database.js';
import { buildGuildDashboardContainer } from './panel.js';
import { buildV2Payload, type buildV2Panel } from '../ui/v2.js';

export type PanelViewKind =
  | 'main'
  | 'create'
  | 'players'
  | 'player'
  | 'helpers'
  | 'settings'
  | 'voice-confirm'
  | 'end-confirm'
  | 'dead-select'
  | 'setup'
  | 'speaking'
  | 'speaking-settings';

export interface PanelView {
  kind: PanelViewKind;
  sessionId?: string | null;
  userId?: string | null;
  /** Rebuilds the view from fresh DB state on every render. */
  render: (notice?: string | null) => Promise<ReturnType<typeof buildV2Panel>>;
}

export interface NavigationSnapshot {
  current: PanelView | null;
  stack: PanelView[];
}

/** Pure navigation helpers — exported so the flow can be unit-tested. */
export function pushNavigation(snapshot: NavigationSnapshot, view: PanelView): NavigationSnapshot {
  return {
    current: view,
    stack: snapshot.current ? [...snapshot.stack, snapshot.current] : [...snapshot.stack],
  };
}

export function popNavigation(snapshot: NavigationSnapshot, fallback: PanelView): NavigationSnapshot {
  const stack = [...snapshot.stack];
  const previous = stack.pop();
  return { current: previous ?? fallback, stack };
}

export function resetNavigation(fallback: PanelView): NavigationSnapshot {
  return { current: fallback, stack: [] };
}

interface NavState extends NavigationSnapshot {
  notice?: string | null;
}

const states = new Map<string, NavState>();
const chains = new Map<string, Promise<unknown>>();

/** Serialise navigation/rendering per guild: two clicks cannot create two panels. */
export function withNavLock<T>(guildId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(guildId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  chains.set(guildId, next.catch(() => undefined));
  return next;
}

function stateFor(guildId: string): NavState {
  let state = states.get(guildId);
  if (!state) {
    state = { current: null, stack: [] };
    states.set(guildId, state);
  }
  return state;
}

function mainView(client: Client, guildId: string): PanelView {
  return {
    kind: 'main',
    render: async (notice) => {
      const settings = await getAmongUsSettings(guildId);
      if (!settings) {
        throw new Error('Among Us settings are not available.');
      }
      const container = await buildGuildDashboardContainer(
        client,
        guildId,
        settings,
        await getActiveAmongUsSession(guildId),
        notice,
      );
      if (!container) throw new Error('Guild is not available.');
      return container;
    },
  };
}

function isUnknownMessage(error: unknown): boolean {
  const code = (error as { code?: number })?.code;
  return code === 10008 || String((error as { message?: string })?.message ?? '').toLowerCase().includes('unknown message');
}

async function resolvePanelMessage(
  client: Client,
  guildId: string,
): Promise<{ message: Message | null; channel: TextBasedChannel | null }> {
  const settings = await getAmongUsSettings(guildId);
  if (!settings?.control_channel_id) return { message: null, channel: null };
  const guild =
    client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return { message: null, channel: null };
  const channel =
    guild.channels.cache.get(settings.control_channel_id) ??
    (await guild.channels.fetch(settings.control_channel_id).catch(() => null));
  if (!channel || channel.type !== ChannelType.GuildText) return { message: null, channel: null };
  let message: Message | null = null;
  if (settings.control_message_id) {
    try {
      message = await (channel as TextChannel).messages.fetch(settings.control_message_id);
    } catch (e) {
      if (!isUnknownMessage(e)) throw e;
    }
  }
  return { message, channel: channel as TextBasedChannel };
}

export interface PanelRenderResult {
  ok: boolean;
  error?: string;
  messageId?: string;
  channelId?: string;
  created: boolean;
}

async function renderLocked(
  client: Client,
  guildId: string,
  interaction: Interaction | null,
  notice?: string | null,
): Promise<PanelRenderResult> {
  const state = stateFor(guildId);
  if (notice !== undefined) state.notice = notice;
  const view = state.current ?? mainView(client, guildId);
  if (!state.current) state.current = view;

  // Acknowledge components before any network edit so Discord never reports
  // "Unknown interaction" and no second response is attempted.
  if (interaction?.isMessageComponent() && !interaction.deferred && !interaction.replied) {
    await interaction.deferUpdate().catch(() => undefined);
  }

  let container: ReturnType<typeof buildV2Panel>;
  try {
    container = await view.render(state.notice);
  } catch (error) {
    // Terminal diagnostic only: never announce a failed render in chat.
    console.error('[Blade X] ❌ Among Us panel render failed:', error);
    const settings = await getAmongUsSettings(guildId);
    if (!settings) return { ok: false, error: 'قناة لوحة التحكم غير مضبوطة.', created: false };
    const fallback = await buildGuildDashboardContainer(client, guildId, settings, null);
    if (!fallback) return { ok: false, error: 'السيرفر غير متاح.', created: false };
    state.stack = [];
    state.current = mainView(client, guildId);
    state.notice = null;
    container = fallback;
  }
  const payload = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };
  const { message, channel } = await resolvePanelMessage(client, guildId);
  if (!channel) return { ok: false, error: 'قناة لوحة التحكم غير متاحة.', created: false };

  if (message) {
    await message.edit(payload);
    const settings = await getAmongUsSettings(guildId);
    const session = await getActiveAmongUsSession(guildId);
    if (session && settings?.control_message_id !== message.id) {
      await setAmongUsSessionPanelRefs(session.session_id, settings?.control_channel_id ?? channel.id, message.id);
    }
    return { ok: true, messageId: message.id, channelId: channel.id, created: false };
  }

  // Only reached when the stored panel was deleted: create exactly one
  // replacement inside the nav lock and persist the new id.
  const replacement = await (channel as TextChannel).send(payload);
  await setAmongUsControlMessage(guildId, channel.id, replacement.id);
  const settings = await getAmongUsSettings(guildId);
  const session = await getActiveAmongUsSession(guildId);
  if (session && settings) {
    await setAmongUsSessionPanelRefs(session.session_id, settings.control_channel_id, replacement.id);
  }
  return { ok: true, messageId: replacement.id, channelId: channel.id, created: true };
}

/** Re-render the current view into the one stored panel message. */
export function renderPanelView(
  client: Client,
  guildId: string,
  notice?: string | null,
  interaction: Interaction | null = null,
): Promise<PanelRenderResult> {
  return withNavLock(guildId, () => renderLocked(client, guildId, interaction, notice));
}

/** Open a sub-view by pushing the current one on the navigation stack. */
export function navigateTo(
  client: Client,
  guildId: string,
  view: PanelView,
  interaction: Interaction,
  options: { replace?: boolean } = {},
): Promise<PanelRenderResult> {
  return withNavLock(guildId, async () => {
    const state = stateFor(guildId);
    const next = options.replace
      ? { current: view, stack: state.stack }
      : pushNavigation(state, view);
    state.current = next.current;
    state.stack = next.stack;
    state.notice = undefined;
    return renderLocked(client, guildId, interaction);
  });
}

/** Return to the previous view (never creates a new message). */
export function goBack(
  client: Client,
  guildId: string,
  interaction: Interaction,
): Promise<PanelRenderResult> {
  return withNavLock(guildId, async () => {
    const state = stateFor(guildId);
    const next = popNavigation(state, mainView(client, guildId));
    state.current = next.current;
    state.stack = next.stack;
    state.notice = undefined;
    return renderLocked(client, guildId, interaction);
  });
}

/** Drop navigation history and show the main panel again. */
export function resetToMain(
  client: Client,
  guildId: string,
  interaction: Interaction,
  notice?: string | null,
): Promise<PanelRenderResult> {
  return withNavLock(guildId, async () => {
    const state = stateFor(guildId);
    const next = resetNavigation(mainView(client, guildId));
    state.stack = next.stack;
    state.current = next.current;
    state.notice = notice ?? undefined;
    return renderLocked(client, guildId, interaction);
  });
}

/** Ensure the single panel exists and show the main view (used by /amongus). */
export function ensureMainPanel(
  client: Client,
  guildId: string,
): Promise<PanelRenderResult> {
  return withNavLock(guildId, async () => {
    const state = stateFor(guildId);
    const next = resetNavigation(mainView(client, guildId));
    state.stack = next.stack;
    state.current = next.current;
    state.notice = undefined;
    return renderLocked(client, guildId, null);
  });
}

export function currentViewKind(guildId: string): PanelViewKind | null {
  return stateFor(guildId).current?.kind ?? null;
}
