/**
 * Component: Discord /request Handler Test Harness (shared by the request handler tests)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The mocked database, Audible, creators and settings behind the handler tests, the account
 * the fake Discord user is linked to, and helpers that walk a request to the confirm step.
 * Each test file registers the same vi.mock factories over these values (vi.mock is hoisted
 * per file, so it cannot live here), then calls `loadRequestHandlers()` in beforeAll.
 */

import { vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import { ASIN, DISCORD_USER, REQUESTER_ROLE, componentIds, fakeStep, type FakeStep } from './discord-request-fakes';

export const prismaMock = createPrismaMock();
/** The requester role setting, and an error its database read throws. */
export const settings = { requesterRole: '', roleReadError: null as Error | null };
export const audible = { search: vi.fn(), getAudiobookDetails: vi.fn() };
export const creator = { createRequestForUser: vi.fn() };
export const jobQueue = { addSearchEbookJob: vi.fn(async () => undefined), addNotificationJob: vi.fn(async () => undefined) };

/** The config service as the handlers would see it (it swallows read errors and returns null). */
export const configService = {
  get: async (key: string) => (key === 'discord.requester_role_id' && !settings.roleReadError ? settings.requesterRole : null),
};

// Same texts as discord-request-access.ts (checked in the access tests; a static import would load the database mock too early)
export const NOT_LINKED = 'Your Discord account is not linked to an RMAB account that can make requests. Ask an RMAB admin to link it.';
export const NO_REQUESTER_ROLE = 'You need the requester role in this server to request books.';

export const BOOK = { asin: ASIN, title: 'The Book', author: 'Ann Author', narrator: 'Ned', description: 'About', coverArtUrl: 'https://m.media-amazon.com/c.jpg', series: 'Saga', seriesPart: '2' };
export const PATH_ERROR = "EACCES: permission denied, open '/srv/library/Ann Author/The Book/secret.m4b'";

type Account = { role?: string; registrationStatus?: string | null; deletedAt?: Date | null } | null;
/** The linked account and the shared call log of the current test. */
export const state = { account: null as Account, order: [] as string[] };

export function linkAs(next: Account) {
  state.account = next === null ? null : { role: 'user', registrationStatus: 'approved', deletedAt: null, ...next };
}

type Handlers = typeof import('@/lib/services/discord/request/discord-request-handlers');
type EbookCreator = typeof import('@/lib/services/ebook-request-creator.service').createEbookRequestForUser;

/** The modules under test, loaded after the mocks exist (the database mock is a top-level value). */
export const h = {} as {
  handleRequestCommand: Handlers['handleRequestCommand'];
  handleRequestComponent: Handlers['handleRequestComponent'];
  routeInteraction: typeof import('@/lib/services/discord/discord-interaction-router').routeInteraction;
  TEXT: typeof import('@/lib/services/discord/request/discord-request-replies').TEXT;
  ebookCreator: ReturnType<typeof vi.mocked<EbookCreator>>;
};

export async function loadRequestHandlers(): Promise<void> {
  ({ handleRequestCommand: h.handleRequestCommand, handleRequestComponent: h.handleRequestComponent } = await import(
    '@/lib/services/discord/request/discord-request-handlers'
  ));
  ({ routeInteraction: h.routeInteraction } = await import('@/lib/services/discord/discord-interaction-router'));
  ({ TEXT: h.TEXT } = await import('@/lib/services/discord/request/discord-request-replies'));
  h.ebookCreator = vi.mocked((await import('@/lib/services/ebook-request-creator.service')).createEbookRequestForUser);
}

/** Runs /request with a query, picks the book, and returns the confirm step's custom ids. */
export async function toConfirm(type: 'audiobook' | 'ebook', member?: unknown) {
  const command = fakeStep('command', { options: { type, query: 'the book' }, member, order: state.order });
  await h.handleRequestCommand(command);
  const select = fakeStep('select', { customId: componentIds(command)[0], values: [ASIN], member, order: state.order });
  await h.handleRequestComponent(select);
  const [confirmId, cancelId] = componentIds(select);
  return { command, select, confirmId, cancelId };
}

/** Presses a button (Request or Cancel) as the linked Discord user. */
export async function press(customId: string, member?: unknown): Promise<FakeStep> {
  const button = fakeStep('button', { customId, member, order: state.order });
  await h.handleRequestComponent(button);
  return button;
}

/** Every test starts linked as an approved user holding the requester role, with one search result. */
export function resetRequestHarness(): void {
  vi.clearAllMocks();
  state.order = [];
  settings.requesterRole = REQUESTER_ROLE;
  settings.roleReadError = null;
  linkAs({});
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { discordUserId?: string; id?: string } }) => {
    state.order.push('db');
    if (where.discordUserId !== undefined) {
      return where.discordUserId === DISCORD_USER && state.account ? { id: 'user-1', plexUsername: 'alice', ...state.account } : null;
    }
    return { role: state.account?.role ?? 'user', autoApproveRequests: true, plexUsername: 'alice' };
  });
  prismaMock.configuration.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
    if (where.key === 'discord.requester_role_id') {
      state.order.push('db');
      if (settings.roleReadError) throw settings.roleReadError;
      return settings.requesterRole ? { key: where.key, value: settings.requesterRole } : null;
    }
    return where.key === 'ebook_annas_archive_enabled' ? { key: where.key, value: 'true' } : null;
  });
  prismaMock.audiobook.findFirst.mockResolvedValue({ id: 'ab-1', title: 'The Book', author: 'Ann Author', audibleAsin: ASIN });
  prismaMock.request.findFirst.mockResolvedValue(null);
  prismaMock.request.create.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ id: 'ebook-1', ...args.data }));
  audible.search.mockResolvedValue({ query: 'the book', results: [BOOK], totalResults: 1, page: 1, hasMore: false });
  audible.getAudiobookDetails.mockResolvedValue(BOOK);
  creator.createRequestForUser.mockResolvedValue({ success: true, request: { id: 'req-1', status: 'pending' } });
}
