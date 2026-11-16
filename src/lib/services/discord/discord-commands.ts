/**
 * Component: Discord Slash Command Definitions
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The commands the bot bulk-overwrites in the configured server on every connect, as raw
 * API JSON (no discord.js import). Server commands exist only in that server, never in DMs.
 */

import { ApplicationCommandOptionType, ApplicationCommandType } from './discord-format';

export const REQUEST_COMMAND = 'request';
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
];
