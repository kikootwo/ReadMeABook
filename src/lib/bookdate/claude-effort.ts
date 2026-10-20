/**
 * Component: BookDate Claude Model Capability Lookup
 * Documentation: documentation/features/bookdate.md
 *
 * Current Claude models think by default, and thinking tokens count against
 * max_tokens. When the chosen model supports it, BookDate asks for low effort to
 * keep thinking short. Support is read from GET /v1/models/{id}
 * (capabilities.effort.low.supported) and cached per model for the process.
 * Any lookup failure means no effort is sent, which is what older models need.
 */

import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('BookDate.ClaudeEffort');

const LOOKUP_TIMEOUT_MS = 10_000;
const lowEffortByModel = new Map<string, boolean>();

export async function supportsLowEffort(model: string, apiKey: string): Promise<boolean> {
  const cached = lowEffortByModel.get(model);
  if (cached !== undefined) return cached;

  try {
    const response = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });

    if (!response.ok) {
      logger.warn('Claude model lookup failed; sending no effort', { model, status: response.status });
      return false;
    }

    const info = (await response.json()) as {
      capabilities?: { effort?: { low?: { supported?: unknown } } } | null;
    } | null;
    const supported = info?.capabilities?.effort?.low?.supported === true;
    lowEffortByModel.set(model, supported);
    return supported;
  } catch (error) {
    logger.warn('Claude model lookup failed; sending no effort', {
      model,
      error: error instanceof Error ? error.name : 'unknown',
    });
    return false;
  }
}
