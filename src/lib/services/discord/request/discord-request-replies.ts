/**
 * Component: Discord /request Replies
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Every text the bot shows is fixed and chosen from a result code, never a service's
 * `message` or `error` (those can carry raw error text or paths). Also the raw JSON for the
 * search modal, the results menu and the confirm buttons.
 */

import type { CreateRequestResult } from '@/lib/services/request-creator.service';
import type { EbookRequestResult } from '@/lib/services/ebook-request-creator.service';
import { encodeRequestCustomId, type RequestMediaType } from '../discord-custom-id';
import { REQUEST_QUERY_MAX_LENGTH } from '../discord-commands';
import { ButtonStyle, ComponentType, DISCORD_LIMITS, TextInputStyle, safeText } from '../discord-format';
import type { SelectOption } from '../discord-book-embed';
import { NOT_LINKED } from './discord-request-access';

export const QUERY_INPUT_ID = 'query';

export const TEXT = {
  generic: 'Something went wrong. Try again in a moment.',
  unknownType: 'Choose Audiobook or Ebook.',
  emptyQuery: 'Type a title or an author to search for.',
  queryTooLong: `Search text can be at most ${REQUEST_QUERY_MAX_LENGTH} characters.`,
  noResults: 'No books found. Try a different title or author.',
  allHidden: 'Every result is in another language and hidden by the language filter. Try a different search.',
  staleChoice: 'That choice is no longer valid. Run /request again.',
  bookNotFound: 'That book could not be loaded from Audible. Try again in a moment.',
  confirm: 'Request this book?',
  cancelled: 'Cancelled. Nothing was requested.',
  requesting: 'Requesting…',
  cancelling: 'Cancelling…',
  alreadyWorking: 'Already working on that request. One moment.',
} as const;

const TYPE_WORD: Record<RequestMediaType, string> = { audiobook: 'audiobook', ebook: 'ebook' };

/** The search prompt above the results menu (the query is the user's own text, escaped). */
export function resultsText(type: RequestMediaType, query: string, hiddenCount: number): string {
  const hidden = hiddenCount > 0 ? ` (${hiddenCount} in other languages hidden)` : '';
  return `Pick the ${TYPE_WORD[type]} to request. Results for "${safeText(query, REQUEST_QUERY_MAX_LENGTH * 2)}"${hidden}:`;
}

export function audiobookResultText(result: CreateRequestResult): string {
  if (result.success) {
    const status = (result.request as { status?: unknown } | null)?.status;
    if (status === 'awaiting_approval') return 'Requested. An admin needs to approve it before it downloads.';
    if (status === 'awaiting_release') return 'Requested. It is not released yet; the search starts once it is.';
    return 'Requested. The search has started.';
  }
  switch (result.reason) {
    case 'already_available':
      return 'This audiobook is already in the library.';
    case 'being_processed':
      return 'This audiobook is already being downloaded or processed.';
    case 'duplicate':
      return 'You have already requested this audiobook.';
    case 'user_not_found':
      return NOT_LINKED;
    default:
      return 'This audiobook could not be requested.';
  }
}

export function ebookResultText(result: EbookRequestResult): string {
  switch (result.outcome) {
    case 'created':
      return result.needsApproval ? 'Ebook requested. An admin needs to approve it.' : 'Ebook requested. The search has started.';
    case 'retried':
      return 'The earlier ebook request had failed; its search has started again.';
    case 'already_requested':
      return 'This ebook has already been requested.';
    case 'not_available':
      return 'The audiobook must be in the library before its ebook can be requested.';
    case 'not_on_audible':
      return 'That book was not found on Audible.';
    case 'sources_disabled':
      return 'Ebook requests are not turned on in RMAB.';
    case 'user_not_found':
      return NOT_LINKED;
    default:
      return TEXT.generic;
  }
}

/** The form /request opens when no query was given. */
export function searchModal(type: RequestMediaType) {
  return {
    custom_id: encodeRequestCustomId('modal', type),
    title: type === 'audiobook' ? 'Request an audiobook' : 'Request an ebook',
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.TextInput,
            custom_id: QUERY_INPUT_ID,
            label: 'Title or author',
            style: TextInputStyle.Short,
            min_length: 1,
            max_length: REQUEST_QUERY_MAX_LENGTH,
            required: true,
          },
        ],
      },
    ],
  };
}

export function resultsMenu(type: RequestMediaType, options: SelectOption[]) {
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: encodeRequestCustomId('pick', type),
          placeholder: 'Choose a book',
          min_values: 1,
          max_values: 1,
          options: options.slice(0, DISCORD_LIMITS.selectOptions),
        },
      ],
    },
  ];
}

export function confirmButtons(type: RequestMediaType, asin: string) {
  return [
    {
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Primary, label: 'Request', custom_id: encodeRequestCustomId('confirm', type, asin) },
        { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Cancel', custom_id: encodeRequestCustomId('cancel', type) },
      ],
    },
  ];
}
