/**
 * Component: Discord /request Handler Tests: Request and Cancel
 * Documentation: documentation/integrations/discord-bot.md
 *
 * The shared creators as the linked account, fixed reply texts (never a service message or
 * raw error), buttons removed by the acknowledgement, and a second press while the first
 * request is still being made.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASIN, fakeStep, lastText, sent, type FakeStep } from './discord-request-fakes';
import {
  BOOK,
  NOT_LINKED,
  PATH_ERROR,
  audible,
  creator,
  h,
  loadRequestHandlers,
  press,
  prismaMock,
  resetRequestHarness,
  state,
  toConfirm,
} from './request-handler-harness';

vi.mock('@/lib/db', async () => ({ prisma: (await import('./request-handler-harness')).prismaMock }));
vi.mock('@/lib/services/config.service', async () => {
  const { configService } = await import('./request-handler-harness');
  return { getConfigService: () => configService };
});
vi.mock('@/lib/integrations/audible.service', async () => {
  const { audible: fake } = await import('./request-handler-harness');
  return { getAudibleService: () => fake };
});
vi.mock('@/lib/services/request-creator.service', async () => (await import('./request-handler-harness')).creator);
vi.mock('@/lib/services/job-queue.service', async () => {
  const { jobQueue } = await import('./request-handler-harness');
  return { getJobQueueService: () => jobQueue };
});
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn(async () => ({ plexGuid: 'p' })) }));
vi.mock('@/lib/services/ebook-request-creator.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/ebook-request-creator.service')>();
  return { createEbookRequestForUser: vi.fn(actual.createEbookRequestForUser) };
});
vi.mock('@/lib/utils/logger', () => ({
  RMABLogger: { create: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

beforeAll(loadRequestHandlers);
beforeEach(resetRequestHarness);

describe('/request creates through the shared creators', () => {
  it('audiobook: createRequestForUser as the linked account, with bypassIgnore like POST /api/requests', async () => {
    const { confirmId } = await toConfirm('audiobook');
    const button = await press(confirmId);

    expect(creator.createRequestForUser).toHaveBeenCalledWith(
      'user-1',
      { asin: ASIN, title: 'The Book', author: 'Ann Author', narrator: 'Ned', description: 'About', coverArtUrl: BOOK.coverArtUrl },
      { bypassIgnore: true }
    );
    expect(h.ebookCreator).not.toHaveBeenCalled();
    expect(lastText(button)).toBe('Requested. The search has started.');
    expect(button.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ components: [] }));
  });

  it('ebook: the shared ebook creator as the linked account', async () => {
    const { confirmId } = await toConfirm('ebook');
    const button = await press(confirmId);

    expect(h.ebookCreator).toHaveBeenCalledWith('user-1', ASIN);
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
    expect(prismaMock.request.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: 'user-1', type: 'ebook' }) });
    expect(lastText(button)).toBe('Ebook requested. The search has started.');
  });

  it.each([
    [{ success: true, request: { status: 'awaiting_approval' } }, 'Requested. An admin needs to approve it before it downloads.'],
    [{ success: true, request: { status: 'awaiting_release' } }, 'Requested. It is not released yet; the search starts once it is.'],
    [{ success: false, reason: 'duplicate', message: 'You have already requested this audiobook' }, 'You have already requested this audiobook.'],
    [{ success: false, reason: 'already_available', message: `In library at ${PATH_ERROR}` }, 'This audiobook is already in the library.'],
    [{ success: false, reason: 'being_processed', message: PATH_ERROR }, 'This audiobook is already being downloaded or processed.'],
    [{ success: false, reason: 'user_not_found', message: 'User not found' }, NOT_LINKED],
  ])('audiobook result %j → a fixed reply', async (result, text) => {
    creator.createRequestForUser.mockResolvedValue(result);
    const { confirmId } = await toConfirm('audiobook');
    expect(lastText(await press(confirmId))).toBe(text);
  });

  it('cancel: nothing created', async () => {
    const { cancelId } = await toConfirm('audiobook');
    const button = await press(cancelId);
    expect(lastText(button)).toBe(h.TEXT.cancelled);
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it('the audiobook details for the creator are fetched without the series fill', async () => {
    const { confirmId } = await toConfirm('audiobook');
    audible.getAudiobookDetails.mockClear();
    await press(confirmId);
    expect(audible.getAudiobookDetails).toHaveBeenCalledExactlyOnceWith(ASIN, { fillSeries: false });
  });
});

describe('/request never shows a service message or raw error', () => {
  const shown = (step: FakeStep) => JSON.stringify(sent(step));

  it('ebook creator 500 with a path in its error: the route body keeps it, the reply does not', async () => {
    prismaMock.request.create.mockRejectedValue(new Error(PATH_ERROR));
    const { confirmId } = await toConfirm('ebook');
    const button = await press(confirmId);

    const result = await h.ebookCreator.mock.results[0].value;
    expect(result).toMatchObject({ outcome: 'error', status: 500, body: { error: PATH_ERROR } });
    expect(lastText(button)).toBe(h.TEXT.generic);
    expect(shown(button)).not.toContain('/srv/library');
  });

  it('audiobook creator throws a path-bearing error: fixed text only', async () => {
    creator.createRequestForUser.mockRejectedValue(new Error(PATH_ERROR));
    const { confirmId } = await toConfirm('audiobook');
    const button = await press(confirmId);

    expect(lastText(button)).toBe(h.TEXT.generic);
    expect(shown(button)).not.toContain('/srv/library');
  });

  it('a 409 ebook body message is not shown either', async () => {
    prismaMock.request.findFirst.mockImplementation(async ({ where }: { where: { type: string } }) =>
      where.type === 'ebook' ? { id: 'ebook-old', status: 'downloading' } : { id: 'parent' }
    );
    const { confirmId } = await toConfirm('ebook');
    const button = await press(confirmId);
    expect(lastText(button)).toBe('This ebook has already been requested.');
    expect(shown(button)).not.toContain('status: downloading');
  });
});

describe('/request: pressing Request or Cancel', () => {
  it('Request and Cancel remove the buttons in the acknowledgement itself, before any database read', async () => {
    const { confirmId, cancelId } = await toConfirm('audiobook');
    for (const [customId, text] of [
      [confirmId, h.TEXT.requesting],
      [cancelId, h.TEXT.cancelling],
    ]) {
      state.order.length = 0;
      const button = await press(customId);
      expect(button.deferUpdate).not.toHaveBeenCalled();
      expect(button.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: text, components: [] }));
      // The book embed stays while the request is made
      expect(button.update.mock.calls[0][0]).not.toHaveProperty('embeds');
      expect(state.order[0]).toBe('update');
    }
  });

  it('two Request presses at once make one request; the second gets a fixed reply; later presses go through', async () => {
    // The creator stays busy until released, as a slow database would keep it
    const pending: Array<(value: unknown) => void> = [];
    creator.createRequestForUser.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { confirmId } = await toConfirm('audiobook');
    const first = fakeStep('button', { customId: confirmId });
    const second = fakeStep('button', { customId: confirmId });

    const runs = [h.handleRequestComponent(first), h.handleRequestComponent(second)];
    await vi.waitFor(() => expect(creator.createRequestForUser).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const release of pending) release({ success: true, request: { id: 'req-1', status: 'pending' } });
    await Promise.all(runs);

    expect(creator.createRequestForUser).toHaveBeenCalledTimes(1);
    expect(lastText(first)).toBe('Requested. The search has started.');
    expect(second.update).not.toHaveBeenCalled();
    expect(second.reply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ content: h.TEXT.alreadyWorking, flags: 64 }));

    // Once the first press is done (or failed), the book can be requested again
    creator.createRequestForUser.mockReset();
    creator.createRequestForUser.mockRejectedValueOnce(new Error('database unavailable'));
    creator.createRequestForUser.mockResolvedValueOnce({ success: false, reason: 'duplicate', message: 'x' });
    expect(lastText(await press(confirmId))).toBe(h.TEXT.generic);
    expect(lastText(await press(confirmId))).toBe('You have already requested this audiobook.');
    expect(creator.createRequestForUser).toHaveBeenCalledTimes(2);
  });
});
