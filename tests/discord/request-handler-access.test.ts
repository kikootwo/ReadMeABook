/**
 * Component: Discord /request Handler Tests: who may request
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Access on every step (real resolver over a mocked database): the linked account, the
 * requester role at the command and again at Request, admins, @everyone, and a role setting
 * that cannot be read.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GUILD, fakeStep, lastText } from './discord-request-fakes';
import {
  NOT_LINKED,
  NO_REQUESTER_ROLE,
  audible,
  creator,
  h,
  linkAs,
  loadRequestHandlers,
  press,
  prismaMock,
  resetRequestHarness,
  settings,
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

beforeAll(async () => {
  await loadRequestHandlers();
  const access = await import('@/lib/services/discord/request/discord-request-access');
  expect([access.NOT_LINKED, access.NO_REQUESTER_ROLE]).toEqual([NOT_LINKED, NO_REQUESTER_ROLE]);
});

beforeEach(resetRequestHarness);

describe('/request access', () => {
  it('unlinked: refused at the command, no search, no creator', async () => {
    linkAs(null);
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'the book' } });
    await h.handleRequestCommand(command);

    expect(lastText(command)).toBe(NOT_LINKED);
    expect(audible.search).not.toHaveBeenCalled();
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it.each([
    ['pending approval', { registrationStatus: 'pending_approval' }],
    ['rejected', { registrationStatus: 'rejected' }],
    ['deleted', { deletedAt: new Date() }],
  ])('%s: refused at the command (with and without a query)', async (_label, accountState) => {
    linkAs(accountState);
    const withQuery = fakeStep('command', { options: { type: 'audiobook', query: 'the book' } });
    const withoutQuery = fakeStep('command', { options: { type: 'ebook' } });
    await h.handleRequestCommand(withQuery);
    await h.handleRequestCommand(withoutQuery);

    expect(lastText(withQuery)).toBe(NOT_LINKED);
    expect(lastText(withoutQuery)).toBe(NOT_LINKED);
    expect(withoutQuery.showModal).not.toHaveBeenCalled();
    expect(audible.search).not.toHaveBeenCalled();
  });

  it.each([
    ['pending approval', { registrationStatus: 'pending_approval' }],
    ['rejected', { registrationStatus: 'rejected' }],
  ])('%s after the command: refused at confirm, nothing created', async (_label, accountState) => {
    const { confirmId } = await toConfirm('audiobook');
    linkAs(accountState);
    const button = await press(confirmId);

    expect(lastText(button)).toBe(NOT_LINKED);
    expect(button.editReply).toHaveBeenLastCalledWith(expect.objectContaining({ components: [], embeds: [] }));
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it('requester role removed between the command and confirm: refused at confirm', async () => {
    const { confirmId } = await toConfirm('ebook');
    const button = await press(confirmId, { roles: [] });

    expect(lastText(button)).toBe(NO_REQUESTER_ROLE);
    expect(h.ebookCreator).not.toHaveBeenCalled();
  });

  it('no requester role at the command: refused (role read from interaction.member, cached shape too)', async () => {
    const raw = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: { roles: ['999999999999999999'] } });
    const cached = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: { roles: { cache: new Map() } } });
    await h.handleRequestCommand(raw);
    await h.handleRequestCommand(cached);

    expect(lastText(raw)).toBe(NO_REQUESTER_ROLE);
    expect(lastText(cached)).toBe(NO_REQUESTER_ROLE);
    expect(audible.search).not.toHaveBeenCalled();
  });

  it('a requester role is set and the interaction has no member: refused', async () => {
    const step = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: null });
    await h.handleRequestCommand(step);
    expect(lastText(step)).toBe(NO_REQUESTER_ROLE);
  });

  it('an RMAB admin without the role: allowed through to the creator', async () => {
    linkAs({ role: 'admin' });
    const { confirmId } = await toConfirm('audiobook', { roles: [] });
    await press(confirmId, null);

    expect(creator.createRequestForUser).toHaveBeenCalledTimes(1);
  });

  it('no requester role configured: any linked member may request', async () => {
    settings.requesterRole = '';
    const { confirmId } = await toConfirm('audiobook', { roles: [] });
    await press(confirmId, { roles: [] });
    expect(creator.createRequestForUser).toHaveBeenCalledTimes(1);
  });

  it('requester role set to @everyone (the server ID): every member passes, raw and cached shapes', async () => {
    settings.requesterRole = GUILD;
    const raw = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: { roles: [] } });
    const cached = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: { roles: { cache: new Map() } } });
    const noMember = fakeStep('command', { options: { type: 'audiobook', query: 'x' }, member: null });
    await h.handleRequestCommand(raw);
    await h.handleRequestCommand(cached);
    await h.handleRequestCommand(noMember);

    expect(audible.search).toHaveBeenCalledTimes(2);
    expect(lastText(noMember)).toBe(NO_REQUESTER_ROLE);
  });
});

describe('/request: the requester role setting cannot be read', () => {
  it('at the command: the generic error, no search (refused, not let through)', async () => {
    settings.roleReadError = new Error('connection refused');
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'the book' }, member: { roles: [] } });
    await h.handleRequestCommand(command);

    expect(lastText(command)).toBe(h.TEXT.generic);
    expect(audible.search).not.toHaveBeenCalled();
  });

  it('without a query: the generic error and no form', async () => {
    settings.roleReadError = new Error('connection refused');
    const command = fakeStep('command', { options: { type: 'ebook' }, member: { roles: [] } });
    await h.handleRequestCommand(command);

    expect(lastText(command)).toBe(h.TEXT.generic);
    expect(command.showModal).not.toHaveBeenCalled();
  });

  it('at Request: the generic error, nothing created', async () => {
    const { confirmId } = await toConfirm('audiobook');
    settings.roleReadError = new Error('connection refused');
    const button = await press(confirmId, { roles: [] });

    expect(lastText(button)).toBe(h.TEXT.generic);
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });
});

describe('/request: access reads', () => {
  it('the account and the requester role are read at the same time (the form opens sooner)', async () => {
    prismaMock.user.findUnique.mockImplementation(async () => {
      state.order.push('account read started');
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.order.push('account read done');
      return { id: 'user-1', plexUsername: 'alice', role: 'user', registrationStatus: 'approved', deletedAt: null };
    });
    const command = fakeStep('command', { options: { type: 'ebook' }, order: state.order });
    await h.handleRequestCommand(command);

    expect(command.showModal).toHaveBeenCalledTimes(1);
    expect(state.order.indexOf('db')).toBeGreaterThan(-1);
    expect(state.order.indexOf('db')).toBeLessThan(state.order.indexOf('account read done'));
  });
});
