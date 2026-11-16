/**
 * Component: Discord /status, Cancel and /delete Shared Parts
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The interaction shape the handlers use, their fixed reply texts, and the error reply. Replies
 * are fixed texts chosen from result fields: never a service message, error text or the reason
 * files were kept (those can name paths or the download client).
 */

import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import { MessageFlags, textOnly } from '../discord-format';

const logger = RMABLogger.create('Discord.Manage');

/** The parts of a discord.js command, button or select menu interaction these handlers use. */
export interface ManageInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  values?: string[];
  deferred?: boolean;
  replied?: boolean;
  isChatInputCommand(): boolean;
  isButton(): boolean;
  isStringSelectMenu(): boolean;
  reply(options: object): Promise<unknown>;
  deferReply(options: object): Promise<unknown>;
  /** Acknowledges a component on an ephemeral list; the list is then edited in place. */
  deferUpdate(): Promise<unknown>;
  editReply(options: object): Promise<unknown>;
}

export const EPHEMERAL = { flags: MessageFlags.Ephemeral };

export const MANAGE_TEXT = {
  notLinked: 'Your Discord account is not linked to an RMAB account. Ask an RMAB admin to link it.',
  notAdmin: 'Only RMAB admins can delete requests. To stop one of your own requests, use Cancel in /status or on its card.',
  notYours: 'You can cancel only your own requests.',
  notFound: 'This request no longer exists.',
  staleChoice: 'That choice is no longer available. Run the command again.',
  alreadyCancelled: 'This request was already cancelled.',
  deleteFailed: 'The request could not be deleted. The RMAB logs say why.',
  generic: 'Something went wrong. Try again in a moment.',
} as const;

/** Shows the fixed error text, whatever state the interaction is in; never throws. */
export async function failQuietly(interaction: ManageInteraction, step: string, error: unknown): Promise<void> {
  logger.warn('Discord request management step failed', { step, error: errorForLog(error) });
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply(textOnly(MANAGE_TEXT.generic));
    else await interaction.reply({ ...textOnly(MANAGE_TEXT.generic), ...EPHEMERAL });
  } catch (replyError) {
    logger.debug('Could not show the error', { error: errorForLog(replyError) });
  }
}
