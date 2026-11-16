/**
 * Component: Discord Request Lists (/status and /delete pages)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Reads one page of requests and builds its reply: an embed listing them, a menu (Cancel on
 * /status, only for requests that can still be cancelled; Delete on /delete), page buttons, and
 * the cancel and /delete confirmations. Whose requests a page lists comes from the account acting now (an
 * RMAB admin's database role shows every user's), never from the custom_id. Deleted requests
 * are never listed. Embed text from the database is markdown-escaped; menu text is plain
 * (Discord shows it as written) and only cut to Discord's limits. No paths, release picks,
 * URLs or error text are read.
 */

import { prisma } from '@/lib/db';
import { isCancellableStatus } from '@/lib/constants/request-statuses';
import { cancelConfirmText } from '@/lib/utils/cancel-confirm-text';
import type { DiscordActor } from '../discord-actor';
import { mediaTypeLabel } from '../discord-book-embed';
import { MAX_PAGE, encodeCancelConfirmCustomId, encodePageCustomId, encodeRequestActionCustomId, type ManageArea } from '../discord-custom-id';
import { ButtonStyle, ComponentType, DISCORD_LIMITS, NO_MENTIONS, clip, safeText } from '../discord-format';
import { cancelLabel, statusLabel } from '../cards/discord-card-embeds';

/** Requests per page (Discord allows 25 menu options). */
export const PAGE_SIZE = 10;

/** Only these fields are read for a list or a confirmation. */
const LIST_SELECT = {
  id: true,
  status: true,
  type: true,
  userId: true,
  audiobook: { select: { title: true, author: true } },
  user: { select: { plexUsername: true } },
} as const;

export interface ListedRequest {
  id: string;
  status: string;
  type: string;
  userId: string;
  audiobook: { title: string; author: string };
  user: { plexUsername: string };
}

export interface RequestPage {
  page: number;
  rows: ListedRequest[];
  hasNext: boolean;
}

/** Live requests the actor may see: their own, or every user's for an RMAB admin. */
export function listWhere(actor: DiscordActor) {
  return actor.isAdmin ? { deletedAt: null } : { deletedAt: null, userId: actor.userId };
}

/** One page, newest first. */
export async function readRequestPage(actor: DiscordActor, page: number): Promise<RequestPage> {
  const rows = await prisma.request.findMany({
    where: listWhere(actor),
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: page * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    select: LIST_SELECT,
  });
  return { page, rows: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE };
}

/** One live request with the list fields (null when missing or deleted). */
export function readListedRequest(requestId: string): Promise<ListedRequest | null> {
  return prisma.request.findFirst({ where: { id: requestId, deletedAt: null }, select: LIST_SELECT });
}

const COLOUR = { status: 0x5865f2, delete: 0xda373c } as const;

function listTitle(area: ManageArea, actor: DiscordActor): string {
  if (area === 'delete') return 'Delete a request';
  return actor.isAdmin ? 'All requests' : 'Your requests';
}

function listLine(row: ListedRequest, position: number, showRequester: boolean): string {
  const title = safeText(row.audiobook.title, 80) || 'Untitled';
  const author = safeText(row.audiobook.author, 60);
  const parts = [
    `**${position}.** ${title}${author ? ` by ${author}` : ''}`,
    mediaTypeLabel(row.type),
    statusLabel({ status: row.status, deletedAt: null }),
    ...(showRequester ? [safeText(row.user.plexUsername, 40)] : []),
  ];
  return parts.filter(Boolean).join(' · ');
}

function menuOption(row: ListedRequest, showRequester: boolean) {
  const description = [mediaTypeLabel(row.type), statusLabel({ status: row.status, deletedAt: null }), ...(showRequester ? [row.user.plexUsername] : [])];
  return {
    label: clip(row.audiobook.title, DISCORD_LIMITS.selectLabel) || 'Untitled',
    value: row.id,
    description: clip(description.join(' · '), DISCORD_LIMITS.selectDescription),
  };
}

function navRow(area: ManageArea, page: number, hasNext: boolean) {
  return {
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: 'Previous',
        custom_id: encodePageCustomId(area, 'page', Math.max(0, page - 1)),
        disabled: page === 0,
      },
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: 'Next',
        custom_id: encodePageCustomId(area, 'page', Math.min(MAX_PAGE, page + 1)),
        disabled: !hasNext || page >= MAX_PAGE,
      },
    ],
  };
}

/**
 * The reply for a page: `notice` (a fixed text, e.g. the outcome of a cancel or delete) above
 * the list. /status offers Cancel only for requests that can still be cancelled.
 */
export function pageReply(area: ManageArea, actor: DiscordActor, { page, rows, hasNext }: RequestPage, notice = '') {
  const showRequester = actor.isAdmin;
  const lines = rows.map((row, n) => listLine(row, page * PAGE_SIZE + n + 1, showRequester));
  const empty = page > 0 ? 'No requests on this page.' : 'No requests yet.';
  const menuRows = area === 'status' ? rows.filter((row) => isCancellableStatus(row.status)) : rows;
  const components: object[] = [];
  if (menuRows.length > 0) {
    components.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: encodePageCustomId(area, 'menu', page),
          placeholder: area === 'status' ? 'Cancel a request' : 'Choose a request to delete',
          options: menuRows.map((row) => menuOption(row, showRequester)),
        },
      ],
    });
  }
  if (page > 0 || hasNext) components.push(navRow(area, page, hasNext));

  return {
    content: notice,
    embeds: [
      {
        title: listTitle(area, actor),
        description: lines.join('\n') || empty,
        color: COLOUR[area],
        footer: { text: `Page ${page + 1}` },
      },
    ],
    components,
    allowedMentions: NO_MENTIONS,
  };
}

/** A confirmation: the question, the request, and its two buttons. */
function confirmReply(content: string, row: ListedRequest, colour: number, buttons: object[]) {
  return {
    content,
    embeds: [
      {
        title: safeText(row.audiobook.title, DISCORD_LIMITS.embedTitle) || 'Untitled',
        color: colour,
        fields: [
          { name: 'Author', value: safeText(row.audiobook.author, DISCORD_LIMITS.embedFieldValue) || 'Unknown', inline: true },
          { name: 'Status', value: statusLabel({ status: row.status, deletedAt: null }), inline: true },
          { name: 'Requested by', value: safeText(row.user.plexUsername, DISCORD_LIMITS.embedFieldValue) || 'Unknown', inline: true },
        ],
        footer: { text: `${mediaTypeLabel(row.type)} request` },
      },
    ],
    components: [{ type: ComponentType.ActionRow, components: buttons }],
    allowedMentions: NO_MENTIONS,
  };
}

/** The /delete confirmation for one request: Delete, or back to the first page. */
export function deleteConfirmReply(row: ListedRequest) {
  return confirmReply(
    'Delete this request? RMAB removes its download and its library files as a delete on the web does. This cannot be undone.',
    row,
    COLOUR.delete,
    [
      { type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Delete', custom_id: encodeRequestActionCustomId('delete', row.id) },
      { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Back', custom_id: encodePageCustomId('delete', 'page', 0) },
    ]
  );
}

/**
 * The cancel confirmation, worded as the web's: a request awaiting approval is withdrawn.
 * Keep request lists `backPage` of /status again and changes nothing.
 */
export function cancelConfirmReply(row: ListedRequest, actor: DiscordActor, backPage: number) {
  const content = row.status === 'awaiting_approval'
    ? `This request is pending admin approval and will be withdrawn. ${row.userId === actor.userId ? 'You' : 'The user'} can request it again later.`
    : `Cancel this request? ${cancelConfirmText(row.status, row.type)}`;
  return confirmReply(content, row, COLOUR.delete, [
    { type: ComponentType.Button, style: ButtonStyle.Danger, label: cancelLabel(row.status), custom_id: encodeCancelConfirmCustomId(row.id) },
    { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Keep request', custom_id: encodePageCustomId('status', 'page', backPage) },
  ]);
}
