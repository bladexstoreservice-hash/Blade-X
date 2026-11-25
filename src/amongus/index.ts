// ============================================================
// Blade X — Among Us Manager · Module entry point
// Self-contained: schema init, slash command, listeners, recovery.
// ============================================================

import {
  Events,
  SlashCommandBuilder,
  type Client,
  type Interaction,
} from 'discord.js';
import { initAmongUsDatabase } from './database.js';
import { handleAmongUsCommand, handleAmongUsInteraction } from './interactions.js';
import { restoreSessionsAfterRestart } from './session.js';
import { handleAmongUsVoiceState } from './voice.js';
import { registerSpeakingEngine, restoreSpeakingAfterRestart } from './speaking/engine.js';

export const amongUsCommand = new SlashCommandBuilder()
  .setName('amongus')
  .setDescription('Among Us Manager — إدارة جلسات Among Us والمايكات')
  .setDMPermission(false)
  .toJSON();

let registered = false;

/** Create the additive Among Us tables. Safe to call on every startup. */
export async function initAmongUs(): Promise<void> {
  await initAmongUsDatabase();
}

export function registerAmongUs(client: Client): void {
  if (registered) return;
  registered = true;

  // Optional feature: registers hooks only. Core behaviour stays identical.
  registerSpeakingEngine(client);

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'amongus') {
        await handleAmongUsCommand(interaction);
        return;
      }
      await handleAmongUsInteraction(interaction);
    } catch (e) {
      console.error('[Blade X] ❌ Among Us interaction error:', e);
      try {
        if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: '❌ حدث خطأ غير متوقع في Among Us Manager.',
            flags: 64,
          });
        }
      } catch {
        // Interaction already gone.
      }
    }
  });

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      await handleAmongUsVoiceState(client, oldState, newState);
    } catch (e) {
      console.error('[Blade X] ❌ Among Us voice error:', e);
    }
  });

  client.once(Events.ClientReady, async () => {
    try {
      await restoreSessionsAfterRestart(client);
    } catch (e) {
      console.error('[Blade X] ❌ Among Us recovery error:', e);
    }
    try {
      await restoreSpeakingAfterRestart(client);
    } catch (e) {
      console.error('[Blade X] ❌ Speaking Manager recovery error:', e);
    }
  });
}
