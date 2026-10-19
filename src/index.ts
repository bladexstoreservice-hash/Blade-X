import {
  Client, GatewayIntentBits, Events, REST, Routes, ButtonInteraction,
  MessageFlags,
} from 'discord.js';
import { config } from './config.js';
import { closeDatabase } from './database.js';
import { setupCommand, handleSetup, registerSetupHandlers } from './setup.js';
import { registerLogEvents } from './logs.js';
import { registerModerationLogs } from './moderationLogs.js';
import {
  moderationCommands, handleModerationCommand, startPunishmentChecker,
  registerModerationButtons,
} from './moderation.js';
import { registerAntiSpam } from './antiSpam.js';
import { registerAntiNuke } from './antiNuke.js';
import { registerSelfRoles, publishRolePanel, rolePanelCommand, rolesCommand } from './selfRoles.js';
import { handleMemberJoin, handleSayHi, setWelcomeClient } from './welcome.js';
import { utilityCommands, handleUtilityCommand } from './commands.js';
import { registerMovieNight, setMovieClient } from './movieNight.js';
import { registerSpamTrap } from './spamTrap.js';
import { registerMediaShow } from './mediaShow.js';
import { registerSupport, publishSupportPanel } from './support.js';
import { componentsV2Command, handleComponentsV2 } from './componentsV2.js';
import { seedDefaultTexts } from './texts.js';
import { TEXT_REGISTRY, COLOR_REGISTRY } from './textRegistry.js';
import { seedEmojiDefaults, setEmojiClient } from './emojiRegistry.js';
import { startDashboard } from './dashboard.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
  ],
});

(globalThis as any).__bladeClient = client;
setEmojiClient(client);
setWelcomeClient(client);

async function deployCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.token);
  const commands: any[] = [
    setupCommand,
    ...moderationCommands,
    ...utilityCommands,
    rolesCommand,
    { name: 'dashboard', description: 'فتح رابط لوحة تحكم Blade X', default_member_permissions: '8' },
    { name: 'welcome-buttons', description: 'تخصيص أزرار الترحيب', default_member_permissions: '8' },
    { name: 'support-panel', description: 'نشر/تحديث لوحة الدعم', default_member_permissions: '8' },
    componentsV2Command,
    rolePanelCommand,
  ];
  try {
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body: commands });
    console.log(`[Blade X] ✅ Slash commands registered. (${commands.length} commands)`);
  } catch (err) { console.error('[Blade X] ❌ فشل تسجيل الأوامر:', err); }
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'setup') { await handleSetup(interaction); return; }
      if (interaction.commandName === 'dashboard') {
        await interaction.reply({ content: `🔗 ${config.dashboard.baseUrl}`, flags: MessageFlags.Ephemeral });
        return;
      }
      if (interaction.commandName === 'componentsv2') {
        await handleComponentsV2(interaction, client);
        return;
      }
      if (interaction.commandName === 'support-panel') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const res = await publishSupportPanel(client);
        await interaction.editReply({ content: res.ok ? '✅ تم نشر/تحديث لوحة الدعم.' : `❌ ${res.error}` });
        return;
      }
      if (interaction.commandName === 'roles') {
        const guild = interaction.guild;
        if (!guild) {
          await interaction.reply({ content: '❌ للسيرفرات فقط.', flags: MessageFlags.Ephemeral });
          return;
        }
        const { getSelfRoles } = await import('./database.js');
        const { buildV2Panel, buildV2Payload, isV2Available } = await import('./ui/v2.js');
        if (!isV2Available()) {
          await interaction.reply({ content: '⚠️ Components V2 غير متاح.', flags: MessageFlags.Ephemeral });
          return;
        }
        const allowed = getSelfRoles().filter((r) => r.enabled);
        if (allowed.length === 0) {
          await interaction.reply({ content: '⚠️ لا توجد رولات متاحة.', flags: MessageFlags.Ephemeral });
          return;
        }
        const member = await guild.members.fetch(interaction.user.id);
        const discord = await import('discord.js');
        const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = discord;
        const chunks: typeof allowed[] = [];
        for (let i = 0; i < allowed.length; i += 25) chunks.push(allowed.slice(i, i + 25));
        // ✅ FIX: actionRows type is any[] — use ActionRowBuilder<any> to avoid
        //    "refers to a value" error from dynamic-import class used as type param.
        const actionRows: any[] = [];
        for (let i = 0; i < Math.min(chunks.length, 5); i++) {
          const chunk = chunks[i];
          const menu = new StringSelectMenuBuilder()
            .setCustomId(i === 0 ? 'sr:select' : `sr:select:${i}`)
            .setPlaceholder('اختر رولًا أو أكثر...')
            .setMinValues(1)
            .setMaxValues(chunk.length);
          const opts = chunk.map((r) => {
            const opt = new StringSelectMenuOptionBuilder()
              .setLabel(r.label.slice(0, 100))
              .setValue(r.role_id)
              .setDescription(member.roles.cache.has(r.role_id) ? '✅ تملكه' : '➕ لا تملكه');
            if (r.emoji_id) { try { opt.setEmoji({ id: r.emoji_id }); } catch { /* ignore */ } }
            return opt;
          });
          menu.addOptions(opts);
          actionRows.push(new ActionRowBuilder<any>().addComponents(menu));
        }
        const ownedCount = allowed.filter(r => member.roles.cache.has(r.role_id)).length;
        const container = buildV2Panel({
          accentColor: 0x5865f2,
          title: '🎭 اختر رولاتك',
          description: `**تملك حاليًا:** ${ownedCount} / ${allowed.length} رول`,
          sections: [{ text: '**اختر من القائمة** — سيتم التبديل تلقائيًا.' }],
          actionRows,
          footerText: 'Blade X · Personal Roles',
        });
        const payload = buildV2Payload(container);
        await interaction.reply({ ...(payload as any), flags: (payload.flags | MessageFlags.Ephemeral) });
        return;
      }
      if (interaction.commandName === 'role-panel') {
        const sub = interaction.options.getSubcommand(true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { getSelfRoles, addSelfRole, removeSelfRole } = await import('./database.js');
        if (sub === 'publish') {
          const ok = await publishRolePanel(client);
          await interaction.editReply({ content: ok ? '✅ تم النشر.' : '❌ فشل.' });
        } else if (sub === 'list') {
          const rows = getSelfRoles();
          await interaction.editReply({
            content: rows.length === 0 ? '📋 لا توجد رولات.'
              : '📋 الرولات:\n' + rows.map(r => `• <@&${r.role_id}> — ${r.label}${r.enabled ? '' : ' (معطّل)'}`).join('\n'),
          });
        } else if (sub === 'add') {
          const role = interaction.options.getRole('role', true);
          addSelfRole(
            role.id,
            interaction.options.getString('label') ?? role.name,
            interaction.options.getString('emoji_id') ?? null,
            interaction.options.getString('description') ?? null
          );
          await interaction.editReply({ content: `✅ تم إضافة ${role}.` });
        } else if (sub === 'remove') {
          const role = interaction.options.getRole('role', true);
          const rows = getSelfRoles();
          const t = rows.find(r => r.role_id === role.id);
          if (!t) await interaction.editReply({ content: '❌ غير موجود.' });
          else { removeSelfRole(t.id); await interaction.editReply({ content: `✅ تم إزالة ${role}.` }); }
        }
        return;
      }
      if (interaction.commandName === 'welcome-buttons') {
        await interaction.reply({ content: '⚙️ يمكنك التخصيص من Dashboard.', flags: MessageFlags.Ephemeral });
        return;
      }
      if (await handleModerationCommand(interaction)) return;
      if (await handleUtilityCommand(interaction)) return;
      return;
    }
    if (interaction.isButton()) {
      const btn = interaction as ButtonInteraction;
      if (btn.customId.startsWith('welcome:sayhi:')) { await handleSayHi(btn); return; }
    }
  } catch (err) {
    console.error('[Blade X] ❌ خطأ في التفاعل:', err);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ حدث خطأ.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
});

client.on(Events.GuildMemberAdd, async (m) => { await handleMemberJoin(m); });

client.once(Events.ClientReady, async (c) => {
  console.log(`[Blade X] ✅ Ready as ${c.user.tag}`);
  try {
    const guild = c.guilds.cache.get(config.guildId);
    if (guild) await guild.emojis.fetch();
  } catch (e) {
    console.warn('[Blade X] ⚠️ فشل جلب الإيموجيات:', e);
  }
  startPunishmentChecker(client);
});

function shutdown(): void {
  console.log('[Blade X] 🛑 Shutting down...');
  closeDatabase();
  client.destroy();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main(): Promise<void> {
  console.log('[Blade X] Starting application...');
  if (process.argv.includes('--deploy-commands')) {
    await deployCommands();
    process.exit(0);
  }
  console.log('[Blade X] Database initialized.');

  seedDefaultTexts();
  seedEmojiDefaults();
  console.log(`[Blade X] ✅ Text Registry loaded: ${TEXT_REGISTRY.length} texts, ${COLOR_REGISTRY.length} colors`);

  registerLogEvents(client);
  registerModerationLogs(client);
  registerSetupHandlers(client);
  registerModerationButtons(client);
  registerAntiSpam(client);
  registerAntiNuke(client);
  registerSelfRoles(client);
  registerMovieNight(client);
  registerSpamTrap(client);
  registerMediaShow(client);
  registerSupport(client);
  setMovieClient(client);
  setWelcomeClient(client);

  startDashboard();
  console.log('[Blade X] Dashboard running.');

  await deployCommands();
  await client.login(config.token);
}

main().catch((e) => {
  console.error('[Blade X] ❌ فشل التشغيل:', e);
  process.exit(1);
});