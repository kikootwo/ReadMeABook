/**
 * Component: Discord /delete (RMAB admins only)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * `/delete` lists every user's requests with page buttons and a menu; choosing one shows a
 * confirmation with Delete. The command, every page, the menu and the confirm each acknowledge
 * Discord first, then resolve the clicking user to an RMAB account (no cache) and require an RMAB
 * admin (database role): an admin demoted after opening the list is refused at the next step.
 * Discord's Administrator permission on the command only hides it. The delete runs the shared
 * delete service as that admin, exactly as the web admin delete does; the reply is a fixed text
 * chosen from the result fields (never its message, error or the reason files were kept).
 */

import { deleteRequest, type DeleteRequestResult } from '@/lib/services/request-delete.service';
import { RMABLogger } from '@/lib/utils/logger';
import { resolveDiscordActor, type DiscordActor } from '../discord-actor';
import { decodeManageCustomId, isRequestId } from '../discord-custom-id';
import { textOnly } from '../discord-format';
import { EPHEMERAL, MANAGE_TEXT, failQuietly, type ManageInteraction } from './discord-manage-common';
import { deleteConfirmReply, pageReply, readListedRequest, readRequestPage } from './discord-request-list';

const logger = RMABLogger.create('Discord.Delete');

/** The fixed reply for a delete result, built from its counts and flags only. */
export function deleteReplyText(result: DeleteRequestResult): string {
  if (!result.success) return result.error === 'NotFound' ? MANAGE_TEXT.notFound : MANAGE_TEXT.deleteFailed;
  const parts = ['Request deleted.'];
  if (result.filesDeleted) parts.push('Its library files were removed.');
  if (result.filesKeptReason) parts.push('Its library files were kept.');
  if (result.folderKept) parts.push('Its book folder stays: it still holds other files.');
  if (result.torrentsRemoved > 0) parts.push('Its download was removed from the download client.');
  if (result.torrentsKeptSeeding > 0 || result.torrentsKeptUnlimited > 0) parts.push('Its download stays in the download client to seed.');
  if (result.torrentsKeptShared > 0 || result.torrentsKeptNotOwned > 0) parts.push('Its download stays in the download client.');
  return parts.join(' ');
}

/** The acting RMAB admin, or null after showing the refusal. */
async function requireAdmin(interaction: ManageInteraction, step: string): Promise<DiscordActor | null> {
  const actor = await resolveDiscordActor(interaction.user.id);
  if (!actor) {
    await interaction.editReply(textOnly(MANAGE_TEXT.notLinked));
    return null;
  }
  if (!actor.isAdmin) {
    logger.info('Refused a Discord /delete step from a non-admin account', { userId: actor.userId, step });
    await interaction.editReply(textOnly(MANAGE_TEXT.notAdmin));
    return null;
  }
  return actor;
}

/** Slash command `/delete`. */
export async function handleDeleteCommand(interaction: ManageInteraction): Promise<void> {
  if (interaction.guildId === null || !interaction.isChatInputCommand()) return;
  try {
    await interaction.deferReply(EPHEMERAL);
    const actor = await requireAdmin(interaction, 'command');
    if (!actor) return;
    await interaction.editReply(pageReply('delete', actor, await readRequestPage(actor, 0)));
  } catch (error) {
    await failQuietly(interaction, 'delete', error);
  }
}

/** /delete page buttons, the menu and the confirm (custom_id `rmab:del:`), in the server only. */
export async function handleDeleteComponent(interaction: ManageInteraction): Promise<void> {
  if (interaction.guildId === null) return;
  const id = decodeManageCustomId(interaction.customId);
  if (!id || id.area !== 'delete') {
    logger.debug('Ignored a /delete interaction with an unknown custom id');
    return;
  }
  const kindMatches = id.action === 'menu' ? interaction.isStringSelectMenu() : interaction.isButton();
  if (!kindMatches) {
    logger.debug('Ignored a /delete interaction whose kind does not match its custom id', { action: id.action });
    return;
  }

  try {
    await interaction.deferUpdate();
    const actor = await requireAdmin(interaction, id.action);
    if (!actor) return;

    if (id.action === 'page') {
      await interaction.editReply(pageReply('delete', actor, await readRequestPage(actor, id.page)));
      return;
    }

    if (id.action !== 'confirm') {
      const requestId = interaction.values?.[0];
      const row = isRequestId(requestId) ? await readListedRequest(requestId) : null;
      if (!row) {
        const notice = isRequestId(requestId) ? MANAGE_TEXT.notFound : MANAGE_TEXT.staleChoice;
        await interaction.editReply(pageReply('delete', actor, await readRequestPage(actor, id.page), notice));
        return;
      }
      await interaction.editReply(deleteConfirmReply(row));
      return;
    }

    const result = await deleteRequest(id.requestId, actor.userId);
    logger.info('Discord delete', { userId: actor.userId, requestId: id.requestId, success: result.success });
    await interaction.editReply(pageReply('delete', actor, await readRequestPage(actor, 0), deleteReplyText(result)));
  } catch (error) {
    await failQuietly(interaction, `delete ${id.action}`, error);
  }
}
