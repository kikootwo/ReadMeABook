/**
 * Component: Discord /request Access Check
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Run on every /request step (command, modal, select, confirm, cancel): resolve the Discord
 * user to an RMAB account (no cache; the same refusal as the web), then the requester role.
 * The role comes from `interaction.member` as Discord sends it for this interaction; with a
 * role set, no member (a DM) is a refusal. RMAB admins (database role) skip the role check.
 */

import { resolveDiscordActor, type DiscordActor } from '../discord-actor';
import { loadRequesterRoleId } from '../discord-config';

/** The parts of a discord.js interaction the /request handlers use. */
export interface RequestInteraction {
  guildId: string | null;
  user: { id: string };
  member?: unknown;
  customId?: string;
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand(): boolean;
  isModalSubmit(): boolean;
  isButton(): boolean;
  isStringSelectMenu(): boolean;
  options?: { getString(name: string): string | null };
  fields?: { getTextInputValue(customId: string): string };
  values?: string[];
  reply(options: object): Promise<unknown>;
  deferReply(options: object): Promise<unknown>;
  deferUpdate(): Promise<unknown>;
  editReply(options: object): Promise<unknown>;
  showModal(modal: object): Promise<unknown>;
}

export const NOT_LINKED =
  'Your Discord account is not linked to an RMAB account that can make requests. Ask an RMAB admin to link it.';
export const NO_REQUESTER_ROLE = 'You need the requester role in this server to request books.';

export type RequestAccess = { ok: true; actor: DiscordActor } | { ok: false; reply: string };

/** True when the member Discord sent with the interaction has the role (cached or raw member shape). */
export function memberHasRole(member: unknown, roleId: string): boolean {
  if (!member || typeof member !== 'object') return false;
  const roles = (member as { roles?: unknown }).roles;
  if (Array.isArray(roles)) return roles.includes(roleId);
  const cache = (roles as { cache?: { has?: (id: string) => boolean } } | undefined)?.cache;
  return typeof cache?.has === 'function' ? cache.has(roleId) === true : false;
}

/** Who is acting, or the fixed refusal to show them. Reads the database only. */
export async function checkRequestAccess(interaction: RequestInteraction): Promise<RequestAccess> {
  const actor = await resolveDiscordActor(interaction.user.id);
  if (!actor) return { ok: false, reply: NOT_LINKED };

  const roleId = await loadRequesterRoleId();
  if (roleId && !actor.isAdmin && !memberHasRole(interaction.member ?? null, roleId)) {
    return { ok: false, reply: NO_REQUESTER_ROLE };
  }
  return { ok: true, actor };
}
