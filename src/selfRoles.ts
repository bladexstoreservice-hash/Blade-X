import {
  Client, Events, Interaction, ButtonInteraction, StringSelectMenuInteraction,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  TextChannel, AttachmentBuilder, MessageFlags,
} from 'discord.js';
import {
  getSelfRoles, getSetting, setSetting, logActivity,
  getSelfRoleById, updateSelfRole, removeSelfRole,
  type SelfRoleRow,
} from './database.js';
import { config } from './config.js';
import { buildV2Panel, buildV2Payload, buildButtonRows, isV2Available } from './ui/v2.js';
import { getText, getColor } from './textRegistry.js';
import fs from 'node:fs';
import path from 'node:path';

const ROLE_IMAGE_PATH = path.resolve('assets', 'roleasign.png');

// ============================================================
// Panel config (unchanged)
// ============================================================
export interface SelfRolesPanelConfig {
  title: string;
  description: string;
  instructions: string;
  footer: string;
  color: number;
  personalTitle: string;
  personalDescriptionTemplate: string;
  personalInstructions: string;
  personalFooter: string;
  personalColor: number;
}

export function buildSelfRolesPanelConfig(): SelfRolesPanelConfig {
  return {
    title: getText('selfroles.panel.title'),
    description: getText('selfroles.panel.description'),
    instructions: getText('selfroles.panel.instructions'),
    footer: getText('selfroles.panel.footer'),
    color: getColor('color.selfroles', 0x5865f2),
    personalTitle: getText('selfroles.personal.title'),
    personalDescriptionTemplate: getText('selfroles.personal.description'),
    personalInstructions: getText('selfroles.personal.instructions'),
    personalFooter: getText('selfroles.personal.footer'),
    personalColor: getColor('color.selfroles_personal', 0x5865f2),
  };
}

// ============================================================
// Row update (unchanged)
// ============================================================
export function updateSelfRoleFull(
  id: number,
  patch: Partial<Pick<SelfRoleRow, 'role_id' | 'label' | 'emoji_id' | 'description' | 'sort_order' | 'enabled'>>,
): { ok: boolean; error?: string; row?: SelfRoleRow } {
  const current = getSelfRoleById(id);
  if (!current) return { ok: false, error: 'الرول غير موجود' };

  const normalized: Partial<SelfRoleRow> = { ...patch };
  if (patch.emoji_id === null) normalized.emoji_id = '';
  if (patch.description === null) normalized.description = '';

  if (patch.role_id !== undefined && patch.role_id !== current.role_id) {
    const conflict = getSelfRoles().find((r) => r.role_id === patch.role_id && r.id !== id);
    if (conflict) return { ok: false, error: 'هذا الرول مسجل بالفعل في لوحة أخرى' };
    if (!/^\d{17,20}$/.test(patch.role_id)) return { ok: false, error: 'role_id غير صالح' };
  }

  updateSelfRole(id, normalized);
  return { ok: true, row: getSelfRoleById(id) };
}

export function reorderSelfRoles(order: { id: number; sort_order: number }[]): { ok: boolean; count: number } {
  let count = 0;
  const all = new Set(getSelfRoles().map((r) => r.id));
  for (const item of order) {
    if (!all.has(item.id)) continue;
    if (typeof item.sort_order !== 'number' || !Number.isFinite(item.sort_order)) continue;
    updateSelfRole(item.id, { sort_order: item.sort_order });
    count++;
  }
  return { ok: true, count };
}

// ============================================================
// Select Menu construction
// ============================================================
const MAX_OPTIONS_PER_SELECT = 25;
const MAX_SELECTS = 5;

function buildSelectMenuOptions(roles: SelfRoleRow[], ownedRoleIds: Set<string> | null): StringSelectMenuOptionBuilder[] {
  return roles.map((r) => {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(r.label.slice(0, 100))
      .setValue(r.role_id);

    // Emoji
    if (r.emoji_id) {
      try { opt.setEmoji({ id: r.emoji_id }); }
      catch { /* fallback to unicode from label */ }
    } else {
      const um = r.label.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
      if (um) opt.setEmoji(um[0]);
    }

    // Description: use custom description if set, otherwise ownership hint (only for personal panel)
    if (r.description && r.description.trim()) {
      opt.setDescription(r.description.slice(0, 100));
    } else if (ownedRoleIds) {
      const owns = ownedRoleIds.has(r.role_id);
      opt.setDescription(owns ? '✅ تملكه — اختره لإزالته' : '➕ لا تملكه — اختره لإضافته');
    }

    return opt;
  });
}

function buildRoleSelectMenus(
  roles: SelfRoleRow[],
  ownedRoleIds: Set<string> | null,
  baseCustomId = 'sr:select',
): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];
  const chunks: SelfRoleRow[][] = [];
  for (let i = 0; i < roles.length; i += MAX_OPTIONS_PER_SELECT) {
    chunks.push(roles.slice(i, i + MAX_OPTIONS_PER_SELECT));
    if (chunks.length >= MAX_SELECTS) break;
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const menu = new StringSelectMenuBuilder()
      .setCustomId(i === 0 ? baseCustomId : `${baseCustomId}:${i}`)
      .setPlaceholder(chunk.length > 1 ? 'اختر رولًا أو أكثر...' : 'اختر رولًا...')
      .setMinValues(1)
      .setMaxValues(chunk.length);

    menu.addOptions(buildSelectMenuOptions(chunk, ownedRoleIds));
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
  }
  return rows;
}

// ============================================================
// Legacy button builder — kept for old panels
// ============================================================
function buildRoleButton(r: SelfRoleRow, own: boolean | null): ButtonBuilder {
  const btn = new ButtonBuilder()
    .setCustomId(`sr:toggle:${r.role_id}`)
    .setStyle(own === true ? ButtonStyle.Success : ButtonStyle.Secondary);

  if (r.emoji_id) {
    try { btn.setEmoji({ id: r.emoji_id }); return btn; } catch { /* fallthrough */ }
  }
  const um = r.label.match(/(\p{Emoji_Presentation}|\p{Extended_Pictographic})/u);
  if (um) btn.setEmoji(um[0]);
  else btn.setLabel(r.label.slice(0, 80));

  return btn;
}

// ============================================================
// Publish panel (now with selects)
// ============================================================
export async function publishRolePanel(client: Client): Promise<boolean> {
  const guild = client.guilds.cache.get(config.guildId);
  if (!guild) { console.error('[Blade X] ❌ guild not found'); return false; }

  const channelId = getSetting('self_roles_channel_id');
  if (!channelId) { console.warn('[Blade X] ⚠️ قناة الرولات غير مضبوطة'); return false; }

  const channel = guild.channels.cache.get(channelId) as TextChannel | undefined;
  if (!channel) { console.error('[Blade X] ❌ قناة الرولات غير موجودة'); return false; }

  const roles = getSelfRoles().filter((r) => r.enabled);
  if (roles.length === 0) { console.warn('[Blade X] ⚠️ لا توجد رولات'); return false; }

  if (!isV2Available()) { console.error('[Blade X] ❌ Components V2 غير متاح'); return false; }

  const panelCfg = buildSelfRolesPanelConfig();

  // ✅ Select menus instead of buttons
  const actionRows = buildRoleSelectMenus(roles, null);

  const files: AttachmentBuilder[] = [];
  let imageUrl: string | undefined;
  if (fs.existsSync(ROLE_IMAGE_PATH)) {
    try {
      files.push(new AttachmentBuilder(ROLE_IMAGE_PATH, { name: 'roleasign.png' }));
      imageUrl = 'attachment://roleasign.png';
    } catch (e) { console.error('[Blade X] ❌ فشل تحميل الصورة:', e); }
  }

  const container = buildV2Panel({
    accentColor: panelCfg.color,
    title: panelCfg.title,
    description: panelCfg.description,
    sections: panelCfg.instructions ? [{ text: panelCfg.instructions }] : [],
    imageUrl,
    imageDescription: 'Self-Assignable Roles Banner',
    actionRows,
    footerText: panelCfg.footer,
  });

  try {
    const oldId = getSetting('self_roles_message_id');
    if (oldId) {
      try { const m = await channel.messages.fetch(oldId); await m.delete(); } catch { /* ignore */ }
    }
    const payload = buildV2Payload(container);
    const msg = await channel.send({ ...(payload as any), files });
    setSetting('self_roles_message_id', msg.id);
    console.log('[Blade X] ✅ تم نشر لوحة الرولات (Select Menu)');
    return true;
  } catch (e) {
    console.error('[Blade X] ❌ فشل نشر اللوحة:', e);
    return false;
  }
}

// ============================================================
// Personal panel
// ============================================================
async function buildPersonalPanel(interaction: any): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: getText('selfroles.error.generic'), flags: MessageFlags.Ephemeral });
    return;
  }
  const allowed = getSelfRoles().filter(r => r.enabled);
  if (allowed.length === 0) {
    await interaction.reply({ content: getText('selfroles.empty.no_roles'), flags: MessageFlags.Ephemeral });
    return;
  }
  const cfg = buildSelfRolesPanelConfig();
  const ownedRoleIds = new Set(allowed.filter(r => member.roles.cache.has(r.role_id)).map(r => r.role_id));
  const rows = buildRoleSelectMenus(allowed, ownedRoleIds);
  const ownedCount = ownedRoleIds.size;

  const container = buildV2Panel({
    accentColor: cfg.personalColor,
    title: cfg.personalTitle,
    description: cfg.personalDescriptionTemplate
      .replace(/\{owned\}/g, String(ownedCount))
      .replace(/\{total\}/g, String(allowed.length)),
    sections: cfg.personalInstructions ? [{ text: cfg.personalInstructions }] : [],
    actionRows: rows,
    footerText: cfg.personalFooter,
  });

  const payload = buildV2Payload(container);
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload as any);
  } else {
    await interaction.reply({ ...(payload as any), flags: (payload.flags | MessageFlags.Ephemeral) });
  }
}

// ============================================================
// Select handler — multi-toggle
// ============================================================
async function handleSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: '❌ السيرفر غير متاح.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }

  const me = guild.members.me;
  if (!me) {
    await interaction.reply({ content: '❌ البوت غير متاح.', flags: MessageFlags.Ephemeral });
    return;
  }

  // Defer immediately to avoid Unknown interaction
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (e) {
    console.error('[Blade X] selfroles deferReply failed:', e);
    return;
  }

  const allowed = getSelfRoles().filter(r => r.enabled);
  const allowedMap = new Map(allowed.map(r => [r.role_id, r]));

  let member;
  try {
    member = await guild.members.fetch(interaction.user.id);
  } catch {
    await interaction.editReply({ content: '❌ فشل جلب العضو.' });
    return;
  }

  const added: string[] = [];
  const removed: string[] = [];
  const failed: string[] = [];

  for (const roleId of interaction.values) {
    const allowedRole = allowedMap.get(roleId);
    if (!allowedRole) { failed.push(roleId); continue; }

    const role = guild.roles.cache.get(roleId);
    if (!role) { failed.push(allowedRole.label); continue; }

    if (role.position >= me.roles.highest.position) { failed.push(allowedRole.label); continue; }

    try {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, 'Self Roles');
        removed.push(role.name);
        logActivity('self_role_remove', interaction.user.id, role.name);
      } else {
        await member.roles.add(roleId, 'Self Roles');
        added.push(role.name);
        logActivity('self_role_add', interaction.user.id, role.name);
      }
    } catch (e) {
      console.error('[Blade X] selfroles toggle error:', e);
      failed.push(allowedRole.label);
    }
  }

  const lines: string[] = [];
  if (added.length > 0) {
    const names = added.map(n => `**${n}**`).join('، ');
    lines.push(added.length === 1 ? `✅ تم إضافة ${names}` : `✅ تم إضافة ${added.length}: ${names}`);
  }
  if (removed.length > 0) {
    const names = removed.map(n => `**${n}**`).join('، ');
    lines.push(removed.length === 1 ? `➖ تم إزالة ${names}` : `➖ تم إزالة ${removed.length}: ${names}`);
  }
  if (failed.length > 0) {
    lines.push(`⚠️ فشل: ${failed.join('، ')}`);
  }

  await interaction.editReply({ content: lines.join('\n') || 'لم يتم تغيير أي رول.' });
}

// ============================================================
// Legacy button toggle (kept for old messages)
// ============================================================
async function handleToggle(interaction: ButtonInteraction, roleId: string): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const allowed = getSelfRoles().find(r => r.role_id === roleId && r.enabled);
  if (!allowed) {
    await interaction.reply({ content: getText('selfroles.error.not_allowed'), flags: MessageFlags.Ephemeral });
    return;
  }
  const role = guild.roles.cache.get(roleId);
  if (!role) {
    await interaction.reply({ content: getText('selfroles.error.role_missing'), flags: MessageFlags.Ephemeral });
    return;
  }
  const me = guild.members.me;
  if (!me || role.position >= me.roles.highest.position) {
    await interaction.reply({ content: getText('selfroles.error.hierarchy'), flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    const member = await guild.members.fetch(interaction.user.id);
    const owns = member.roles.cache.has(roleId);
    if (owns) {
      await member.roles.remove(roleId, 'Self Roles');
      logActivity('self_role_remove', interaction.user.id, role.name);
    } else {
      await member.roles.add(roleId, 'Self Roles');
      logActivity('self_role_add', interaction.user.id, role.name);
    }
    const isEphemeral = interaction.message.flags.has(MessageFlags.Ephemeral);
    if (isEphemeral) {
      await buildPersonalPanel(interaction);
    } else {
      const messageKey = owns ? 'selfroles.success.remove' : 'selfroles.success.add';
      await interaction.reply({ content: getText(messageKey, { role: role.name }), flags: MessageFlags.Ephemeral });
    }
  } catch (e) {
    console.error('[Blade X] ❌ toggle error:', e);
    await interaction.reply({ content: getText('selfroles.error.generic'), flags: MessageFlags.Ephemeral });
  }
}

// ============================================================
// Registration
// ============================================================
export function registerSelfRoles(client: Client): void {
  if (!isV2Available()) {
    console.error('[Blade X] ❌ Components V2 غير متاح — selfRoles لن يعمل');
    return;
  }

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    try {
      // ✅ NEW: Select menu handler
      if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'sr:select' || interaction.customId.startsWith('sr:select:')) {
          await handleSelect(interaction);
          return;
        }
      }

      // Legacy button handler (backward compat for old panels)
      if (!interaction.isButton()) return;
      const id = interaction.customId;
      if (id === 'sr:open') {
        await buildPersonalPanel(interaction);
        return;
      }
      if (id.startsWith('sr:toggle:')) {
        const roleId = id.split(':')[2];
        await handleToggle(interaction, roleId);
      }
    } catch (e) {
      console.error('[Blade X] ❌ selfroles error:', e);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: getText('selfroles.error.generic'), flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  });
}

// ============================================================
// Slash command definitions (unchanged)
// ============================================================
export const rolePanelCommand = {
  name: 'role-panel',
  description: 'إدارة لوحة الرولات',
  default_member_permissions: '8',
  options: [
    { type: 1, name: 'publish', description: 'نشر أو تحديث اللوحة' },
    { type: 1, name: 'list', description: 'عرض الرولات' },
    {
      type: 1, name: 'add', description: 'إضافة رول',
      options: [
        { type: 8, name: 'role', description: 'الرول', required: true },
        { type: 3, name: 'label', description: 'الاسم', required: false },
        { type: 3, name: 'description', description: 'الوصف', required: false },
        { type: 3, name: 'emoji_id', description: 'Emoji ID', required: false },
      ],
    },
    { type: 1, name: 'remove', description: 'إزالة رول', options: [{ type: 8, name: 'role', description: 'الرول', required: true }] },
  ],
};

export const rolesCommand = { name: 'roles', description: 'افتح لوحة الرولات الشخصية' };

export { removeSelfRole };