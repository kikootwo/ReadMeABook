/**
 * Component: Discord Slash Command Definitions
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The commands (/request, /status, /delete) the bot bulk-overwrites in the configured server on every connect, as raw
 * API JSON (no discord.js import). Server commands exist only in that server, never in DMs.
 */

import { ApplicationCommandOptionType, ApplicationCommandType } from './discord-format';

export const REQUEST_COMMAND = 'request';
export const STATUS_COMMAND = 'status';
export const DELETE_COMMAND = 'delete';
/**
 * Discord's Administrator permission bit. On /delete it only hides the command from members
 * without it (a server can grant it to others): the handler requires an RMAB admin on every step.
 */
export const ADMINISTRATOR_PERMISSION = '8';
/** Longest search text accepted from the command option or the search modal. */
export const REQUEST_QUERY_MAX_LENGTH = 200;

export const DISCORD_COMMANDS: readonly Record<string, unknown>[] = [
  {
    type: ApplicationCommandType.ChatInput,
    name: REQUEST_COMMAND,
    description: 'Request an audiobook or an ebook',
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'type',
        description: 'What to request',
        required: true,
        choices: [
          { name: 'Audiobook', value: 'audiobook' },
          { name: 'Ebook', value: 'ebook' },
        ],
      },
      {
        type: ApplicationCommandOptionType.String,
        name: 'query',
        description: 'Title or author (leave empty to type it in a form)',
        required: false,
        max_length: REQUEST_QUERY_MAX_LENGTH,
      },
    ],
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: STATUS_COMMAND,
    description: 'Your requests and their status (RMAB admins see all), with Cancel',
  },
  {
    type: ApplicationCommandType.ChatInput,
    name: DELETE_COMMAND,
    description: 'Delete a request and its files (RMAB admins only)',
    default_member_permissions: ADMINISTRATOR_PERMISSION,
  },
];
