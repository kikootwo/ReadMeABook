/**
 * Component: E-Reader Delivery Queueing
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { getConfigService } from './config.service';
import { getJobQueueService } from './job-queue.service';
import type { RMABLogger } from '../utils/logger';

/** Ebook request statuses where the file is in the library and can be sent */
export const DELIVERABLE_EBOOK_STATUSES = ['downloaded', 'available'];

/**
 * Queue a send-to-ereader job when e-reader delivery is on and the backend is Audiobookshelf.
 * Never throws: delivery is a side effect and must not fail the caller.
 *
 * @param ebookRequestId - The ebook request
 * @param options.userIds - Only these users' devices (a late requester); omit for every requester
 * @param options.delaySeconds - Wait before the first attempt (default 30 s, for the ABS scan)
 * @param options.ebookFolder - Library folder the ebook was just put in (the organize job)
 */
export async function queueEreaderDelivery(
  ebookRequestId: string,
  logger: Pick<RMABLogger, 'info' | 'error'>,
  options: { userIds?: string[]; delaySeconds?: number; ebookFolder?: string } = {}
): Promise<void> {
  try {
    const configService = getConfigService();
    if ((await configService.get('ebook_ereader_auto_send_enabled')) !== 'true') return;
    if ((await configService.getBackendMode()) !== 'audiobookshelf') return;

    await getJobQueueService().addSendToEreaderJob(ebookRequestId, options.userIds, options.delaySeconds, options.ebookFolder);
    logger.info(`Queued e-reader delivery for ebook request ${ebookRequestId}`);
  } catch (error) {
    logger.error('Failed to queue e-reader delivery', { error: error instanceof Error ? error.message : String(error) });
  }
}
