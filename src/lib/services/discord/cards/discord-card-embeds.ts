/**
 * Component: Discord Request Card and Approval Message Content
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Raw Discord API message bodies for a request's live card, its approval message and the
 * requester's decision DM. Book metadata and a fixed status label only: never paths, release
 * picks, download URLs, error text or settings. Every database text is markdown-escaped, and
 * every body says which mentions may ping (none, or only the configured admin role).
 */

import { CANCELLABLE_STATUSES } from '@/lib/constants/request-statuses';
import { coverUrl, mediaTypeLabel } from '../discord-book-embed';
import { encodeApprovalCustomId, encodeRequestActionCustomId } from '../discord-custom-id';
import { ButtonStyle, ComponentType, DISCORD_LIMITS, safeText } from '../discord-format';

/** The request fields a card reads (a narrow select; see discord-cards.ts). */
export interface CardRequest {
  id: string;
  status: string;
  type: string;
  deletedAt: Date | null;
  discordCards: unknown;
  audiobook: { title: string; author: string; narrator: string | null; coverArtUrl: string | null };
  user: { plexUsername: string; discordUserId: string | null };
}

/** Raw API allowed_mentions: nothing pings unless a role is listed. */
export interface AllowedMentions {
  parse: never[];
  roles?: string[];
}

/** A raw Discord API message body (create or edit). */
export interface MessageBody {
  content: string;
  embeds: object[];
  components: object[];
  allowed_mentions: AllowedMentions;
}

export const NO_MENTIONS_RAW: AllowedMentions = { parse: [] };

const STATUS_LABELS: Record<string, string> = {
  pending: 'Queued',
  awaiting_approval: 'Waiting for approval',
  awaiting_search: 'Waiting to search',
  awaiting_release: 'Waiting for its release date',
  awaiting_import: 'Waiting to import',
  searching: 'Searching',
  downloading: 'Downloading',
  processing: 'Processing',
  downloaded: 'Downloaded',
  available: 'Available',
  failed: 'Failed',
  warn: 'Needs attention',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

/** Embed colours (decimal RGB) by status group. */
const COLOURS = { waiting: 0xf0b232, active: 0x5865f2, done: 0x23a55a, stopped: 0xda373c, neutral: 0x80848e } as const;

function colourFor(request: CardRequest): number {
  if (request.deletedAt) return COLOURS.neutral;
  switch (request.status) {
    case 'available':
    case 'downloaded':
      return COLOURS.done;
    case 'failed':
    case 'denied':
    case 'warn':
      return COLOURS.stopped;
    case 'cancelled':
      return COLOURS.neutral;
    case 'awaiting_approval':
      return COLOURS.waiting;
    default:
      return COLOURS.active;
  }
}

/** The fixed label shown for a request's status ("Removed" once it is deleted). */
export function statusLabel(request: Pick<CardRequest, 'status' | 'deletedAt'>): string {
  if (request.deletedAt) return 'Removed';
  return STATUS_LABELS[request.status] ?? 'Unknown';
}

function field(name: string, value: string | null | undefined) {
  return { name, value: safeText(value, DISCORD_LIMITS.embedFieldValue), inline: true };
}

function bookEmbedBase(request: CardRequest, extraFields: { name: string; value: string; inline: boolean }[]) {
  const thumbnail = coverUrl(request.audiobook.coverArtUrl);
  return {
    title: safeText(request.audiobook.title, DISCORD_LIMITS.embedTitle) || 'Untitled',
    color: colourFor(request),
    fields: [field('Author', request.audiobook.author), ...extraFields, { name: 'Status', value: statusLabel(request), inline: true }]
      .filter((f) => f.value.length > 0),
    ...(thumbnail && { thumbnail: { url: thumbnail } }),
    footer: { text: `${mediaTypeLabel(request.type)} request` },
  };
}

/**
 * The Cancel button (only the requester or an RMAB admin may use it: the handler checks the
 * clicking user's account on every click).
 */
function cancelButton(requestId: string) {
  return { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Cancel request', custom_id: encodeRequestActionCustomId('status', requestId) };
}

/** True while the request can still be cancelled (not deleted, a cancellable status). */
export function canStillCancel(request: Pick<CardRequest, 'status' | 'deletedAt'>): boolean {
  return !request.deletedAt && (CANCELLABLE_STATUSES as readonly string[]).includes(request.status);
}

/** The live card (request channel and/or the requester's DMs): book and status, Cancel while it can be. */
export function requestCardBody(request: CardRequest): MessageBody {
  return {
    content: '',
    embeds: [bookEmbedBase(request, [])],
    components: canStillCancel(request) ? [{ type: ComponentType.ActionRow, components: [cancelButton(request.id)] }] : [],
    allowed_mentions: NO_MENTIONS_RAW,
  };
}

/** The approval message in the admin channel: pings the admin role when one is set. */
export function approvalBody(request: CardRequest, adminRoleId: string): MessageBody {
  const ping = adminRoleId ? `<@&${adminRoleId}> ` : '';
  return {
    content: `${ping}A request needs approval.`,
    embeds: [bookEmbedBase(request, [field('Narrator', request.audiobook.narrator), field('Requested by', request.user.plexUsername)])],
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, style: ButtonStyle.Success, label: 'Approve', custom_id: encodeApprovalCustomId('approve', request.id) },
          { type: ComponentType.Button, style: ButtonStyle.Danger, label: 'Deny', custom_id: encodeApprovalCustomId('deny', request.id) },
          cancelButton(request.id),
        ],
      },
    ],
    allowed_mentions: adminRoleId ? { parse: [], roles: [adminRoleId] } : NO_MENTIONS_RAW,
  };
}

/** The approval message once it is no longer waiting: buttons gone, current status shown. */
export function decidedApprovalBody(request: CardRequest, decision?: 'approved' | 'denied'): MessageBody {
  let content = 'No longer waiting for approval.';
  if (request.deletedAt) content = 'This request was removed.';
  else if (request.status === 'cancelled') content = 'Cancelled.';
  else if (decision === 'approved') content = 'Approved.';
  else if (decision === 'denied' || request.status === 'denied') content = 'Denied.';
  return {
    content,
    embeds: [bookEmbedBase(request, [field('Requested by', request.user.plexUsername)])],
    components: [],
    allowed_mentions: NO_MENTIONS_RAW,
  };
}

/** The DM a requester gets when an admin decides their request. */
export function decisionDmBody(request: CardRequest, decision: 'approved' | 'denied'): MessageBody {
  const title = safeText(request.audiobook.title, 200) || 'Untitled';
  const outcome = decision === 'approved' ? 'was approved' : 'was denied';
  return {
    content: `Your ${mediaTypeLabel(request.type).toLowerCase()} request for **${title}** ${outcome}.`,
    embeds: [],
    components: [],
    allowed_mentions: NO_MENTIONS_RAW,
  };
}
