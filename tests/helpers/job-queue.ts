/**
 * Component: Job Queue Mock Factory
 * Documentation: documentation/backend/services/jobs.md
 */

import { vi } from 'vitest';

export const createJobQueueMock = () => ({
  addSearchJob: vi.fn(),
  addSearchEbookJob: vi.fn(),
  addDownloadJob: vi.fn(),
  addMonitorJob: vi.fn(),
  addOrganizeJob: vi.fn(),
  addPlexScanJob: vi.fn(),
  addPlexMatchJob: vi.fn(),
  addPlexRecentlyAddedJob: vi.fn(),
  addMonitorRssFeedsJob: vi.fn(),
  addAudibleRefreshJob: vi.fn(),
  addRetryMissingTorrentsJob: vi.fn(),
  addRetryFailedImportsJob: vi.fn(),
  addFindMissingEbooksJob: vi.fn(),
  addCleanupSeededTorrentsJob: vi.fn(),
  addNotificationJob: vi.fn().mockResolvedValue(undefined),
});
