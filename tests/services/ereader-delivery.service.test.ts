/**
 * Component: E-Reader Delivery Queueing Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const configMock = vi.hoisted(() => ({ get: vi.fn(), getBackendMode: vi.fn() }));
const jobQueueMock = vi.hoisted(() => ({ addSendToEreaderJob: vi.fn() }));

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => configMock }));
vi.mock('@/lib/services/job-queue.service', () => ({ getJobQueueService: () => jobQueueMock }));

const logger = { info: vi.fn(), error: vi.fn() };

describe('queueEreaderDelivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.get.mockResolvedValue('true');
    configMock.getBackendMode.mockResolvedValue('audiobookshelf');
    jobQueueMock.addSendToEreaderJob.mockResolvedValue('job-1');
  });

  it('queues the job with the given users and delay', async () => {
    const { queueEreaderDelivery } = await import('@/lib/services/ereader-delivery.service');

    await queueEreaderDelivery('ebook-req', logger, { userIds: ['u-1'], delaySeconds: 0 });

    expect(configMock.get).toHaveBeenCalledWith('ebook_ereader_auto_send_enabled');
    expect(jobQueueMock.addSendToEreaderJob).toHaveBeenCalledWith('ebook-req', ['u-1'], 0);
  });

  it('does nothing when delivery is off or the backend is Plex', async () => {
    const { queueEreaderDelivery } = await import('@/lib/services/ereader-delivery.service');

    configMock.get.mockResolvedValueOnce('false');
    await queueEreaderDelivery('ebook-req', logger);
    configMock.getBackendMode.mockResolvedValueOnce('plex');
    await queueEreaderDelivery('ebook-req', logger);

    expect(jobQueueMock.addSendToEreaderJob).not.toHaveBeenCalled();
  });

  it('never throws when queueing fails', async () => {
    jobQueueMock.addSendToEreaderJob.mockRejectedValue(new Error('redis down'));
    const { queueEreaderDelivery } = await import('@/lib/services/ereader-delivery.service');

    await expect(queueEreaderDelivery('ebook-req', logger)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
