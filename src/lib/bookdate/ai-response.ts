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
 * Reply text plus whether the provider stopped at a token limit. A truncated
 * reply is still parsed: a complete JSON object followed by padding is usable,
 * and only a failed parse is reported as "cut off".
 */
export interface AIReply {
  text: string;
  truncated: boolean;
}

/**
 * Claude Messages API: the answer is the concatenation of every `type: "text"`
 * block. `thinking` / `redacted_thinking` blocks (returned by default on current
 * models) are skipped.
 */
export function extractClaudeText(data: unknown): AIReply {
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
  const truncated = stopReason === 'max_tokens' || stopReason === 'model_context_window_exceeded';

  const text = joinTextParts(content);
  if (text.trim() === '') fail(truncated ? cutOff('Claude') : noText('Claude', stopReason));
  return { text, truncated };
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
export function extractChatCompletionText(data: unknown, label: 'OpenAI' | 'Custom provider'): AIReply {
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
  const truncated = finishReason === 'length';

  const content = message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) ? joinTextParts(content) : '';
  if (text.trim() === '') fail(truncated ? cutOff(label) : noText(label, finishReason));
  return { text, truncated };
}

const isUsableItem = (item: unknown): boolean => {
  const rec = item as { title?: unknown; author?: unknown } | null;
  return !!rec && typeof rec === 'object' && !Array.isArray(rec) &&
    typeof rec.title === 'string' && rec.title.trim() !== '' &&
    typeof rec.author === 'string' && rec.author.trim() !== '';
};

/**
 * Parse the reply text: trim, strip an optional ```json / ``` fence, trim, parse.
 * Requires an object with a `recommendations` array; items without a string
 * title and author are dropped. A truncated reply that fails to parse is
 * reported as cut off.
 */
export function parseRecommendationsJson<T>(reply: AIReply, label: string): { recommendations: T[] } {
  const cleaned = reply.text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    logger.warn(`${label} reply was not valid JSON`, { length: cleaned.length, truncated: reply.truncated });
    throw reply.truncated ? cutOff(label) : new AIResponseError(`${label}'s reply was not valid JSON. ${RETRY_HINT}`);
  }

  const recommendations =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as { recommendations?: unknown }).recommendations
      : undefined;
  if (!Array.isArray(recommendations)) {
    logger.warn(`${label} reply has no recommendations array`, {
      kind: Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed,
    });
    throw noList(label);
  }

  const usable = recommendations.filter(isUsableItem);
  if (usable.length < recommendations.length) {
    logger.warn(`${label} reply had unusable recommendation items`, {
      dropped: recommendations.length - usable.length,
      kept: usable.length,
    });
    if (usable.length === 0) throw noList(label);
  }
  return { ...(parsed as object), recommendations: usable as T[] };
}

function noList(label: string): AIResponseError {
  return new AIResponseError(`${label}'s reply did not include a recommendations list. ${RETRY_HINT}`);
}
