/**
 * Component: BookDate AI Response Extraction
 * Documentation: documentation/features/bookdate.md
 *
 * Turns a raw provider response into the recommendations object, or throws an
 * AIResponseError whose message is safe to show on the BookDate page. Messages
 * never include reply text, refusal text or reasoning content.
 */

import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('BookDate.AIResponse');

/** Exact output shape, stated in prompts that do not carry a JSON schema. */
export const RECOMMENDATIONS_JSON_INSTRUCTION =
  'Respond with a JSON object exactly of the form ' +
  '{"recommendations":[{"title":"...","author":"...","reason":"..."}]}.';

const RETRY_HINT =
  'Try again. If it keeps happening, an admin can choose a different model under Settings > BookDate.';

export class AIResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIResponseError';
  }
}

/** Provider-supplied reason codes are shown only when they look like a plain code. */
function safeReason(value: unknown): string {
  return typeof value === 'string' && /^[a-z_]{1,32}$/i.test(value) ? value : 'unknown';
}

function declined(label: string): AIResponseError {
  return new AIResponseError(
    `${label} declined to give recommendations. Try again, or change Special Requests in your BookDate Preferences.`
  );
}

function cutOff(label: string): AIResponseError {
  return new AIResponseError(
    `${label}'s reply was cut off before the recommendations were complete. ${RETRY_HINT}`
  );
}

function noText(label: string, reason: unknown): AIResponseError {
  return new AIResponseError(
    `${label} returned no recommendations (stop reason: ${safeReason(reason)}). ${RETRY_HINT}`
  );
}

function joinTextParts(parts: unknown[]): string {
  return parts
    .filter((p): p is { type: 'text'; text: string } =>
      !!p && typeof p === 'object' &&
      (p as { type?: unknown }).type === 'text' &&
      typeof (p as { text?: unknown }).text === 'string')
    .map((p) => p.text)
    .join('');
}

/**
 * Claude Messages API: the answer is the concatenation of every `type: "text"`
 * block. `thinking` / `redacted_thinking` blocks (returned by default on current
 * models) are skipped.
 */
export function extractClaudeText(data: unknown): string {
  const body = (data ?? {}) as { content?: unknown; stop_reason?: unknown };
  const stopReason = body.stop_reason;
  const content = body.content;

  if (!Array.isArray(content)) {
    logger.warn('Claude response has no content array', { stopReason: safeReason(stopReason) });
    throw new AIResponseError(`Claude returned an unexpected response. ${RETRY_HINT}`);
  }

  const blockTypes = content.map((b) => safeReason((b as { type?: unknown } | null)?.type));
  const fail = (error: AIResponseError): never => {
    logger.warn('Claude response has no usable text', { stopReason: safeReason(stopReason), blockTypes });
    throw error;
  };

  if (stopReason === 'refusal') fail(declined('Claude'));
  if (stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded') fail(cutOff('Claude'));

  const text = joinTextParts(content);
  if (text.trim() === '') fail(noText('Claude', stopReason));
  return text;
}

/** Token counts from a Claude response, for logging. Numbers only, never content. */
export function describeClaudeUsage(data: unknown): {
  stopReason: string;
  outputTokens: number | null;
  thinkingTokens: number | null;
} {
  const body = (data ?? {}) as {
    stop_reason?: unknown;
    usage?: { output_tokens?: unknown; output_tokens_details?: { thinking_tokens?: unknown } };
  };
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    stopReason: safeReason(body.stop_reason),
    outputTokens: num(body.usage?.output_tokens),
    thinkingTokens: num(body.usage?.output_tokens_details?.thinking_tokens),
  };
}

/**
 * OpenAI Chat Completions shape (OpenAI and OpenAI-compatible custom providers).
 * Guards null content (reasoning models, refusals) and `finish_reason: "length"`.
 */
export function extractChatCompletionText(data: unknown, label: 'OpenAI' | 'Custom provider'): string {
  const body = (data ?? {}) as { choices?: unknown };
  const choice = Array.isArray(body.choices) ? body.choices[0] : undefined;
  const finishReason = (choice as { finish_reason?: unknown } | undefined)?.finish_reason;
  const message = (choice as { message?: { content?: unknown; refusal?: unknown } } | undefined)?.message;

  const fail = (error: AIResponseError): never => {
    logger.warn(`${label} response has no usable text`, {
      finishReason: safeReason(finishReason),
      hasChoice: !!choice,
    });
    throw error;
  };

  if (!choice) fail(noText(label, undefined));
  if (typeof message?.refusal === 'string' && message.refusal.trim() !== '') fail(declined(label));
  if (finishReason === 'content_filter') fail(declined(label));
  if (finishReason === 'length') fail(cutOff(label));

  const content = message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? joinTextParts(content) : '';
  if (text.trim() === '') fail(noText(label, finishReason));
  return text;
}

/**
 * Parse the reply text: trim, strip an optional ```json / ``` fence, trim, parse.
 * Requires an object with a `recommendations` array.
 */
export function parseRecommendationsJson<T>(text: string, label: string): { recommendations: T[] } {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn(`${label} reply was not valid JSON`, { length: cleaned.length });
    throw new AIResponseError(`${label}'s reply was not valid JSON. ${RETRY_HINT}`);
  }

  const recommendations =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { recommendations?: unknown }).recommendations
      : undefined;
  if (!Array.isArray(recommendations)) {
    logger.warn(`${label} reply has no recommendations array`, {
      kind: Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed,
    });
    throw new AIResponseError(`${label}'s reply did not include a recommendations list. ${RETRY_HINT}`);
  }
  return parsed as { recommendations: T[] };
}
