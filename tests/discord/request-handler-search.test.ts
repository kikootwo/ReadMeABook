/**
 * Component: Discord /request Handler Tests: command, search form and results menu
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Acknowledge-before-work at each step, the search form, search results, the book embed
 * (markdown escaped, no mentions), and the server checks and forged ids.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoutableInteraction } from '@/lib/services/discord/discord-interaction-router';
import { ASIN, DISCORD_USER, GUILD, componentIds, fakeStep, lastText, selectOptions, sent, type FakeStep } from './discord-request-fakes';
import {
  BOOK,
  NOT_LINKED,
  audible,
  creator,
  h,
  linkAs,
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

describe('/request: Discord acknowledgement order', () => {
  it('with a query: deferred before any database read or search', async () => {
    const { command, select } = await toConfirm('audiobook');
    expect(command.order.indexOf('deferReply')).toBe(0);
    expect(command.order.indexOf('db')).toBeGreaterThan(0);
    expect(select.order.filter((e) => e !== 'db').slice(0, 3)).toEqual(['deferReply', 'editReply', 'deferUpdate']);
    const button = await press(componentIds(select)[0]);
    const fromConfirm = button.order.slice(button.order.lastIndexOf('update'));
    expect(fromConfirm[0]).toBe('update');
    expect(fromConfirm).toContain('db');
  });

  it('without a query: access read from the database, then the form is the first reply (no defer); the submit checks again', async () => {
    const command = fakeStep('command', { options: { type: 'ebook' }, order: state.order });
    await h.handleRequestCommand(command);

    expect(state.order.filter((e) => e !== 'db')).toEqual(['showModal']);
    expect(state.order[0]).toBe('db');
    expect(command.deferReply).not.toHaveBeenCalled();
    const modal = command.showModal.mock.calls[0][0] as { custom_id: string; components: Array<{ components: Array<{ custom_id: string }> }> };
    expect(modal.components[0].components[0].custom_id).toBe('query');

    linkAs({ registrationStatus: 'rejected' });
    const submit = fakeStep('modal', { customId: modal.custom_id, query: 'the book' });
    await h.handleRequestComponent(submit);
    expect(submit.order[0]).toBe('deferReply');
    expect(lastText(submit)).toBe(NOT_LINKED);
    expect(audible.search).not.toHaveBeenCalled();
  });

  it('the form submit searches as the command would', async () => {
    const command = fakeStep('command', { options: { type: 'audiobook' } });
    await h.handleRequestCommand(command);
    const submit = fakeStep('modal', { customId: (command.showModal.mock.calls[0][0] as { custom_id: string }).custom_id, query: ' dune ' });
    await h.handleRequestComponent(submit);

    expect(audible.search).toHaveBeenCalledWith('dune', 1);
    expect(selectOptions(submit).map((o) => o.value)).toEqual([ASIN]);
  });
});

describe('/request: search results and the book embed', () => {
  it.each([
    ['every result hidden by the language filter', { language: 'en', hiddenCount: 3, firstResultHidden: true }, 'allHidden'],
    ['no results', undefined, 'noResults'],
  ] as const)('%s says so', async (_label, languageFilter, text) => {
    audible.search.mockResolvedValue({ query: 'x', results: [], totalResults: 0, page: 1, hasMore: false, languageFilter });
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'x' } });
    await h.handleRequestCommand(command);
    expect(lastText(command)).toBe(h.TEXT[text]);
  });

  it('at most 25 options, one per ASIN, invalid ASINs dropped', async () => {
    const many = Array.from({ length: 40 }, (_, n) => ({ ...BOOK, asin: `B0${String(n).padStart(8, '0')}` }));
    audible.search.mockResolvedValue({ query: 'x', results: [BOOK, BOOK, { ...BOOK, asin: 'bad' }, ...many], totalResults: 43, page: 1, hasMore: true });
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'x' } });
    await h.handleRequestCommand(command);

    const values = selectOptions(command).map((o) => o.value);
    expect(values).toHaveLength(25);
    expect(new Set(values).size).toBe(25);
    expect(values).not.toContain('bad');
  });

  it('the embed holds metadata only, markdown escaped; no reply parses mentions', async () => {
    audible.getAudiobookDetails.mockResolvedValue({ ...BOOK, title: '**Big** [win](https://x.test) @everyone', author: '_Ann_ `x`', narrator: '> quote', series: '# Saga ||spoiler||' });
    const { command, select } = await toConfirm('audiobook');

    const embed = (select.editReply.mock.calls.at(-1)![0].embeds as Array<Record<string, unknown>>)[0];
    expect(embed.title).toBe('\\*\\*Big\\*\\* \\[win\\]\\(https\\://x\\.test\\) \\@everyone');
    const texts = [embed.title, ...(embed.fields as Array<{ value: string }>).map((f) => f.value)] as string[];
    expect(texts.slice(1)).toEqual(['\\_Ann\\_ \\`x\\`', '\\> quote', '\\# Saga \\|\\|spoiler\\|\\|, book 2']);
    // With every escaped pair removed, no markdown character is left
    for (const text of texts) expect(text.replace(/\\./g, '')).not.toMatch(/[*_`|>#[\]()]/);
    expect(Object.keys(embed).sort()).toEqual(['fields', 'footer', 'thumbnail', 'title']);
    expect((embed.fields as Array<{ name: string }>).map((f) => f.name)).toEqual(['Author', 'Narrator', 'Series']);
    for (const payload of [...sent(command), ...sent(select)].filter((p) => 'content' in p)) {
      expect(payload.allowedMentions).toEqual({ parse: [] });
    }
  });

  it('a stale or forged menu value: no lookup, a fixed text', async () => {
    const command = fakeStep('command', { options: { type: 'audiobook', query: 'x' } });
    await h.handleRequestCommand(command);
    const select = fakeStep('select', { customId: componentIds(command)[0], values: ['../../etc/passwd'] });
    await h.handleRequestComponent(select);
    expect(lastText(select)).toBe(h.TEXT.staleChoice);
    expect(audible.getAudiobookDetails).not.toHaveBeenCalled();
  });
});

describe('/request: server checks and forged ids', () => {
  const asRoutable = (step: FakeStep) => step as unknown as RoutableInteraction;
  const notAcknowledged = (step: FakeStep) => {
    expect(step.deferUpdate).not.toHaveBeenCalled();
    expect(step.update).not.toHaveBeenCalled();
  };

  it('a command or form submit from another server or a DM is dropped before any database read', async () => {
    for (const guildId of ['444444444444444444', null]) {
      const command = fakeStep('command', { guildId, options: { type: 'audiobook', query: 'x' } });
      const submit = fakeStep('modal', { guildId, customId: 'rmab:req:modal:a:abcdefghij', query: 'x' });
      expect(await h.routeInteraction(asRoutable(command), GUILD)).toBe('ignored-foreign-guild');
      expect(await h.routeInteraction(asRoutable(submit), GUILD)).toBe('ignored-foreign-guild');
    }
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('a confirm button pressed in a DM is ignored (no member to check)', async () => {
    const { confirmId } = await toConfirm('audiobook');
    prismaMock.user.findUnique.mockClear();
    const button = fakeStep('button', { guildId: null, customId: confirmId, member: null });
    expect(await h.routeInteraction(asRoutable(button), GUILD)).toBe('handled');
    notAcknowledged(button);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it.each([
    `rmab:req:ok:a:${ASIN}:abcdefghij:admin`,
    `rmab:req:ok:a:${ASIN}:${DISCORD_USER}:abcdefghij`,
    `rmab:req:ok:a:${ASIN}:abcdefghij${'x'.repeat(100)}`,
  ])('a forged confirm id (%s) is ignored: no acknowledgement, no read, no request', async (customId) => {
    const button = fakeStep('button', { customId });
    await h.handleRequestComponent(button);
    notAcknowledged(button);
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });

  it('a confirm id on a menu (step and kind disagree) is ignored', async () => {
    const select = fakeStep('select', { customId: `rmab:req:ok:a:${ASIN}:abcdefghij`, values: [ASIN] });
    await h.handleRequestComponent(select);
    notAcknowledged(select);
    expect(creator.createRequestForUser).not.toHaveBeenCalled();
  });
});
