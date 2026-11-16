/**
 * Component: Discord /status, Cancel and /delete Shared Parts
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The interaction shape the handlers use, their fixed reply texts, the one-at-a-time guard for
 * a cancel or delete, the outcome reply and the error reply. Replies are fixed texts chosen from
 * result fields: never a service message, error text or the reason files were kept (those can
 * name paths or the download client).
 */

import { RMABLogger } from '@/lib/utils/logger';
import { errorForLog } from '@/lib/utils/zod-validation';
import type { DiscordActor } from '../discord-actor';
import type { ManageArea } from '../discord-custom-id';
import { MessageFlags, SHARED_TEXT, failQuietly, textOnly } from '../discord-format';
import { pageReply, readRequestPage } from './discord-request-list';

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
  ...SHARED_TEXT,
  notAdmin: 'Only RMAB admins can delete requests. To stop one of your own requests, use Cancel in /status or on its card.',
  notYours: 'You can cancel only your own requests.',
  staleChoice: 'That choice is no longer available. Run the command again.',
  alreadyCancelled: 'This request was already cancelled.',
  deleteFailed: 'The request could not be deleted. The RMAB logs say why.',
  cancelling: 'Cancelling…',
  deleting: 'Deleting…',
} as const;

/**
 * Runs `run` unless a run for `key` is still going in this process (a second press that lands
 * before the buttons are gone); returns false then, and nothing runs.
 */
export async function runOnce(inFlight: Set<string>, key: string, run: () => Promise<void>): Promise<boolean> {
  if (inFlight.has(key)) return false;
  inFlight.add(key);
  try {
    await run();
  } finally {
    inFlight.delete(key);
  }
  return true;
}

/**
 * Shows `notice` above the page listed for the account acting now. When that page cannot be
 * read, `notice` alone: a cancel or delete that already happened is never reported as a failure.
 */
export async function showOutcome(
  interaction: ManageInteraction,
  area: ManageArea,
  actor: DiscordActor,
  page: number,
  notice: string
): Promise<void> {
  let reply: object;
  try {
    reply = pageReply(area, actor, await readRequestPage(actor, page), notice);
  } catch (error) {
    logger.warn('Could not list the requests after a step; showing its outcome only', { area, error: errorForLog(error) });
    reply = textOnly(notice);
  }
  await interaction.editReply(reply);
}

/** Logs the failed step and shows the fixed error text; never throws. */
export function stepFailed(interaction: ManageInteraction, step: string, error: unknown): Promise<void> {
  return failQuietly(interaction, logger, 'Discord request management step failed', { step }, error);
}
