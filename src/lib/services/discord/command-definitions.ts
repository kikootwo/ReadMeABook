/**
 * Component: Discord Slash Command Definitions
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Declarative definitions for the bot's slash commands, registered guild-scoped on the bot's
 * `ready` event (guild commands propagate instantly, unlike global commands).
 */

import { SlashCommandBuilder } from 'discord.js';

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('checkout')
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
  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Remove one of your outstanding requests'),
].map((command) => command.toJSON());
