/**
 * Component: BookDate callAI Response Handling Tests
 * Documentation: documentation/features/bookdate.md
 *
 * Every provider response here is a mock. None of it was checked against a live API.
 * The mocks follow the shapes in the official docs:
 * - Messages API response (typed content blocks, stop_reason, stop_details, usage):
 *   https://platform.claude.com/docs/en/api/messages
 * - Thinking blocks under display "omitted" (empty `thinking`, encrypted `signature`)
 *   and `redacted_thinking` blocks: https://platform.claude.com/docs/en/build-with-claude/thinking
 * - Stop reasons (refusal, max_tokens, model_context_window_exceeded):
 *   https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
 * - usage.output_tokens_details.thinking_tokens:
 *   https://platform.claude.com/docs/en/build-with-claude/extended-thinking
 * - GET /v1/models/{model_id} (ModelInfo, capabilities.effort.low.supported):
 *   https://platform.claude.com/docs/en/api/models/retrieve
 * - OpenAI chat completion object (choices[].message.content / refusal, finish_reason):
 *   https://platform.openai.com/docs/api-reference/chat/object
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

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

const RECS = { recommendations: [{ title: 'Project Hail Mary', author: 'Andy Weir', reason: 'Liked The Martian' }] };
const RECS_JSON = JSON.stringify(RECS);
const SHAPE = '{"recommendations":[{"title":"...","author":"...","reason":"..."}]}';
const MODELS_URL = 'https://api.anthropic.com/v1/models/';
const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

const thinking = () => ({ type: 'thinking', thinking: '', signature: 'EosnCkYICxIMMb3LzNrMu...' });
const redacted = () => ({ type: 'redacted_thinking', data: 'EmwKAhgBEgy3va3pzix/LafPsn4a...' });
const text = (t: string) => ({ type: 'text', text: t, citations: null });

function claudeMessage(content: unknown[], stopReason = 'end_turn') {
  return {
    id: 'msg_01Test',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: stopReason === 'refusal' ? { type: 'refusal', category: null, explanation: null } : null,
    usage: { input_tokens: 1200, output_tokens: 900, output_tokens_details: { thinking_tokens: 400 } },
  };
}

const sup = (supported: boolean) => ({ supported });
function modelInfo(id: string, effortLow: boolean) {
  return {
    type: 'model',
    id,
    display_name: id,
    created_at: '2026-10-07T00:00:00Z',
    deprecated_at: null,
    lifecycle: 'active',
    line: 'haiku',
    max_input_tokens: 1000000,
    max_tokens: 128000,
    retires_at: null,
    capabilities: {
      batch: sup(true),
      citations: sup(true),
      code_execution: sup(true),
      context_management: { clear_thinking_20251015: sup(true), clear_tool_uses_20250919: sup(true), compact_20260112: sup(true), supported: true },
      effort: { supported: effortLow, low: sup(effortLow), medium: sup(effortLow), high: sup(effortLow), max: sup(effortLow), xhigh: sup(effortLow) },
      image_input: sup(true),
      pdf_input: sup(true),
      server_tools: { code_execution: sup(true), supported: true, web_search: sup(true) },
      structured_outputs: sup(true),
      thinking: { supported: true, types: { adaptive: sup(effortLow), between_tools: sup(false), disabled: sup(true), enabled: sup(!effortLow) } },
    },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body), text: vi.fn().mockResolvedValue(JSON.stringify(body)) };
}

type ModelLookup = { status?: number; body?: unknown; reject?: Error };
function claudeFetch(message: unknown, lookup: ModelLookup = { body: modelInfo('claude-haiku-5-5', true) }) {
  return vi.fn(async (url: string) => {
    if (url.startsWith(MODELS_URL)) {
      if (lookup.reject) throw lookup.reject;
      return jsonResponse(lookup.body ?? { type: 'error' }, lookup.status ?? 200);
    }
    if (url === MESSAGES_URL) return jsonResponse(message);
    throw new Error(`unexpected url ${url}`);
  });
}

function chatCompletion(content: unknown, finishReason: string, refusal: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1760000000,
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal }, logprobs: null, finish_reason: finishReason }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
  };
}

async function callClaude(fetchMock: ReturnType<typeof vi.fn>, model = 'claude-haiku-5-5') {
  vi.stubGlobal('fetch', fetchMock);
  const { callAI } = await import('@/lib/bookdate/helpers');
  return callAI('claude', model, 'enc-key', '{}');
}

const messagesBody = (fetchMock: ReturnType<typeof vi.fn>) => {
  const call = fetchMock.mock.calls.find((c) => c[0] === MESSAGES_URL);
  return JSON.parse(call![1].body);
};

describe('callAI response handling', () => {
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
      await expect(result).rejects.toThrow(
        /^Custom provider error: Custom provider returned no recommendations \(stop reason: stop\)/
      );
    });

    it('custom: rejects null content on the retry path too', async () => {
      const { result } = await callChat(
        'custom',
        { ok: false, status: 400, text: vi.fn().mockResolvedValue('response_format not supported') },
        jsonResponse(chatCompletion(null, 'stop'))
      );
      await expect(result).rejects.toThrow(/^Custom provider error: Custom provider returned no recommendations/);
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
