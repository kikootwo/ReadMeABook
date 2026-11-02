/**
 * Component: Discord Slash Command Definitions
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Declarative definitions for the bot's slash commands, registered guild-scoped on the bot's
 * `ready` event (guild commands propagate instantly, unlike global commands).
 */

import { PermissionFlagsBits, SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder } from 'discord.js';

export function buildCommandDefinitions() {
  const commands: (SlashCommandBuilder | SlashCommandOptionsOnlyBuilder)[] = [
    new SlashCommandBuilder()
      .setName('request')
      .setDescription('Request a title from ReadMeABook')
      .addStringOption((option) =>
        option
          .setName('type')
          .setDescription('What kind of media to request')
          .setRequired(true)
          .addChoices(
            { name: 'Audiobook', value: 'audiobook' },
            { name: 'E-book', value: 'ebook' }
          )
      )
      .addStringOption((option) =>
        option
          .setName('query')
          .setDescription('Search term (skips the popup)')
          .setRequired(false)
          .setMaxLength(200)
      ),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('See the status of your outstanding requests'),
  ];

  // Deleting removes library files, so /delete is for RMAB admins only (re-checked by the handler).
  // Hidden from non-administrators by default; a server can grant it to an admin role under
  // Server Settings → Integrations. Everyone else cancels instead (/status or the card's button).
  commands.push(
    new SlashCommandBuilder()
      .setName('delete')
      .setDescription('Admins: delete a request and its files from ReadMeABook')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  );

  return commands.map((command) => command.toJSON());
}
