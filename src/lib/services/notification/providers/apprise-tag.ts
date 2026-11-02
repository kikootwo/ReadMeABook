/**
 * Component: Apprise Tag Expansion ({user})
 * Documentation: documentation/backend/services/notifications.md
 *
 * Expands `{user}` in the Apprise Tag field (Config Key mode) to a tag-safe form of the
 * requester's username, so each request's notifications reach the user who made it.
 */

/** Placeholder in the Apprise Tag field, replaced by the requester's tag-safe username */
export const APPRISE_USER_PLACEHOLDER = '{user}';

/** The userName callers queue when a request's user could not be loaded: not a real requester */
const UNKNOWN_USER_NAME = 'unknown user';

/** Apprise tags that select something other than the services tagged with them ("all" = every service) */
const RESERVED_TAGS = new Set(['all']);

/** apprise-api's own tag delimiters: OR between groups, AND between the terms of a group */
const TAG_OR_DELIM_RE = /\s*[|,]\s*/;
const TAG_AND_DELIM_RE = /[\s&+]+/;

/** Why a `{user}` Tag sent nothing: no requester, or the requester's tag would select every target */
export type AppriseTagSkipReason = 'no_requester' | 'reserved_tag';

export type AppriseTagResolution =
  | { send: true; tag?: string }
  | { send: false; reason: AppriseTagSkipReason };

/**
 * Tag-safe form of a username, matching Apprise's tag grammar `[a-z0-9][a-z0-9_-]*`:
 * lowercase, accents removed, every run of characters other than a-z, 0-9 and `_` becomes
 * one `-`, then `-` and `_` are trimmed from both ends. Never contains an Apprise separator
 * or operator (`,` `|` `;` `&` `+` `[` `]` space `:`).
 * "Jane Doe" → "jane-doe"; "José.O'Brien@example.com" → "jose-o-brien-example-com".
 * Returns '' for no requester: empty, the "Unknown User" fallback, or a name with letters
 * none of which survive ("李明" → '', "Дочь 1" → '' rather than "1", shared by every such name).
 */
export function toAppriseUserTag(userName: string | null | undefined): string {
  if (typeof userName !== 'string') return '';
  if (userName.trim().toLowerCase() === UNKNOWN_USER_NAME) return '';
  const tag = userName
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9_]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  if (/\p{L}/u.test(userName) && !/[a-z]/.test(tag)) return '';
  return tag;
}

/** True when an expanded term would make Apprise notify something other than a tag's services */
function isReservedTerm(term: string): boolean {
  // Apprise reads "3:name" as a priority and "name:2" as a retry count around the tag name
  const bare = term.toLowerCase().replace(/^[0-9]+:/, '').replace(/:[0-9]+$/, '');
  return RESERVED_TAGS.has(bare);
}

/**
 * Resolve the configured Apprise tag for one notification.
 * - No `{user}` in the tag: returned exactly as configured (empty → no tag sent).
 * - `{user}`: the tag is split as apprise-api splits it (OR groups on `,` or `|`; AND terms
 *   on spaces, `&` or `+`), every `{user}` is replaced by `toAppriseUserTag(userName)`, and
 *   the tag is rebuilt as `group, group` with `term term` inside, which Apprise reads the same.
 *   A group whose `{user}` cannot be filled (no requester, or it would become a reserved
 *   tag such as `all`) is dropped whole, so an AND group never widens.
 * - Every group dropped → `{ send: false }`: an untagged send would not reach the requester.
 */
export function resolveAppriseTag(
  tag: string | null | undefined,
  userName: string | null | undefined
): AppriseTagResolution {
  if (!tag) return { send: true };
  if (!tag.includes(APPRISE_USER_PLACEHOLDER)) return { send: true, tag };

  const userTag = toAppriseUserTag(userName);
  const groups: string[] = [];

  for (const group of tag.split(TAG_OR_DELIM_RE)) {
    const terms = group.split(TAG_AND_DELIM_RE).filter(Boolean);
    if (terms.length === 0) continue;

    const expanded: string[] = [];
    let usable = true;
    for (const term of terms) {
      if (!term.includes(APPRISE_USER_PLACEHOLDER)) {
        expanded.push(term);
        continue;
      }
      const value = userTag ? term.split(APPRISE_USER_PLACEHOLDER).join(userTag) : '';
      if (!value || isReservedTerm(value)) {
        usable = false;
        break;
      }
      expanded.push(value);
    }
    if (usable) groups.push(expanded.join(' '));
  }

  if (groups.length > 0) return { send: true, tag: groups.join(', ') };
  return { send: false, reason: userTag ? 'reserved_tag' : 'no_requester' };
}
