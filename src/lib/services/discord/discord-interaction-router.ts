/**
 * Component: Discord Interaction Router
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Decides whether an interaction is handled at all. Slash commands, autocomplete and
 * modal submits must come from the configured server (none from DMs or other servers).
 * Buttons and menus may come from a DM (request cards are DMed) but never from another
 * server. Handlers resolve the Discord user to an RMAB account themselves, on every
 * interaction; nothing here grants authority. No commands are registered yet.
 */

/** The slash commands registered in the configured server (an idempotent bulk overwrite on every start). */
export const DISCORD_COMMANDS: readonly Record<string, unknown>[] = [];

/** The fields of a discord.js Interaction the router reads. */
export interface RoutableInteraction {
  guildId: string | null;
  isChatInputCommand(): boolean;
  isAutocomplete(): boolean;
  isModalSubmit(): boolean;
  commandName?: string;
}

export type InteractionHandler = (interaction: RoutableInteraction) => Promise<void>;

export type RouteOutcome = 'handled' | 'ignored-foreign-guild' | 'ignored-unhandled';

/** Command handlers by name. Empty until commands exist. */
const COMMAND_HANDLERS = new Map<string, InteractionHandler>();

/** True when the interaction may be handled for the configured server. */
export function isFromConfiguredGuild(interaction: RoutableInteraction, guildId: string): boolean {
  const needsGuild = interaction.isChatInputCommand() || interaction.isAutocomplete() || interaction.isModalSubmit();
  if (interaction.guildId === null) return !needsGuild;
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
