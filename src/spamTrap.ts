// ============================================================
// Blade X — Spam Trap (v5 — Turso)
// ============================================================
import { Client, Events, Message, TextChannel, EmbedBuilder } from 'discord.js';
import { getSpamTrapConfig, logSpamTrap, logActivity } from './database.js';
import { config } from './config.js';
import { getEmoji } from './emojiRegistry.js';

const processedMessages = new Set<string>();

export function registerSpamTrap(client: Client): void {
  client.on(Events.MessageCreate, async (message: Message) => {
    try {
      if (!message.guild) return;
      const cfg = getSpamTrapConfig();
      if (!cfg.enabled || !cfg.channelId) return;
      if (message.channelId !== cfg.channelId) return;
      if (message.author.id === client.user?.id) return;
      if (cfg.ignoreBots && message.author.bot) return;
      if (cfg.ignoreRoles.some(r => message.member?.roles.cache.has(r))) return;

      // منع التكرار على نفس الرسالة
      if (processedMessages.has(message.id)) return;
      processedMessages.add(message.id);
      setTimeout(() => processedMessages.delete(message.id), 60_000);

      const member = message.member;
      if (!member) return;
      const me = message.guild.members.me;
      if (!me) return;
      if (member.id === message.guild.ownerId) return;
      if (member.roles.highest.position >= me.roles.highest.position) return;

      const content = message.content.slice(0, 200) || null;
      let success = false;
      let error: string | null = null;
      let durationMs: number | null = null;

      try {
        if (cfg.punishment === 'ban') {
          if (!member.bannable) throw new Error('Bot cannot ban this member');
          await message.guild.bans.create(member.id, { reason: 'Spam Trap triggered', deleteMessageSeconds: 0 });
        } else if (cfg.punishment === 'kick') {
          if (!member.kickable) throw new Error('Bot cannot kick this member');
          await member.kick('Spam Trap triggered');
        } else if (cfg.punishment === 'timeout') {
          if (!member.moderatable) throw new Error('Bot cannot timeout this member');
          durationMs = cfg.timeoutMs;
          await member.timeout(durationMs, 'Spam Trap triggered');
        }
        success = true;
      } catch (e: any) {
        error = e?.message ?? 'Unknown error';
        console.error('[Blade X] ❌ Spam Trap punishment failed:', error);
      }

      // حذف الرسالة إن أمكن
      try { await message.delete(); } catch { /* ignore */ }

      await logSpamTrap(member.id, message.channelId, message.id, content, cfg.punishment, durationMs, success, error);
      await logActivity('spam_trap', member.id, `${cfg.punishment}${error ? ' (failed)' : ''}`);

      // Log
      if (cfg.logChannelId) {
        try {
          const logCh = message.guild.channels.cache.get(cfg.logChannelId) as TextChannel | undefined;
          if (logCh) {
            const embed = new EmbedBuilder()
              .setColor(success ? 0xed4245 : 0xf59e0b)
              .setTitle(`${getEmoji('log_security', '🛡️')} Spam Trap Triggered`)
              .setThumbnail(member.displayAvatarURL({ size: 128 }))
              .addFields(
                { name: 'User', value: `${member} (\`${member.id}\`)`, inline: false },
                { name: 'Channel', value: `${message.channel}`, inline: true },
                { name: 'Punishment', value: cfg.punishment.toUpperCase(), inline: true },
                { name: 'Result', value: success ? '✅ Success' : `❌ Failed: ${error}`, inline: true }
              )
              .setTimestamp();
            if (content) embed.addFields({ name: 'Message Content', value: content.slice(0, 1020), inline: false });
            await logCh.send({ embeds: [embed] }).catch(() => {});
          }
        } catch (e) { console.error('[Blade X] ❌ Spam Trap log error:', e); }
      }
    } catch (e) { console.error('[Blade X] ❌ Spam Trap error:', e); }
  });
  console.log('[Blade X] ✅ Spam Trap registered');
}