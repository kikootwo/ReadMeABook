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
  /** Search-term modal opened by /checkout <type>. */
  | { kind: 'checkout_modal'; mediaType: MediaType }
  /** Result dropdown after a search; option values are ASINs. */
  | { kind: 'checkout_select'; mediaType: MediaType }
  /** Confirm button on the selected title. */
  | { kind: 'checkout_confirm'; mediaType: MediaType; asin: string }
  /** Cancel button (any flow). */
  | { kind: 'cancel' }
  /** Request dropdown for /delete; option values are request IDs. */
  | { kind: 'delete_select' }
  /** Approve/Deny buttons on an admin approval message. */
  | { kind: 'approval'; action: 'approve' | 'deny'; requestId: string };

const PREFIX = {
  checkout_modal: 'co:modal',
  checkout_select: 'co:sel',
  checkout_confirm: 'co:cf',
  cancel: 'co:cancel',
  delete_select: 'del:sel',
  approval: 'appr',
} as const;

/** Encode a structured custom ID into a Discord-safe string (≤100 chars). */
export function encodeCustomId(id: DiscordCustomId): string {
  switch (id.kind) {
    case 'checkout_modal':
      return `${PREFIX.checkout_modal}:${id.mediaType}`;
    case 'checkout_select':
      return `${PREFIX.checkout_select}:${id.mediaType}`;
    case 'checkout_confirm':
      return `${PREFIX.checkout_confirm}:${id.mediaType}:${id.asin}`;
    case 'cancel':
      return PREFIX.cancel;
    case 'delete_select':
      return PREFIX.delete_select;
    case 'approval':
      return `${PREFIX.approval}:${id.action}:${id.requestId}`;
  }
}

function asMediaType(value: string | undefined): MediaType | null {
  return value === 'audiobook' || value === 'ebook' ? value : null;
}

/** Decode a Discord custom ID back into a structured value, or null if unrecognized. */
export function decodeCustomId(raw: string): DiscordCustomId | null {
  if (raw === PREFIX.cancel) return { kind: 'cancel' };
  if (raw === PREFIX.delete_select) return { kind: 'delete_select' };

  const parts = raw.split(':');

  // co:modal:<type>
  if (raw.startsWith(`${PREFIX.checkout_modal}:`)) {
    const mediaType = asMediaType(parts[2]);
    return mediaType ? { kind: 'checkout_modal', mediaType } : null;
  }

  // co:sel:<type>
  if (raw.startsWith(`${PREFIX.checkout_select}:`)) {
    const mediaType = asMediaType(parts[2]);
    return mediaType ? { kind: 'checkout_select', mediaType } : null;
  }

  // co:cf:<type>:<asin>
  if (raw.startsWith(`${PREFIX.checkout_confirm}:`)) {
    const mediaType = asMediaType(parts[2]);
    const asin = parts[3];
    return mediaType && asin ? { kind: 'checkout_confirm', mediaType, asin } : null;
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

  return null;
}
