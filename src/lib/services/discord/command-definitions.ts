/**
 * Component: Discord Slash Command Definitions
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Declarative definitions for the bot's slash commands, registered guild-scoped on the bot's
 * `ready` event (guild commands propagate instantly, unlike global commands).
 */

import { PermissionFlagsBits, SlashCommandBuilder, type SlashCommandOptionsOnlyBuilder } from 'discord.js';
import type { DeletePermission } from './discord-config';

export function buildCommandDefinitions(deletePermission: DeletePermission) {
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
      ),
    new SlashCommandBuilder()
      .setName('status')
      .setDescription('See the status of your outstanding requests'),
  ];

  if (deletePermission !== 'disabled') {
    const del = new SlashCommandBuilder()
      .setName('delete')
      .setDescription('Remove one of your requests from ReadMeABook');

    if (deletePermission === 'admin_only') {
      del.setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    }

    commands.push(del);
  }

  return commands.map((command) => command.toJSON());
}
