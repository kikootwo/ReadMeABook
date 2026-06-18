/**
 * Component: Discord /status & /delete List Builders
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Paginated rich-embed lists for /status and /delete, their request-select dropdowns, and the
 * post-delete confirmation embed. Per-request field rendering goes through the shared addBookFields
 * so list rows match the confirm/request/approval cards.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { encodeCustomId } from '../custom-id';
import {
  COLOR,
  MAX_SELECT_OPTIONS,
  type RequestListItem,
  addBookFields,
  colorForStatus,
  infoEmbed,
  isCancellableStatus,
  listItemToBookFields,
  requestStatusFooter,
  titleWithYear,
  truncate,
  typeLabel,
} from './book-fields';

const ITEMS_PER_PAGE = 10;

/** One rich embed for a request row, sharing the book-field rendering with the request cards. */
function buildItemEmbed(item: RequestListItem): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(colorForStatus(item.status))
    .setTitle(titleWithYear(item.title, item.year));
  addBookFields(embed, listItemToBookFields(item));
  if (item.requestedBy) {
    embed.addFields({ name: 'Requested By', value: item.requestedBy, inline: true });
  }
  if (item.coverArtUrl) embed.setThumbnail(item.coverArtUrl);
  embed.setFooter({ text: requestStatusFooter(item.status) });
  return embed;
}

/**
 * Build a request-select dropdown (option values are request IDs). Shared by the /status cancel
 * menu and the /delete menu — they differ only in customId, placeholder, and the option description.
 * Returns null when there are no items to offer.
 */
function buildRequestSelect(
  items: RequestListItem[],
  opts: { customId: string; placeholder: string; describe: (item: RequestListItem) => string }
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (items.length === 0) return null;

  const options = items.slice(0, MAX_SELECT_OPTIONS).map((item) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(truncate(item.title, 100))
      .setDescription(truncate(opts.describe(item), 100))
      .setValue(item.id)
  );

  const menu = new StringSelectMenuBuilder()
    .setCustomId(opts.customId)
    .setPlaceholder(opts.placeholder)
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu);
}

function buildPaginationRow(
  kind: 'status_page' | 'delete_page',
  page: number,
  totalPages: number,
  scopeAll: boolean
): ActionRowBuilder<ButtonBuilder> {
  const prev = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind, page: page - 1, scopeAll }))
    .setLabel('Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page === 0);
  const indicator = new ButtonBuilder()
    .setCustomId(`page_indicator_${kind}`)
    .setLabel(`Page ${page + 1} / ${totalPages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);
  const next = new ButtonBuilder()
    .setCustomId(encodeCustomId({ kind, page: page + 1, scopeAll }))
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(page >= totalPages - 1);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(prev, indicator, next);
}

function buildStatusCancelSelect(
  pageItems: RequestListItem[],
  page: number,
  scopeAll: boolean
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const cancellable = pageItems.filter((item) => isCancellableStatus(item.status));
  return buildRequestSelect(cancellable, {
    customId: encodeCustomId({ kind: 'status_cancel', page, scopeAll }),
    placeholder: 'Cancel a request…',
    describe: (item) => `${typeLabel(item.type)} • ${requestStatusFooter(item.status)} • ${item.author}`,
  });
}

/**
 * Build the /delete select menu (option values are request IDs). Returns null if no deletable items.
 */
export function buildDeleteSelect(
  items: RequestListItem[]
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  return buildRequestSelect(items, {
    customId: encodeCustomId({ kind: 'delete_select' }),
    placeholder: 'Select a request to delete…',
    describe: (item) => `${typeLabel(item.type)} • ${item.status} • ${item.author}`,
  });
}

/**
 * Build a paginated /status reply: up to 10 rich embeds per page, a cancel select dropdown for
 * cancellable items, and Previous/Next buttons.
 */
export function buildStatusPage(
  items: RequestListItem[],
  scopeAll: boolean,
  page: number
): {
  embeds: EmbedBuilder[];
  components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[];
} {
  if (items.length === 0) {
    const empty = new EmbedBuilder()
      .setColor(COLOR.brand)
      .setTitle(scopeAll ? '📋 All outstanding requests' : '📋 Your outstanding requests')
      .setDescription('No outstanding requests.');
    return { embeds: [empty], components: [] };
  }

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = items.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  const header = new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle(scopeAll ? '📋 All outstanding requests' : '📋 Your outstanding requests')
    .setDescription(`Showing ${items.length} request${items.length === 1 ? '' : 's'}`);

  const embeds = [header, ...pageItems.map(buildItemEmbed)];

  const components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] = [];
  const cancelRow = buildStatusCancelSelect(pageItems, safePage, scopeAll);
  if (cancelRow) components.push(cancelRow);
  if (totalPages > 1) components.push(buildPaginationRow('status_page', safePage, totalPages, scopeAll));

  return { embeds, components };
}

/**
 * Build a paginated /delete reply: rich embeds for each request on the current page, plus the
 * select dropdown and optional pagination buttons.
 */
export function buildDeletePage(
  items: RequestListItem[],
  scopeAll: boolean,
  page: number
): {
  embeds: EmbedBuilder[];
  components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[];
} {
  if (items.length === 0) {
    return {
      embeds: [infoEmbed('Nothing to delete', 'You have no requests to delete.')],
      components: [],
    };
  }

  const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const pageItems = items.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);

  const header = new EmbedBuilder()
    .setColor(COLOR.brand)
    .setTitle(scopeAll ? '🗑️ Delete a request' : '🗑️ Delete one of your requests')
    .setDescription('Select a request below to remove it from ReadMeABook.');

  const embeds = [header, ...pageItems.map(buildItemEmbed)];

  const selectRow = buildDeleteSelect(pageItems);
  const components: (ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>)[] = [];
  if (selectRow) components.push(selectRow);
  if (totalPages > 1) components.push(buildPaginationRow('delete_page', safePage, totalPages, scopeAll));

  return { embeds, components };
}

/** Build a rich confirmation embed after a successful /delete. */
export function buildDeleteConfirmEmbed(item: RequestListItem): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(COLOR.success)
    .setTitle(titleWithYear(item.title, item.year));
  addBookFields(embed, listItemToBookFields(item));
  if (item.coverArtUrl) embed.setThumbnail(item.coverArtUrl);
  embed.setFooter({ text: '🗑️ Request Deleted' }).setTimestamp(new Date());
  return embed;
}
