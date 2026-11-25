// ============================================================
// Blade X — Among Us Manager · Setup Wizard
// ============================================================

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  type Guild,
  type Interaction,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import {
  getAmongUsSettings,
  setAmongUsSetupCompleted,
  upsertAmongUsSettings,
} from './database.js';
import { buildId } from './ids.js';
import { recordEvent } from './logger.js';
import { updateDashboardMessage } from './panel.js';
import { canManageSettings, getAccessContext } from './permissions.js';
import type { AmongUsSettings } from './types.js';
import { buildV2Panel, buildV2Payload } from '../ui/v2.js';

export interface SetupCheckResult {
  ok: boolean;
  lines: string[];
  errors: string[];
  warnings: string[];
}

export interface SetupDraft {
  guildId: string;
  startedBy: string;
  step: number;
  voiceChannelId: string | null;
  controlChannelId: string | null;
  hostRoleIds: string[];
  helperRoleIds: string[];
  logChannelId: string | null;
  lastError: string | null;
  lastCheck: SetupCheckResult | null;
  updatedAt: number;
}

const drafts = new Map<string, SetupDraft>();
const DRAFT_TTL_MS = 30 * 60_000;

function cleanupDrafts(): void {
  const now = Date.now();
  for (const [key, draft] of drafts) {
    if (now - draft.updatedAt > DRAFT_TTL_MS) drafts.delete(key);
  }
}

function formatChannel(id: string | null): string {
  return id ? `<#${id}>` : '`غير محدد`';
}

function formatRoles(ids: string[]): string {
  return ids.length > 0 ? ids.map((id) => `<@&${id}>`).join('، ') : '`لا يوجد`';
}

function draftFromSettings(settings: AmongUsSettings | null, guildId: string, userId: string): SetupDraft {
  return {
    guildId,
    startedBy: userId,
    step: 0,
    voiceChannelId: settings?.voice_channel_id ?? null,
    controlChannelId: settings?.control_channel_id ?? null,
    hostRoleIds: settings ? safeRoles(settings.host_role_ids) : [],
    helperRoleIds: settings ? safeRoles(settings.helper_role_ids) : [],
    logChannelId: settings?.log_channel_id ?? null,
    lastError: null,
    lastCheck: null,
    updatedAt: Date.now(),
  };
}

function safeRoles(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isTextChannelType(type: ChannelType): boolean {
  return type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement;
}

function isVoiceChannelType(type: ChannelType): boolean {
  return type === ChannelType.GuildVoice || type === ChannelType.GuildStageVoice;
}

async function checkChannel(
  guild: Guild,
  channelId: string | null,
  kind: 'voice' | 'text',
  required: bigint[],
  warnings: bigint[],
  label: string,
  result: SetupCheckResult,
): Promise<void> {
  if (!channelId) {
    if (kind === 'voice' || label.includes('التحكم')) {
      result.errors.push(`${label}: لم يتم اختيار قناة.`);
      result.lines.push(`❌ **${label}:** غير محدد`);
    } else {
      result.lines.push(`➖ **${label}:** غير محدد (اختياري)`);
    }
    return;
  }

  const channel =
    guild.channels.cache.get(channelId) ??
    (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel) {
    result.errors.push(`${label}: القناة غير موجودة.`);
    result.lines.push(`❌ **${label}:** القناة غير موجودة`);
    return;
  }

  const validType = kind === 'voice' ? isVoiceChannelType(channel.type) : isTextChannelType(channel.type);
  if (!validType) {
    result.errors.push(`${label}: نوع القناة غير صحيح.`);
    result.lines.push(`❌ **${label}:** نوع القناة غير صحيح`);
    return;
  }

  const me = guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  const missingRequired = required.filter((perm) => !perms?.has(perm));
  const missingWarnings = warnings.filter((perm) => !perms?.has(perm));

  if (missingRequired.length > 0) {
    result.errors.push(`${label}: صلاحيات ناقصة (${missingRequired.length}).`);
    result.lines.push(`❌ **${label}:** صلاحيات ناقصة — ${missingRequired.length}`);
  } else if (missingWarnings.length > 0) {
    result.warnings.push(`${label}: بعض الصلاحيات الاختيارية ناقصة.`);
    result.lines.push(`⚠️ **${label}:** جاهزة مع تحذيرات — ${missingWarnings.length}`);
  } else {
    result.lines.push(`✅ **${label}:** جاهزة`);
  }
}

export async function runPermissionCheck(
  guild: Guild,
  input: { voiceChannelId: string | null; controlChannelId: string | null; logChannelId: string | null },
): Promise<SetupCheckResult> {
  const result: SetupCheckResult = { ok: true, lines: [], errors: [], warnings: [] };
  const me = guild.members.me ?? (await guild.members.fetch(guild.client.user!.id).catch(() => null));

  if (!me) {
    result.ok = false;
    result.errors.push('تعذر العثور على عضو البوت في السيرفر.');
    result.lines.push('❌ **البوت:** غير موجود في السيرفر');
    return result;
  }

  if (!me.permissions.has(PermissionFlagsBits.MuteMembers)) {
    result.errors.push('البوت لا يملك صلاحية Mute Members.');
    result.lines.push('❌ **Mute Members:** غير متوفرة (مطلوبة)');
  } else {
    result.lines.push('✅ **Mute Members:** متوفرة');
  }

  await checkChannel(
    guild,
    input.voiceChannelId,
    'voice',
    [PermissionFlagsBits.ViewChannel],
    [PermissionFlagsBits.Connect],
    'الروم الصوتي',
    result,
  );

  await checkChannel(
    guild,
    input.controlChannelId,
    'text',
    [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ],
    [PermissionFlagsBits.EmbedLinks],
    'قناة التحكم',
    result,
  );

  await checkChannel(
    guild,
    input.logChannelId,
    'text',
    [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
    [PermissionFlagsBits.EmbedLinks],
    'قناة السجلات',
    result,
  );

  result.warnings.push(
    'الأعضاء الذين يملكون رتبة أعلى من رتبة البوت لا يمكن للبوت كتمهم. راجع ترتيب الرتب.',
  );
  result.lines.push('ℹ️ **Hierarchy:** تأكد أن رتبة البوت أعلى من رتب اللاعبين.');

  result.ok = result.errors.length === 0;
  return result;
}

function buildSetupContainer(guild: Guild, draft: SetupDraft): ReturnType<typeof buildV2Panel> {
  const step = draft.step;
  const stepNames = ['الروم الصوتي', 'قناة التحكم', 'الرتب', 'قناة السجلات', 'فحص الصلاحيات', 'المراجعة'];
  const stepIndex = Math.min(step, 5);
  const totalSteps = 6;

  const sections: Array<{ text: string }> = [
    {
      text:
        `**الخطوة ${stepIndex + 1} من ${totalSteps} · ${stepNames[stepIndex]}**\n` +
        '-# إعداد Among Us Manager لهذا السيرفر. يمكنك الرجوع أو الإلغاء في أي وقت.',
    },
  ];

  if (draft.lastError) {
    sections.push({ text: `⚠️ **تنبيه:** ${draft.lastError}` });
  }

  sections.push({
    text:
      `**الروم الصوتي:** ${formatChannel(draft.voiceChannelId)}\n` +
      `**قناة التحكم:** ${formatChannel(draft.controlChannelId)}\n` +
      `**رتب المضيفين:** ${formatRoles(draft.hostRoleIds)}\n` +
      `**رتب المساعدين:** ${formatRoles(draft.helperRoleIds)}\n` +
      `**قناة السجلات:** ${formatChannel(draft.logChannelId)}`,
  });

  const rows: ActionRowBuilder<any>[] = [];
  const buttonRow = new ActionRowBuilder<ButtonBuilder>();

  if (step === 0) {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(buildId('setup', guild.id, 'voice'))
      .setPlaceholder('اختر الروم الصوتي الثابت...')
      .setChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
      .setMinValues(1)
      .setMaxValues(1);
    rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select));
    sections.push({
      text: '🎙️ اختر الروم الصوتي الذي سيدير فيه النظام الجلسات. لا يتم إنشاء أو نقل أي روم تلقائيًا.',
    });
  } else if (step === 1) {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(buildId('setup', guild.id, 'control'))
      .setPlaceholder('اختر قناة لوحة التحكم...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1);
    rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select));
    sections.push({
      text: '💬 اختر القناة النصية التي ستُرسل فيها لوحة التحكم الأساسية الواحدة.',
    });
  } else if (step === 2) {
    const hostSelect = new RoleSelectMenuBuilder()
      .setCustomId(buildId('setup', guild.id, 'hosts'))
      .setPlaceholder('رتب المضيفين المصرّح لهم...')
      .setMinValues(0)
      .setMaxValues(10);
    const helperSelect = new RoleSelectMenuBuilder()
      .setCustomId(buildId('setup', guild.id, 'helpers'))
      .setPlaceholder('رتب المضيفين المساعدين (اختياري)...')
      .setMinValues(0)
      .setMaxValues(10);
    rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(hostSelect));
    rows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(helperSelect));
    sections.push({
      text:
        '🎭 اختر رتب المضيفين الأساسيين ورتب المساعدين. مالك السيرفر والإدارة مخوّلون دائمًا. ' +
        'يمكن ترك القوائم فارغة إذا كانت الإدارة وحدها ستستضيف.',
    });
  } else if (step === 3) {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(buildId('setup', guild.id, 'logs'))
      .setPlaceholder('اختر قناة السجلات (اختياري)...')
      .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1);
    rows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(select));
    sections.push({
      text: '📝 قناة السجلات اختيارية. تُسجّل فيها العمليات المهمة والتعديلات الخارجية والأخطاء.',
    });
  } else if (step === 4) {
    const check = draft.lastCheck;
    if (check) {
      sections.push({
        text:
          `**نتيجة الفحص:** ${check.ok ? '✅ جاهز' : '❌ توجد مشاكل'}\n` +
          check.lines.join('\n'),
      });
      if (check.errors.length > 0) {
        sections.push({ text: `❌ **أخطاء:**\n${check.errors.slice(0, 8).join('\n')}` });
      }
    } else {
      sections.push({ text: '⏳ اضغط **Re-check** لفحص صلاحيات البوت.' });
    }
  } else {
    const check = draft.lastCheck;
    sections.push({
      text:
        '**ملخص الإعداد**\n' +
        `• الروم الصوتي: ${formatChannel(draft.voiceChannelId)}\n` +
        `• قناة التحكم: ${formatChannel(draft.controlChannelId)}\n` +
        `• رتب المضيفين: ${formatRoles(draft.hostRoleIds)}\n` +
        `• رتب المساعدين: ${formatRoles(draft.helperRoleIds)}\n` +
        `• قناة السجلات: ${formatChannel(draft.logChannelId)}\n` +
        `• فحص الصلاحيات: ${check?.ok ? '✅ ناجح' : '❌ يحتاج مراجعة'}`,
    });
  }

  if (step === 5) {
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('setup', guild.id, 'confirm'))
        .setLabel('Confirm Setup')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(buildId('setup', guild.id, 'edit'))
        .setLabel('Edit Settings')
        .setEmoji('✏️')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(buildId('setup', guild.id, 'cancel'))
        .setLabel('Cancel')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Danger),
    );
  } else {
    if (step > 0) {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('setup', guild.id, 'back'))
          .setLabel('Back')
          .setEmoji('◀️')
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (step === 2) {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('setup', guild.id, 'next'))
          .setLabel('Next')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Primary),
      );
    }
    if (step === 3) {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('setup', guild.id, 'skip-logs'))
          .setLabel('Skip Logs')
          .setEmoji('⏭️')
          .setStyle(ButtonStyle.Secondary),
      );
    }
    if (step === 4) {
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId(buildId('setup', guild.id, 'check'))
          .setLabel('Re-check')
          .setEmoji('🔄')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(buildId('setup', guild.id, 'next'))
          .setLabel('Next')
          .setEmoji('▶️')
          .setStyle(ButtonStyle.Primary),
      );
    }
    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId(buildId('setup', guild.id, 'cancel'))
        .setLabel('Cancel')
        .setEmoji('✖️')
        .setStyle(ButtonStyle.Danger),
    );
  }

  if (buttonRow.components.length > 0) rows.push(buttonRow);

  return buildV2Panel({
    accentColor: 0x5865f2,
    title: '⚙️ Among Us Manager — Setup',
    description: `-# ${guild.name}`,
    sections,
    separatorBetweenSections: true,
    actionRows: rows as any,
    footerText: 'Blade X · Among Us Setup',
  });
}

async function renderSetup(
  interaction: Interaction,
  draft: SetupDraft,
  update: boolean,
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  const container = buildSetupContainer(guild, draft);
  const payload = { ...(buildV2Payload(container) as any), allowedMentions: { parse: [] } };

  if (update && interaction.isMessageComponent()) {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => undefined);
    } else {
      await interaction.update(payload).catch(() => undefined);
    }
    return;
  }
  if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ ...payload, flags: payload.flags | 64 }).catch(() => undefined);
  } else if (interaction.isRepliable()) {
    await interaction.editReply(payload).catch(() => undefined);
  }
}

export async function startSetup(interaction: Interaction): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;
  cleanupDrafts();

  const settings = await getAmongUsSettings(guild.id);
  const draft = draftFromSettings(settings, guild.id, interaction.user.id);
  drafts.set(guild.id, draft);
  await renderSetup(interaction, draft, false);
}

function validateStep(draft: SetupDraft): string | null {
  if (draft.step === 0 && !draft.voiceChannelId) return 'اختر الروم الصوتي أولًا.';
  if (draft.step === 1 && !draft.controlChannelId) return 'اختر قناة لوحة التحكم أولًا.';
  if (draft.step === 4 && draft.lastCheck && !draft.lastCheck.ok) {
    return 'فحص الصلاحيات يحتوي على أخطاء. أصلحها ثم أعد الفحص.';
  }
  return null;
}

async function finalizeSetup(interaction: Interaction, draft: SetupDraft): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  const check = await runPermissionCheck(guild, {
    voiceChannelId: draft.voiceChannelId,
    controlChannelId: draft.controlChannelId,
    logChannelId: draft.logChannelId,
  });
  draft.lastCheck = check;

  if (!check.ok) {
    draft.step = 4;
    draft.lastError = 'لا يمكن إكمال الإعداد قبل إصلاح أخطاء الصلاحيات.';
    draft.updatedAt = Date.now();
    await renderSetup(interaction, draft, true);
    return;
  }

  await upsertAmongUsSettings({
    guild_id: guild.id,
    voice_channel_id: draft.voiceChannelId,
    control_channel_id: draft.controlChannelId,
    control_message_id: null,
    host_role_ids: draft.hostRoleIds,
    helper_role_ids: draft.helperRoleIds,
    log_channel_id: draft.logChannelId,
    setup_completed: 0,
  });

  const saved = await getAmongUsSettings(guild.id);
  if (!saved) {
    draft.lastError = 'تعذر حفظ الإعدادات في قاعدة البيانات.';
    draft.step = 5;
    draft.updatedAt = Date.now();
    await renderSetup(interaction, draft, true);
    return;
  }

  const panel = await updateDashboardMessage(interaction.client, guild.id, saved, null);
  if (!panel.ok) {
    await setAmongUsSetupCompleted(guild.id, false);
    draft.lastError = `فشل إنشاء لوحة التحكم: ${panel.error ?? 'خطأ غير معروف'}`;
    draft.step = 5;
    draft.updatedAt = Date.now();
    await renderSetup(interaction, draft, true);
    return;
  }

  await setAmongUsSetupCompleted(guild.id, true);
  drafts.delete(guild.id);

  await recordEvent({
    guildId: guild.id,
    actorUserId: interaction.user.id,
    action: 'setup_completed',
    newState: 'ready',
    logText: `✅ أكمل <@${interaction.user.id}> إعداد Among Us Manager.`,
    client: interaction.client,
    guild,
    settings: await getAmongUsSettings(guild.id),
    notifyHostText: undefined,
  });

  const success = buildV2Panel({
    accentColor: 0x57f287,
    title: '✅ Among Us Manager — Ready',
    description: `-# ${guild.name}`,
    sections: [
      {
        text:
          'تم حفظ الإعدادات وإنشاء لوحة التحكم الأساسية بنجاح.\n' +
          `**قناة التحكم:** <#${saved.control_channel_id}>\n` +
          'استخدم `/amongus` لفتح النظام أو انتقل إلى رسالة اللوحة في القناة.',
      },
      {
        text: `-# Panel: ${panel.messageId ? `\`${panel.messageId}\`` : 'تم الإنشاء'}`,
      },
    ],
    footerText: 'Blade X · Among Us Manager',
  });

  if (interaction.isMessageComponent()) {
    await interaction.editReply({
      ...(buildV2Payload(success) as any),
      allowedMentions: { parse: [] },
    }).catch(() => undefined);
  }
}

export async function handleSetupInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.isMessageComponent()) return;
  const guild = interaction.guild;
  if (!guild) return;

  const parts = interaction.customId.split(':');
  // aus:setup:<guildId>:<action>
  if (parts.length < 4) return;
  if (parts[2] !== guild.id) return;

  // Re-check permissions on every interaction, not only when the wizard opens.
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  const settings = await getAmongUsSettings(guild.id);
  if (!member || !canManageSettings(getAccessContext(member, settings))) {
    await interaction.reply({
      content: '❌ لا تملك صلاحية إعداد Among Us Manager.',
      flags: 64,
    }).catch(() => undefined);
    return;
  }

  const draft = drafts.get(guild.id);
  if (!draft) {
    await interaction.reply({
      content: '⌛ انتهت صلاحية جلسة الإعداد. استخدم `/amongus` من جديد.',
      flags: 64,
    }).catch(() => undefined);
    return;
  }
  if (draft.startedBy !== interaction.user.id) {
    await interaction.reply({
      content: '❌ هذا الإعداد بدأه مسؤول آخر. اطلب منه إكماله أو استخدم `/amongus`.',
      flags: 64,
    }).catch(() => undefined);
    return;
  }

  draft.updatedAt = Date.now();
  draft.lastError = null;
  const action = parts[3];

  if (interaction.isChannelSelectMenu()) {
    const channelId = interaction.values[0] ?? null;
    const channel = channelId
      ? guild.channels.cache.get(channelId) ??
        (await guild.channels.fetch(channelId).catch(() => null))
      : null;

    if (action === 'voice') {
      if (!channel || !isVoiceChannelType(channel.type)) {
        draft.lastError = 'اختر قناة صوتية صالحة.';
        await renderSetup(interaction, draft, true);
        return;
      }
      draft.voiceChannelId = channel.id;
      draft.step = 1;
      await renderSetup(interaction, draft, true);
      return;
    }

    if (action === 'control') {
      if (!channel || !isTextChannelType(channel.type)) {
        draft.lastError = 'اختر قناة نصية صالحة.';
        await renderSetup(interaction, draft, true);
        return;
      }
      draft.controlChannelId = channel.id;
      draft.step = 2;
      await renderSetup(interaction, draft, true);
      return;
    }

    if (action === 'logs') {
      if (!channel || !isTextChannelType(channel.type)) {
        draft.lastError = 'اختر قناة نصية صالحة أو تخطَّ الخطوة.';
        await renderSetup(interaction, draft, true);
        return;
      }
      draft.logChannelId = channel.id;
      draft.step = 4;
      draft.lastCheck = await runPermissionCheck(guild, draft);
      await renderSetup(interaction, draft, true);
      return;
    }
    return;
  }

  if (interaction.isRoleSelectMenu()) {
    if (action === 'hosts') {
      draft.hostRoleIds = [...new Set(interaction.values)].slice(0, 10);
      await renderSetup(interaction, draft, true);
      return;
    }
    if (action === 'helpers') {
      draft.helperRoleIds = [...new Set(interaction.values)].slice(0, 10);
      await renderSetup(interaction, draft, true);
      return;
    }
    return;
  }

  if (!interaction.isButton()) return;

  switch (action) {
    case 'back':
      draft.step = Math.max(0, draft.step - 1);
      await renderSetup(interaction, draft, true);
      return;
    case 'next': {
      const error = validateStep(draft);
      if (error) {
        draft.lastError = error;
        await renderSetup(interaction, draft, true);
        return;
      }
      draft.step = Math.min(5, draft.step + 1);
      if (draft.step === 4) {
        draft.lastCheck = await runPermissionCheck(guild, draft);
      }
      await renderSetup(interaction, draft, true);
      return;
    }
    case 'skip-logs':
      draft.logChannelId = null;
      draft.step = 4;
      draft.lastCheck = await runPermissionCheck(guild, draft);
      await renderSetup(interaction, draft, true);
      return;
    case 'check':
      draft.step = 4;
      draft.lastCheck = await runPermissionCheck(guild, draft);
      await renderSetup(interaction, draft, true);
      return;
    case 'edit':
      draft.step = 0;
      await renderSetup(interaction, draft, true);
      return;
    case 'confirm':
      await interaction.deferUpdate().catch(() => undefined);
      await finalizeSetup(interaction, draft);
      return;
    case 'cancel':
      drafts.delete(guild.id);
      await interaction.update({
        ...(buildV2Payload(
          buildV2Panel({
            accentColor: 0x747f8d,
            title: '✖️ Setup Cancelled',
            description: `-# ${guild.name}`,
            sections: [{ text: 'تم إلغاء إعداد Among Us Manager. لم يتم حفظ أي تغييرات.' }],
            footerText: 'Blade X · Among Us Setup',
          }),
        ) as any),
      }).catch(() => undefined);
      return;
    default:
      return;
  }
}
