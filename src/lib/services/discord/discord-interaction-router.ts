/**
 * Component: Discord Interaction Router
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Decides whether an interaction is handled at all. Everything must come from the
 * configured server, except buttons and select menus, which may also come from a DM
 * (request cards are DMed). Any other kind from a DM (commands, context menus,
 * autocomplete, modals) is dropped. Handlers resolve the Discord user to an RMAB account themselves, on every
 * interaction; nothing here grants authority. No commands are registered yet.
 */

/** The slash commands registered in the configured server (an idempotent bulk overwrite on every start). */
export const DISCORD_COMMANDS: readonly Record<string, unknown>[] = [];

/** The fields of a discord.js Interaction the router reads. */
export interface RoutableInteraction {
  guildId: string | null;
  isChatInputCommand(): boolean;
  isButton(): boolean;
  isAnySelectMenu(): boolean;
  commandName?: string;
}

export type InteractionHandler = (interaction: RoutableInteraction) => Promise<void>;

export type RouteOutcome = 'handled' | 'ignored-foreign-guild' | 'ignored-unhandled';

/** Command handlers by name. Empty until commands exist. */
const COMMAND_HANDLERS = new Map<string, InteractionHandler>();

/** True when the interaction may be handled for the configured server. */
export function isFromConfiguredGuild(interaction: RoutableInteraction, guildId: string): boolean {
  if (interaction.guildId === null) return interaction.isButton() || interaction.isAnySelectMenu();
  return interaction.guildId === guildId;
}

export async function routeInteraction(
  interaction: RoutableInteraction,
  guildId: string,
  handlers: ReadonlyMap<string, InteractionHandler> = COMMAND_HANDLERS
): Promise<RouteOutcome> {
  if (!isFromConfiguredGuild(interaction, guildId)) return 'ignored-foreign-guild';
  const handler = interaction.isChatInputCommand() && interaction.commandName ? handlers.get(interaction.commandName) : undefined;
  if (!handler) return 'ignored-unhandled';
  await handler(interaction);
  return 'handled';
}
