/**
 * Component: Discord Interaction Router
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Single entry point for every gateway interaction. Dispatches chat-input commands, modal submits,
 * select menus, and buttons to their handlers based on command name / decoded customId. Each branch
 * acknowledges within Discord's 3-second window (the handlers defer immediately).
 */

import type { Interaction } from 'discord.js';
import { RMABLogger } from '@/lib/utils/logger';
import { decodeCustomId, type MediaType } from './custom-id';
import {
  handleRequestCommand,
  handleRequestModal,
  handleRequestSelect,
  handleRequestConfirm,
} from './handlers/request.handler';
import {
  handleStatusCommand,
  handleStatusPage,
  handleStatusCancel,
  handleDeleteCommand,
  handleDeletePage,
  handleDeleteSelect,
  handleDeleteConfirm,
  handleDeleteCancel,
} from './handlers/status-delete.handler';
import { handleApprovalButton, handleCancelRequestButton } from './handlers/approval.handler';
import { infoEmbed } from './embeds';

const logger = RMABLogger.create('Discord.Router');

export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      switch (interaction.commandName) {
        case 'request': {
          const mediaType = interaction.options.getString('type', true) as MediaType;
          await handleRequestCommand(interaction, mediaType);
          return;
        }
        case 'status':
          await handleStatusCommand(interaction);
          return;
        case 'delete':
          await handleDeleteCommand(interaction);
          return;
        default:
          return;
      }
    }

    // Search-term modal submit
    if (interaction.isModalSubmit()) {
      const decoded = decodeCustomId(interaction.customId);
      if (decoded?.kind === 'request_modal') {
        await handleRequestModal(interaction, decoded.mediaType);
      }
      return;
    }

    // Select menus
    if (interaction.isStringSelectMenu()) {
      const decoded = decodeCustomId(interaction.customId);
      if (decoded?.kind === 'request_select') {
        await handleRequestSelect(interaction, decoded.mediaType);
      } else if (decoded?.kind === 'status_cancel') {
        await handleStatusCancel(interaction, decoded.page, decoded.scopeAll);
      } else if (decoded?.kind === 'delete_select') {
        await handleDeleteSelect(interaction);
      }
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      const decoded = decodeCustomId(interaction.customId);
      if (!decoded) return;

      if (decoded.kind === 'request_confirm') {
        await handleRequestConfirm(interaction, decoded.mediaType, decoded.asin);
      } else if (decoded.kind === 'cancel') {
        await interaction.update({ embeds: [infoEmbed('Cancelled', 'Request cancelled.')], components: [] }).catch(() => undefined);
      } else if (decoded.kind === 'approval') {
        await handleApprovalButton(interaction, decoded.action, decoded.requestId);
      } else if (decoded.kind === 'cancel_request') {
        await handleCancelRequestButton(interaction, decoded.requestId);
      } else if (decoded.kind === 'status_page') {
        await handleStatusPage(interaction, decoded.page, decoded.scopeAll);
      } else if (decoded.kind === 'delete_page') {
        await handleDeletePage(interaction, decoded.page, decoded.scopeAll);
      } else if (decoded.kind === 'delete_confirm') {
        await handleDeleteConfirm(interaction, decoded.requestId);
      } else if (decoded.kind === 'delete_cancel') {
        await handleDeleteCancel(interaction);
      }
      return;
    }
  } catch (error) {
    logger.error('Unhandled interaction error', {
      error: error instanceof Error ? error.message : String(error),
      type: interaction.type,
    });
  }
}
