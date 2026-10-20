/**
 * Component: BookDate callAI Claude Reply Tests
 * Documentation: documentation/features/bookdate.md
 *
 * All provider responses are mocks shaped per the official docs (URLs in
 * tests/helpers/bookdate-ai-fixtures.ts); nothing here runs against a live API.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';
import {
  RECS,
  RECS_JSON,
  thinking,
  redacted,
  text,
  claudeMessage,
  claudeFetch,
  callClaude,
} from '../helpers/bookdate-ai-fixtures';

const prismaMock = createPrismaMock();
const encryptionMock = vi.hoisted(() => ({ decrypt: vi.fn() }));
const loggerMock = vi.hoisted(() => ({ create: vi.fn() }));
const logSpy = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));

vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn() }) }));
vi.mock('@/lib/services/encryption.service', () => ({ getEncryptionService: () => encryptionMock }));
vi.mock('@/lib/integrations/plex.service', () => ({ getPlexService: () => ({}) }));
vi.mock('@/lib/integrations/audible.service', () => ({ AudibleService: vi.fn() }));
vi.mock('@/lib/utils/audiobook-matcher', () => ({ findPlexMatch: vi.fn() }));
vi.mock('@/lib/utils/logger', () => ({ RMABLogger: { create: loggerMock.create } }));

describe('callAI: Claude replies', () => {
  beforeEach(() => {
    vi.resetModules();
    loggerMock.create.mockReturnValue(logSpy);
    encryptionMock.decrypt.mockReturnValue('api-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Claude content blocks', () => {
    it('skips a thinking block before the text block', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([thinking(), text(RECS_JSON)])))).resolves.toEqual(RECS);
    });

    it('skips a redacted_thinking block before the text block', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([redacted(), text(RECS_JSON)])))).resolves.toEqual(RECS);
    });

    it('joins JSON split across text blocks after thinking', async () => {
      const blocks = [thinking(), text(RECS_JSON.slice(0, 20)), text(RECS_JSON.slice(20))];
      await expect(callClaude(claudeFetch(claudeMessage(blocks)))).resolves.toEqual(RECS);
    });

    it('joins JSON split across text blocks without thinking', async () => {
      const blocks = [text(RECS_JSON.slice(0, 20)), text(RECS_JSON.slice(20))];
      await expect(callClaude(claudeFetch(claudeMessage(blocks)))).resolves.toEqual(RECS);
    });

    it('parses a ```json fence after a thinking block', async () => {
      const blocks = [thinking(), text('```json\n' + RECS_JSON + '\n```')];
      await expect(callClaude(claudeFetch(claudeMessage(blocks)))).resolves.toEqual(RECS);
    });

    it('parses a bare ``` fence', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([text('```\n' + RECS_JSON + '\n```')])))).resolves.toEqual(RECS);
    });

    it('parses a fence surrounded by whitespace', async () => {
      const blocks = [text(' \n```json\n' + RECS_JSON + '\n```\n')];
      await expect(callClaude(claudeFetch(claudeMessage(blocks)))).resolves.toEqual(RECS);
    });
  });

  describe('Claude replies with no usable answer', () => {
    it('rejects empty content with a clear message', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([])))).rejects.toThrow(
        /^Claude returned no recommendations \(stop reason: end_turn\)/
      );
    });

    it('rejects a whitespace-only text block', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([thinking(), text('  \n ')])))).rejects.toThrow(
        /^Claude returned no recommendations/
      );
    });

    it('reports max_tokens with partial JSON as cut off', async () => {
      const blocks = [thinking(), text('{"recommendations":[{"title":"Proj')];
      await expect(callClaude(claudeFetch(claudeMessage(blocks, 'max_tokens')))).rejects.toThrow(/^Claude's reply was cut off/);
    });

    it.each([['max_tokens'], ['model_context_window_exceeded']])(
      'parses complete JSON followed by padding when stop_reason is %s',
      async (stopReason) => {
        const blocks = [thinking(), text(RECS_JSON + '\n'.repeat(400))];
        await expect(callClaude(claudeFetch(claudeMessage(blocks, stopReason)))).resolves.toEqual(RECS);
      }
    );

    it('reports max_tokens with thinking only as cut off', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([thinking()], 'max_tokens')))).rejects.toThrow(/^Claude's reply was cut off/);
    });

    it('reports model_context_window_exceeded as cut off', async () => {
      const blocks = [thinking(), text('{"recommendations":[')];
      await expect(
        callClaude(claudeFetch(claudeMessage(blocks, 'model_context_window_exceeded')))
      ).rejects.toThrow(/^Claude's reply was cut off/);
    });

    it('reports a refusal with no content as declined', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([], 'refusal')))).rejects.toThrow(/^Claude declined/);
    });

    it('reports a refusal with partial text as declined, without echoing the text', async () => {
      const promise = callClaude(claudeFetch(claudeMessage([text('I can not help with SECRET-REFUSAL-TEXT')], 'refusal')));
      await expect(promise).rejects.toThrow(/^Claude declined/);
      await expect(promise).rejects.not.toThrow(/SECRET-REFUSAL-TEXT/);
    });

    it('rejects prose without quoting the reply', async () => {
      const promise = callClaude(claudeFetch(claudeMessage([thinking(), text('Here are your picks: none')])));
      await expect(promise).rejects.toThrow(/^Claude's reply was not valid JSON/);
      await expect(promise).rejects.not.toThrow(/Here are your picks/);
    });

    it.each([['null'], ['[]'], [RECS_JSON.replace('recommendations', 'recommended_audiobooks')]])(
      'rejects a reply without a recommendations array: %s',
      async (reply) => {
        await expect(callClaude(claudeFetch(claudeMessage([text(reply)])))).rejects.toThrow(
          /^Claude's reply did not include a recommendations list/
        );
      }
    );

    it('drops list items without a string title and author', async () => {
      const good = RECS.recommendations[0];
      const reply = JSON.stringify({
        recommendations: [null, 'Dune', [], { title: 'No Author' }, { title: ' ', author: 'X' }, { title: 7, author: 'Y' }, good],
      });
      await expect(callClaude(claudeFetch(claudeMessage([thinking(), text(reply)])))).resolves.toEqual(RECS);
    });

    it('rejects a list with no usable items', async () => {
      await expect(
        callClaude(claudeFetch(claudeMessage([text('{"recommendations":[null]}')])))
      ).rejects.toThrow(/^Claude's reply did not include a recommendations list/);
    });

    it('keeps an empty list as an empty list', async () => {
      await expect(callClaude(claudeFetch(claudeMessage([text('{"recommendations":[]}')])))).resolves.toEqual({
        recommendations: [],
      });
    });
  });
});
