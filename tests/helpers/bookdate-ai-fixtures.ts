/**
 * Component: BookDate callAI Test Fixtures
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

import { vi } from 'vitest';

export const RECS = { recommendations: [{ title: 'Project Hail Mary', author: 'Andy Weir', reason: 'Liked The Martian' }] };
export const RECS_JSON = JSON.stringify(RECS);
export const SHAPE = '{"recommendations":[{"title":"...","author":"...","reason":"..."}]}';
export const MODELS_URL = 'https://api.anthropic.com/v1/models/';
export const MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

export const thinking = () => ({ type: 'thinking', thinking: '', signature: 'EosnCkYICxIMMb3LzNrMu...' });
export const redacted = () => ({ type: 'redacted_thinking', data: 'EmwKAhgBEgy3va3pzix/LafPsn4a...' });
export const text = (t: string) => ({ type: 'text', text: t, citations: null });

export function claudeMessage(content: unknown[], stopReason = 'end_turn') {
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
export function modelInfo(id: string, effortLow: boolean) {
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

export function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: vi.fn().mockResolvedValue(body), text: vi.fn().mockResolvedValue(JSON.stringify(body)) };
}

export type ModelLookup = { status?: number; body?: unknown; reject?: Error };
export function claudeFetch(message: unknown, lookup: ModelLookup = { body: modelInfo('claude-haiku-5-5', true) }) {
  return vi.fn(async (url: string) => {
    if (url.startsWith(MODELS_URL)) {
      if (lookup.reject) throw lookup.reject;
      return jsonResponse(lookup.body ?? { type: 'error' }, lookup.status ?? 200);
    }
    if (url === MESSAGES_URL) return jsonResponse(message);
    throw new Error(`unexpected url ${url}`);
  });
}

export function chatCompletion(content: unknown, finishReason: string, refusal: string | null = null) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1760000000,
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content, refusal }, logprobs: null, finish_reason: finishReason }],
    usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
  };
}

export async function callClaude(fetchMock: ReturnType<typeof vi.fn>, model = 'claude-haiku-5-5') {
  vi.stubGlobal('fetch', fetchMock);
  const { callAI } = await import('@/lib/bookdate/helpers');
  return callAI('claude', model, 'enc-key', '{}');
}

export const messagesBody = (fetchMock: ReturnType<typeof vi.fn>) => {
  const call = fetchMock.mock.calls.find((c) => c[0] === MESSAGES_URL);
  return JSON.parse(call![1].body);
};
