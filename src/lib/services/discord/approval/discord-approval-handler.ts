/**
 * Component: Discord Approve / Deny Buttons
 * Documentation: documentation/integrations/discord-bot.md
 *
 * A click on an approval message: acknowledge (ephemeral defer) first, then resolve the
 * clicking Discord user to an RMAB account on every click (no cache) and require an RMAB
 * admin (database role). Holding the admin role in Discord grants nothing: it is only pinged.
 * Then the shared approval service decides, exactly as the web route does. The clicker gets a
 * fixed reply chosen from the result code; a click on a request that is no longer waiting
 * shows its current status and brings the message up to date.
 */

import { decideRequestApproval, type ApprovalResult } from '@/lib/services/request-approval.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveDiscordActor } from '../discord-actor';
import { decodeApprovalCustomId } from '../discord-custom-id';
import { MessageFlags, SHARED_TEXT, failQuietly, textOnly } from '../discord-format';
import { refreshDiscordRequestCards } from '../discord-runtime';
import { statusLabel } from '../cards/discord-card-embeds';

const logger = RMABLogger.create('Discord.Approval');

/** The parts of a discord.js button interaction this handler uses. */
export interface ApprovalInteraction {
  guildId: string | null;
  user: { id: string };
  customId?: string;
  deferred?: boolean;
  replied?: boolean;
  isButton(): boolean;
  deferReply(options: object): Promise<unknown>;
  reply(options: object): Promise<unknown>;
  editReply(options: object): Promise<unknown>;
}

export const APPROVAL_TEXT = {
  ...SHARED_TEXT,
  notAdmin: 'Only RMAB admins can approve or deny requests.',
  sourceUnavailable: 'The release source could not be reached. Nothing was changed; try again in a moment.',
  denied: 'Denied.',
} as const;

/** The fixed reply for a decision result (never a service message or error text). */
export function approvalReplyText(result: ApprovalResult): string {
  if (result.ok && result.action === 'deny') return APPROVAL_TEXT.denied;
  if (result.ok) {
    if (result.droppedPickReason) return 'Approved. The stored release could not be used, so the search has started instead.';
    if (result.status === 'downloading') return 'Approved. The download has started.';
    if (result.status === 'awaiting_release') return 'Approved. It will be searched on its release date.';
    return 'Approved. The search has started.';
  }
  switch (result.code) {
    case 'not_found':
      return APPROVAL_TEXT.notFound;
    case 'invalid_status':
      return `This request is no longer waiting for approval. Status: ${statusLabel({ status: result.currentStatus, deletedAt: null })}.`;
    case 'source_unavailable':
      return APPROVAL_TEXT.sourceUnavailable;
    default:
      return APPROVAL_TEXT.generic;
  }
}

export async function handleApprovalComponent(interaction: ApprovalInteraction): Promise<void> {
  // Approval messages live in the admin channel; a DM click has nothing to decide
  if (interaction.guildId === null || !interaction.isButton()) return;
  const id = decodeApprovalCustomId(interaction.customId);
  if (!id) {
    logger.debug('Ignored an approval interaction with an unknown custom id');
    return;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const actor = await resolveDiscordActor(interaction.user.id);
    if (!actor) {
      await interaction.editReply(textOnly(APPROVAL_TEXT.notLinked));
      return;
    }
    if (!actor.isAdmin) {
      logger.info('Refused a Discord approval click from a non-admin account', { userId: actor.userId, requestId: id.requestId });
      await interaction.editReply(textOnly(APPROVAL_TEXT.notAdmin));
      return;
    }

    const result = await decideRequestApproval({ requestId: id.requestId, action: id.action, adminId: actor.userId, via: 'discord' });
    await interaction.editReply(textOnly(approvalReplyText(result)));
    // A stale message (decided elsewhere, completed, removed): show the current state on it too
    if (!result.ok && (result.code === 'invalid_status' || result.code === 'not_found')) {
      refreshDiscordRequestCards(id.requestId);
    }
  } catch (error) {
    await failQuietly(interaction, logger, 'Discord approval click failed', { requestId: id.requestId }, error);
  }
}
