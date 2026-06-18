/**
 * Component: Discord Interaction Custom IDs
 * Documentation: documentation/integrations/discord-bot.md
 *
 * All cross-interaction state is encoded into Discord component customIds (max 100 chars) rather
 * than a server-side session map, so flows survive process restarts and never leak memory. ASINs
 * (10 chars) and request UUIDs contain no ':' separator, making the colon-delimited scheme safe.
 */

export type MediaType = 'audiobook' | 'ebook';

export type DiscordCustomId =
  /** Search-term modal opened by /request <type>. */
  | { kind: 'request_modal'; mediaType: MediaType }
  /** Result dropdown after a search; option values are ASINs. */
  | { kind: 'request_select'; mediaType: MediaType }
  /** Confirm button on the selected title. */
  | { kind: 'request_confirm'; mediaType: MediaType; asin: string }
  /** Cancel button (any flow). */
  | { kind: 'cancel' }
  /** Request dropdown for /delete; option values are request IDs. */
  | { kind: 'delete_select' }
  /** Confirm button on the /delete preview; commits the deletion of the selected request. */
  | { kind: 'delete_confirm'; requestId: string }
  /** Cancel button on the /delete preview; dismisses without deleting. */
  | { kind: 'delete_cancel' }
  /** Approve/Deny buttons on an admin approval message. */
  | { kind: 'approval'; action: 'approve' | 'deny'; requestId: string }
  /** Cancel Request button on a live request card (requester or admin). */
  | { kind: 'cancel_request'; requestId: string }
  /** Pagination buttons on /status. */
  | { kind: 'status_page'; page: number; scopeAll: boolean }
  /** Cancel-from-status select menu; option values are request IDs. */
  | { kind: 'status_cancel'; page: number; scopeAll: boolean }
  /** Pagination buttons on /delete. */
  | { kind: 'delete_page'; page: number; scopeAll: boolean };

const PREFIX = {
  request_modal: 'req:modal',
  request_select: 'req:sel',
  request_confirm: 'req:cf',
  cancel: 'req:cancel',
  delete_select: 'del:sel',
  delete_confirm: 'del:cf',
  delete_cancel: 'del:cx',
  approval: 'appr',
  cancel_request: 'crq',
  status_page: 'st:pg',
  status_cancel: 'st:cx',
  delete_page: 'del:pg',
} as const;

/** Encode a structured custom ID into a Discord-safe string (≤100 chars). */
export function encodeCustomId(id: DiscordCustomId): string {
  switch (id.kind) {
    case 'request_modal':
      return `${PREFIX.request_modal}:${id.mediaType}`;
    case 'request_select':
      return `${PREFIX.request_select}:${id.mediaType}`;
    case 'request_confirm':
      return `${PREFIX.request_confirm}:${id.mediaType}:${id.asin}`;
    case 'cancel':
      return PREFIX.cancel;
    case 'delete_select':
      return PREFIX.delete_select;
    case 'delete_confirm':
      return `${PREFIX.delete_confirm}:${id.requestId}`;
    case 'delete_cancel':
      return PREFIX.delete_cancel;
    case 'approval':
      return `${PREFIX.approval}:${id.action}:${id.requestId}`;
    case 'cancel_request':
      return `${PREFIX.cancel_request}:${id.requestId}`;
    case 'status_page':
      return `${PREFIX.status_page}:${id.page}:${id.scopeAll ? '1' : '0'}`;
    case 'status_cancel':
      return `${PREFIX.status_cancel}:${id.page}:${id.scopeAll ? '1' : '0'}`;
    case 'delete_page':
      return `${PREFIX.delete_page}:${id.page}:${id.scopeAll ? '1' : '0'}`;
  }
}

function asMediaType(value: string | undefined): MediaType | null {
  return value === 'audiobook' || value === 'ebook' ? value : null;
}

/**
 * Parse a pagination page segment to a non-negative integer, or null if malformed. Guards against
 * Number('') === 0 (a missing segment) and crafted negative/fractional values from tampered customIds.
 */
function parsePage(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const page = Number(value);
  return Number.isInteger(page) && page >= 0 ? page : null;
}

/** Decode a Discord custom ID back into a structured value, or null if unrecognized. */
export function decodeCustomId(raw: string): DiscordCustomId | null {
  if (raw === PREFIX.cancel) return { kind: 'cancel' };
  if (raw === PREFIX.delete_select) return { kind: 'delete_select' };
  if (raw === PREFIX.delete_cancel) return { kind: 'delete_cancel' };

  const parts = raw.split(':');

  // del:cf:<requestId>
  if (raw.startsWith(`${PREFIX.delete_confirm}:`)) {
    const requestId = parts.slice(2).join(':'); // UUIDs have no ':', but be defensive
    return requestId ? { kind: 'delete_confirm', requestId } : null;
  }

  // req:modal:<type>
  if (raw.startsWith(`${PREFIX.request_modal}:`)) {
    const mediaType = asMediaType(parts[2]);
    return mediaType ? { kind: 'request_modal', mediaType } : null;
  }

  // req:sel:<type>
  if (raw.startsWith(`${PREFIX.request_select}:`)) {
    const mediaType = asMediaType(parts[2]);
    return mediaType ? { kind: 'request_select', mediaType } : null;
  }

  // req:cf:<type>:<asin>
  if (raw.startsWith(`${PREFIX.request_confirm}:`)) {
    const mediaType = asMediaType(parts[2]);
    const asin = parts[3];
    return mediaType && asin ? { kind: 'request_confirm', mediaType, asin } : null;
  }

  // appr:<action>:<requestId>
  if (raw.startsWith(`${PREFIX.approval}:`)) {
    const action = parts[1];
    const requestId = parts.slice(2).join(':'); // UUIDs have no ':', but be defensive
    if ((action === 'approve' || action === 'deny') && requestId) {
      return { kind: 'approval', action, requestId };
    }
    return null;
  }

  // crq:<requestId>
  if (raw.startsWith(`${PREFIX.cancel_request}:`)) {
    const requestId = parts.slice(1).join(':');
    return requestId ? { kind: 'cancel_request', requestId } : null;
  }

  // st:pg:<page>:<scopeAll>
  if (raw.startsWith(`${PREFIX.status_page}:`)) {
    const page = parsePage(parts[2]);
    const scopeAll = parts[3] === '1';
    return page !== null ? { kind: 'status_page', page, scopeAll } : null;
  }

  // st:cx:<page>:<scopeAll>
  if (raw.startsWith(`${PREFIX.status_cancel}:`)) {
    const page = parsePage(parts[2]);
    const scopeAll = parts[3] === '1';
    return page !== null ? { kind: 'status_cancel', page, scopeAll } : null;
  }

  // del:pg:<page>:<scopeAll>
  if (raw.startsWith(`${PREFIX.delete_page}:`)) {
    const page = parsePage(parts[2]);
    const scopeAll = parts[3] === '1';
    return page !== null ? { kind: 'delete_page', page, scopeAll } : null;
  }

  return null;
}
