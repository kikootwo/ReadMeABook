/**
 * Component: Discord Interaction Router
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Decides whether an interaction is handled at all. Everything must come from the
 * configured server, except buttons and select menus, which may also come from a DM
 * (request cards are DMed). Any other kind from a DM (commands, context menus,
 * autocomplete, modals) is dropped. Slash commands go by name; modals, buttons and menus
 * by their custom_id prefix. Handlers resolve the Discord user to an RMAB account
 * themselves, on every interaction; nothing here grants authority. Handler modules load on
 * first use, so a bot that is off never loads them.
 */

import { DISCORD_COMMANDS, REQUEST_COMMAND } from './discord-commands';
import { REQUEST_CUSTOM_ID_PREFIX } from './discord-custom-id';

/** The slash commands registered in the configured server (an idempotent bulk overwrite on every start). */
export { DISCORD_COMMANDS };

/** The fields of a discord.js Interaction the router reads. */
export interface RoutableInteraction {
  guildId: string | null;
  isChatInputCommand(): boolean;
  isButton(): boolean;
  isAnySelectMenu(): boolean;
  isModalSubmit?(): boolean;
  commandName?: string;
  customId?: string;
}

export type InteractionHandler = (interaction: RoutableInteraction) => Promise<void>;

export type RouteOutcome = 'handled' | 'ignored-foreign-guild' | 'ignored-unhandled';

type RequestHandlers = typeof import('./request/discord-request-handlers');
type RequestInteraction = Parameters<RequestHandlers['handleRequestCommand']>[0];
const requestHandlers = () => import('./request/discord-request-handlers');

/** Command handlers by name. */
const COMMAND_HANDLERS = new Map<string, InteractionHandler>([
  [REQUEST_COMMAND, async (i) => (await requestHandlers()).handleRequestCommand(i as unknown as RequestInteraction)],
]);

/** Modal, button and select menu handlers by custom_id prefix. */
const COMPONENT_HANDLERS = new Map<string, InteractionHandler>([
  [REQUEST_CUSTOM_ID_PREFIX, async (i) => (await requestHandlers()).handleRequestComponent(i as unknown as RequestInteraction)],
]);

/** True when the interaction may be handled for the configured server. */
export function isFromConfiguredGuild(interaction: RoutableInteraction, guildId: string): boolean {
  if (interaction.guildId === null) return interaction.isButton() || interaction.isAnySelectMenu();
  return interaction.guildId === guildId;
}

function componentHandler(
  interaction: RoutableInteraction,
  components: ReadonlyMap<string, InteractionHandler>
): InteractionHandler | undefined {
  const isComponent = interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit?.() === true;
  const customId = interaction.customId;
  if (!isComponent || typeof customId !== 'string') return undefined;
  for (const [prefix, handler] of components) {
    if (customId.startsWith(prefix)) return handler;
  }
  return undefined;
}

export async function routeInteraction(
  interaction: RoutableInteraction,
  guildId: string,
  handlers: ReadonlyMap<string, InteractionHandler> = COMMAND_HANDLERS,
  components: ReadonlyMap<string, InteractionHandler> = COMPONENT_HANDLERS
): Promise<RouteOutcome> {
  if (!isFromConfiguredGuild(interaction, guildId)) return 'ignored-foreign-guild';
  const handler = interaction.isChatInputCommand()
    ? interaction.commandName ? handlers.get(interaction.commandName) : undefined
    : componentHandler(interaction, components);
  if (!handler) return 'ignored-unhandled';
  await handler(interaction);
  return 'handled';
}
