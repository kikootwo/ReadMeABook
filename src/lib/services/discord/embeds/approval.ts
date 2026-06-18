/**
 * Component: Discord Approval Embed Builders
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The admin approval message (rich embed + Approve/Deny buttons) and the in-place rewrites applied
 * after a decision or a pre-decision cancellation.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type Embed,
} from 'discord.js';
import { encodeCustomId } from '../custom-id';
import { COLOR, addBookFields, titleWithYear } from './book-fields';

/**
 * Build the admin approval message: a rich embed plus Approve/Deny buttons. Content (the role
 * ping) is supplied separately by the caller.
 */
export function buildApprovalMessage(params: {
  requestId: string;
  title: string;
  author: string;
  mediaType: string;
  requestedBy: string;
  narrator?: string | null;
  durationMinutes?: number | null;
  year?: number | null;
  series?: string | null;
  seriesPart?: string | null;
  formatType?: string | null;
  genres?: string[] | null;
  coverArtUrl?: string | null;
}): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const embed = new EmbedBuilder()
    .setColor(COLOR.info)
    .setTitle('📥 New Request — ⏳ Pending')
    .addFields({ name: 'Title', value: titleWithYear(params.title, params.year), inline: false });

  addBookFields(embed, {
    title: params.title,
    author: params.author,
    mediaType: params.mediaType,
    narrator: params.narrator,
    durationMinutes: params.durationMinutes,
    year: params.year,
    series: params.series,
    seriesPart: params.seriesPart,
    formatType: params.formatType,
    genres: params.genres,
  });

  embed
    .addFields({ name: 'Requested By', value: params.requestedBy, inline: true })
    .setFooter({ text: `Request ID: ${params.requestId}` })
    .setTimestamp(new Date());

  if (params.coverArtUrl) embed.setThumbnail(params.coverArtUrl);

  const approve = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'approval', action: 'approve', requestId: params.requestId }))
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success);
  const deny = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind: 'approval', action: 'deny', requestId: params.requestId }))
    .setLabel('Deny')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approve, deny);
  return { embed, row };
}

/**
 * Re-render an admin approval embed after a decision: update the title/color to reflect who
 * approved/denied it, preserving the book detail fields.
 */
export function applyApprovalDecision(
  existing: Embed,
  action: 'approve' | 'deny',
  decidedByDiscordId: string
): EmbedBuilder {
  const approved = action === 'approve';
  // Mentions don't render in embed titles, so the acting user goes in a field value as <@id>.
  return EmbedBuilder.from(existing)
    .setColor(approved ? COLOR.success : COLOR.error)
    .setTitle(approved ? '✅ Request Approved' : '🚫 Request Denied')
    .addFields({
      name: approved ? 'Approved by' : 'Denied by',
      value: `<@${decidedByDiscordId}>`,
      inline: true,
    });
}

/**
 * Re-render an admin approval embed after the request was cancelled (by the requester or an admin)
 * before any decision was made. Notes who cancelled it (as an @mention); the caller removes the
 * Approve/Deny buttons but leaves the embed in place for reference.
 */
export function applyApprovalCancellation(existing: Embed, cancelledByDiscordId: string): EmbedBuilder {
  return EmbedBuilder.from(existing)
    .setColor(COLOR.error)
    .setTitle('🚫 Request Cancelled')
    .addFields({ name: 'Cancelled by', value: `<@${cancelledByDiscordId}>`, inline: true });
}
