// ============================================================
// Blade X — Among Us Manager · Permissions
// Every interaction must pass through these checks on the backend.
// ============================================================

import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import type { AmongUsSession, AmongUsSettings } from './types.js';
import { safeJsonArray } from './database.js';

export interface AccessContext {
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
  isHostRole: boolean;
  isHelperRole: boolean;
}

export function getAccessContext(member: GuildMember, settings: AmongUsSettings | null): AccessContext {
  const userId = member.id;
  const isOwner = member.guild.ownerId === userId;
  const isAdmin =
    isOwner ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild);

  const hostRoles = new Set(safeJsonArray(settings?.host_role_ids));
  const helperRoles = new Set(safeJsonArray(settings?.helper_role_ids));

  const isHostRole = member.roles.cache.some((role) => hostRoles.has(role.id));
  const isHelperRole = member.roles.cache.some((role) => helperRoles.has(role.id));

  return { userId, isOwner, isAdmin, isHostRole, isHelperRole };
}

/** Setup / system settings are restricted to owner + server admins. */
export function canManageSettings(ctx: AccessContext): boolean {
  return ctx.isOwner || ctx.isAdmin;
}

export function canSetup(ctx: AccessContext): boolean {
  return canManageSettings(ctx);
}

/** Anyone with a configured host/helper role may open the system. */
export function canAccessSystem(ctx: AccessContext): boolean {
  return ctx.isOwner || ctx.isAdmin || ctx.isHostRole || ctx.isHelperRole;
}

/** Creating a session requires a real host role (or admin/owner). */
export function canHost(ctx: AccessContext): boolean {
  return ctx.isOwner || ctx.isAdmin || ctx.isHostRole;
}

/** Operating an existing session: host, assistant host, helper role or admin. */
export function canOperateSession(
  ctx: AccessContext,
  session: AmongUsSession,
  helperIds: string[],
): boolean {
  if (ctx.isOwner || ctx.isAdmin) return true;
  if (session.host_user_id === ctx.userId) return true;
  if (ctx.isHostRole || ctx.isHelperRole) return true;
  return helperIds.includes(ctx.userId);
}

/** Only the session host (or server admins) may add/remove assistant hosts. */
export function canManageSessionHelpers(
  ctx: AccessContext,
  session: AmongUsSession,
): boolean {
  return ctx.isOwner || ctx.isAdmin || session.host_user_id === ctx.userId;
}
