/**
 * Component: BookDate callAI Request and Provider Tests
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
  SHAPE,
  MODELS_URL,
  MESSAGES_URL,
  thinking,
  text,
  claudeMessage,
  modelInfo,
  jsonResponse,
  claudeFetch,
  chatCompletion,
  callClaude,
  messagesBody,
  type ModelLookup,
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

describe('callAI: requests, effort lookup, OpenAI and custom', () => {
  beforeEach(() => {
    vi.resetModules();
    loggerMock.create.mockReturnValue(logSpy);
    encryptionMock.decrypt.mockReturnValue('api-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('Claude request and effort', () => {
    it('states the JSON shape, keeps max_tokens 8192, sends no thinking field', async () => {
      const fetchMock = claudeFetch(claudeMessage([thinking(), text(RECS_JSON)]));
      await callClaude(fetchMock);
      const body = messagesBody(fetchMock);
      expect(body.messages[0].content).toContain(SHAPE);
      expect(body.max_tokens).toBe(8192);
      expect(body).not.toHaveProperty('thinking');
    });

    it('sends effort low when the model reports low effort support', async () => {
      const fetchMock = claudeFetch(claudeMessage([text(RECS_JSON)]));
      await callClaude(fetchMock);
      expect(messagesBody(fetchMock).output_config).toEqual({ effort: 'low' });
      const lookup = fetchMock.mock.calls.find((c) => String(c[0]).startsWith(MODELS_URL))!;
      expect(lookup[0]).toBe(`${MODELS_URL}claude-haiku-5-5`);
      expect(lookup[1].headers).toEqual({ 'x-api-key': 'api-key', 'anthropic-version': '2023-06-01' });
      expect(lookup[1].signal).toBeInstanceOf(AbortSignal);
    });

    it('sends no effort when the model does not support it', async () => {
      const fetchMock = claudeFetch(claudeMessage([text(RECS_JSON)]), { body: modelInfo('claude-haiku-4-5', false) });
      await callClaude(fetchMock, 'claude-haiku-4-5');
      expect(messagesBody(fetchMock)).not.toHaveProperty('output_config');
    });

    it.each([
      ['a 404', { status: 404, body: { type: 'error', error: { type: 'not_found_error', message: 'model' } } }],
      ['a network error', { reject: new Error('fetch failed') }],
      ['a timeout', { reject: Object.assign(new Error('timed out'), { name: 'TimeoutError' }) }],
      ['a null capabilities object', { body: { ...modelInfo('claude-haiku-5-5', true), capabilities: null } }],
    ])('sends no effort and still answers when the lookup returns %s', async (_label, lookup: ModelLookup) => {
      const fetchMock = claudeFetch(claudeMessage([text(RECS_JSON)]), lookup);
      await expect(callClaude(fetchMock)).resolves.toEqual(RECS);
      expect(messagesBody(fetchMock)).not.toHaveProperty('output_config');
    });

    it('caches a successful lookup per model, but retries after a failure', async () => {
      vi.stubGlobal('fetch', claudeFetch(claudeMessage([text(RECS_JSON)])));
      const { callAI } = await import('@/lib/bookdate/helpers');
      await callAI('claude', 'claude-haiku-5-5', 'enc-key', '{}');
      await callAI('claude', 'claude-haiku-5-5', 'enc-key', '{}');
      const okFetch = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      expect(okFetch.mock.calls.filter((c) => String(c[0]).startsWith(MODELS_URL))).toHaveLength(1);

      const failing = claudeFetch(claudeMessage([text(RECS_JSON)]), { status: 500 });
      vi.stubGlobal('fetch', failing);
      await callAI('claude', 'claude-opus-5-5', 'enc-key', '{}');
      await callAI('claude', 'claude-opus-5-5', 'enc-key', '{}');
      expect(failing.mock.calls.filter((c) => String(c[0]).startsWith(MODELS_URL))).toHaveLength(2);
    });

    it('shares one in-flight lookup between concurrent calls', async () => {
      const fetchMock = claudeFetch(claudeMessage([text(RECS_JSON)]));
      vi.stubGlobal('fetch', fetchMock);
      const { callAI } = await import('@/lib/bookdate/helpers');
      await Promise.all([
        callAI('claude', 'claude-haiku-5-5', 'enc-key', '{}'),
        callAI('claude', 'claude-haiku-5-5', 'enc-key', '{}'),
        callAI('claude', 'claude-haiku-5-5', 'enc-key', '{}'),
      ]);
      expect(fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(MODELS_URL))).toHaveLength(1);
      const bodies = fetchMock.mock.calls.filter((c) => c[0] === MESSAGES_URL).map((c) => JSON.parse(c[1].body));
      expect(bodies.map((b) => b.output_config)).toEqual([{ effort: 'low' }, { effort: 'low' }, { effort: 'low' }]);
    });

    it('cancels the body of a failed lookup', async () => {
      const cancel = vi.fn().mockResolvedValue(undefined);
      const fetchMock = vi.fn(async (url: string) =>
        url.startsWith(MODELS_URL)
          ? { ok: false, status: 403, body: { cancel }, json: vi.fn() }
          : jsonResponse(claudeMessage([text(RECS_JSON)]))
      );
      await expect(callClaude(fetchMock)).resolves.toEqual(RECS);
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it('gives up on a lookup that never answers after 10 s and continues without effort', async () => {
      vi.useFakeTimers();
      try {
        const fetchMock = vi.fn((url: string, init: { signal: AbortSignal }) => {
          if (url.startsWith(MODELS_URL)) {
            return new Promise((_, reject) =>
              init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
            );
          }
          return Promise.resolve(jsonResponse(claudeMessage([text(RECS_JSON)])));
        });
        vi.stubGlobal('fetch', fetchMock);
        const { callAI } = await import('@/lib/bookdate/helpers');
        const result = callAI('claude', 'claude-haiku-5-5', 'enc-key', '{}');

        await vi.advanceTimersByTimeAsync(9_999);
        expect(fetchMock.mock.calls.some((c) => c[0] === MESSAGES_URL)).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toEqual(RECS);
        expect(messagesBody(fetchMock)).not.toHaveProperty('output_config');
      } finally {
        vi.useRealTimers();
      }
    });

    it('logs model, stop reason and token counts only', async () => {
      await callClaude(claudeFetch(claudeMessage([thinking(), text(RECS_JSON)])));
      expect(logSpy.info).toHaveBeenCalledWith('Claude response received', {
        model: 'claude-haiku-5-5',
        effort: 'low',
        stopReason: 'end_turn',
        outputTokens: 900,
        thinkingTokens: 400,
      });
    });
  });

  describe('OpenAI and custom providers', () => {
    async function callChat(provider: 'openai' | 'custom', ...responses: unknown[]) {
      const fetchMock = vi.fn();
      for (const r of responses) fetchMock.mockResolvedValueOnce(r);
      vi.stubGlobal('fetch', fetchMock);
      const { callAI } = await import('@/lib/bookdate/helpers');
      const result = callAI(provider, 'test-model', 'enc-key', '{}', provider === 'custom' ? 'http://llm.local/v1' : null);
      result.catch(() => {}); // handled here; each test asserts on the same promise
      return { result, fetchMock };
    }

    it('OpenAI: reports a refusal as declined without echoing it', async () => {
      const { result } = await callChat('openai', jsonResponse(chatCompletion(null, 'stop', 'SECRET-REFUSAL-TEXT')));
      await expect(result).rejects.toThrow(/^OpenAI declined/);
      await expect(result).rejects.not.toThrow(/SECRET-REFUSAL-TEXT/);
    });

    it('OpenAI: reports finish_reason length as cut off', async () => {
      const { result } = await callChat('openai', jsonResponse(chatCompletion('', 'length')));
      await expect(result).rejects.toThrow(/^OpenAI's reply was cut off/);
    });

    it('custom: rejects null content with a clear message', async () => {
      const { result } = await callChat('custom', jsonResponse(chatCompletion(null, 'stop')));
      await expect(result).rejects.toThrow(/^Custom provider returned no recommendations \(stop reason: stop\)/);
      await expect(result).rejects.toMatchObject({ name: 'AIResponseError' });
    });

    it('custom: still wraps non-reply errors with the provider prefix', async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'));
      vi.stubGlobal('fetch', fetchMock);
      const { callAI } = await import('@/lib/bookdate/helpers');
      await expect(callAI('custom', 'test-model', 'enc-key', '{}', 'http://llm.local/v1')).rejects.toThrow(
        /^Custom provider error: connect ECONNREFUSED$/
      );
    });

    it('custom: parses complete JSON followed by padding when finish_reason is length', async () => {
      const { result } = await callChat('custom', jsonResponse(chatCompletion(RECS_JSON + '\n'.repeat(400), 'length')));
      await expect(result).resolves.toEqual(RECS);
    });

    it('custom: reports partial JSON with finish_reason length as cut off', async () => {
      const { result } = await callChat('custom', jsonResponse(chatCompletion('{"recommendations":[{"ti', 'length')));
      await expect(result).rejects.toThrow(/^Custom provider's reply was cut off/);
    });

    it('custom: joins an array of text content parts', async () => {
      const parts = [{ type: 'text', text: RECS_JSON.slice(0, 25) }, { type: 'text', text: RECS_JSON.slice(25) }];
      const { result } = await callChat('custom', jsonResponse(chatCompletion(parts, 'stop')));
      await expect(result).resolves.toEqual(RECS);
    });

    it('custom: rejects null content on the retry path too', async () => {
      const { result } = await callChat(
        'custom',
        { ok: false, status: 400, text: vi.fn().mockResolvedValue('response_format not supported') },
        jsonResponse(chatCompletion(null, 'stop'))
      );
      await expect(result).rejects.toThrow(/^Custom provider returned no recommendations/);
    });

    it('custom: rejects an empty choices array', async () => {
      const { result } = await callChat('custom', jsonResponse({ ...chatCompletion(null, 'stop'), choices: [] }));
      await expect(result).rejects.toThrow(/Custom provider returned no recommendations \(stop reason: unknown\)/);
    });

    it('custom: does not show a non-code finish_reason', async () => {
      const { result } = await callChat('custom', jsonResponse(chatCompletion(null, '<img src=x onerror=alert(1)>')));
      await expect(result).rejects.toThrow(/stop reason: unknown/);
      await expect(result).rejects.not.toThrow(/onerror/);
    });

    it('custom: parses a bare ``` fence', async () => {
      const { result } = await callChat('custom', jsonResponse(chatCompletion('```\n' + RECS_JSON + '\n```', 'stop')));
      await expect(result).resolves.toEqual(RECS);
    });

    it('custom: states the JSON shape in the fallback prompt', async () => {
      const { result, fetchMock } = await callChat(
        'custom',
        { ok: false, status: 400, text: vi.fn().mockResolvedValue('json_schema not supported') },
        jsonResponse(chatCompletion(RECS_JSON, 'stop'))
      );
      await expect(result).resolves.toEqual(RECS);
      const retryBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(retryBody).not.toHaveProperty('response_format');
      expect(retryBody.messages[0].content).toContain(SHAPE);
    });
  });
});
