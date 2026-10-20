/**
 * Component: BookDate Claude Model Capability Lookup
 * Documentation: documentation/features/bookdate.md
 *
 * Current Claude models think by default, and thinking tokens count against
 * max_tokens. When the chosen model supports it, BookDate asks for low effort to
 * keep thinking short. Support is read from GET /v1/models/{id}
 * (capabilities.effort.low.supported). The lookup promise is cached per model
 * for the process, so concurrent calls share one request; a failed lookup is
 * dropped from the cache (retried next time) and means no effort is sent, which
 * is what older models need.
 */

import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('BookDate.ClaudeEffort');

export const LOOKUP_TIMEOUT_MS = 10_000;
const lookups = new Map<string, Promise<boolean>>();

type LookupResult = { supported: boolean; cacheable: boolean };

async function lookUpLowEffort(model: string, apiKey: string): Promise<LookupResult> {
  // Own timer (not AbortSignal.timeout) so the bound also covers reading the body
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      // Release the pooled connection
      await response.body?.cancel().catch(() => {});
      logger.warn('Claude model lookup failed; sending no effort', { model, status: response.status });
      return { supported: false, cacheable: false };
    }

    const info = (await response.json()) as {
      capabilities?: { effort?: { low?: { supported?: unknown } } } | null;
    } | null;
    return { supported: info?.capabilities?.effort?.low?.supported === true, cacheable: true };
  } catch (error) {
    logger.warn('Claude model lookup failed; sending no effort', {
      model,
      error: controller.signal.aborted ? 'timeout' : error instanceof Error ? error.name : 'unknown',
    });
    return { supported: false, cacheable: false };
  } finally {
    clearTimeout(timer);
  }
}

export function supportsLowEffort(model: string, apiKey: string): Promise<boolean> {
  const existing = lookups.get(model);
  if (existing) return existing;

  const pending = lookUpLowEffort(model, apiKey).then(({ supported, cacheable }) => {
    if (!cacheable) lookups.delete(model);
    return supported;
  });
  lookups.set(model, pending);
  return pending;
}
