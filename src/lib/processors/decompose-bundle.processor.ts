/**
 * Component: Decompose-Bundle Job Processor
 * Documentation: documentation/features/series-bundle-decomposition.md
 *
 * Runs series-bundle fan-out off the request thread: enumerates the series'
 * books and creates a per-book request for each. Offloaded to a background job
 * so POST /api/requests returns immediately instead of blocking on up to
 * MAX_BUNDLE_BOOKS Audnexus lookups + notification/search enqueues.
 *
 * Falls back to creating the bundle as a single normal request when the series
 * cannot be enumerated, preserving the pre-async behaviour.
 */

import { createRequestForUser, decomposeBundle } from '../services/request-creator.service';
import { RMABLogger } from '../utils/logger';
import type { DecomposeBundlePayload } from '../services/job-queue.service';

export async function processDecomposeBundle(payload: DecomposeBundlePayload): Promise<void> {
  const { userId, bundle, seriesAsin, range, requestOptions, jobId } = payload;
  const logger = RMABLogger.forJob(jobId, 'DecomposeBundle');

  const result = await decomposeBundle(userId, bundle, seriesAsin, range, requestOptions);

  if (result) {
    logger.info(result.message);
    return;
  }

  // Enumeration produced no usable books — fall back to a single normal request
  // (matches the synchronous behaviour before the fan-out was offloaded). Marked
  // bundleDecomposed so it isn't re-detected and re-queued.
  logger.warn(`Bundle "${bundle.title}" enumerated no books; creating it as a single request`);
  await createRequestForUser(userId, bundle, { ...requestOptions, bundleDecomposed: true });
}
