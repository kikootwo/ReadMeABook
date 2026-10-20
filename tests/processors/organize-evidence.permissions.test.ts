/**
 * Component: Organize Import Evidence Tests - permission warnings
 * Documentation: documentation/phase3/file-organization.md
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/config.service', () => ({ getConfigService: () => ({ get: vi.fn() }) }));
vi.mock('@/lib/processors/organize-cleanup-guard', () => ({ planDownloadCleanup: vi.fn() }));

import { importStatusMessage, reportImportStatus } from '@/lib/processors/organize-evidence';
import type { ImportEvidence } from '@/lib/utils/import-inventory';

const inventory = { kind: 'audio' as const, files: ['/d/a.mp3', '/d/b.mp3'], complete: true };
const copied = (name: string) => ({ source: `/d/${name}`, target: `/m/${name}`, status: 'copied' as const, verified: true });

function evidence(overrides: Partial<ImportEvidence>): ImportEvidence {
  return { records: [copied('a.mp3'), copied('b.mp3')], inventory, ...overrides };
}

function loggerStub() {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as any;
}

describe('import status with permission warnings', () => {
  it('has no message for a full import without warnings', () => {
    expect(importStatusMessage(evidence({}))).toBeNull();
  });

  it('notes refused permissions on an otherwise complete import', () => {
    expect(importStatusMessage(evidence({ permissionWarnings: ['w1', 'w2'] })))
      .toBe('permissions could not be applied to 2 files');
    expect(importStatusMessage(evidence({ permissionWarnings: ['w1'] })))
      .toBe('permissions could not be applied to 1 file');
  });

  it('appends the note to a partial-import message', () => {
    const records = [copied('a.mp3'), { ...copied('b.mp3'), status: 'failed' as const, verified: false, reason: 'x' }];
    expect(importStatusMessage(evidence({ records, permissionWarnings: ['w1'] })))
      .toBe('1 of 2 files not imported; source files kept; permissions could not be applied to 1 file');
  });

  it('logs one permission summary per job, however many files were affected', () => {
    const logger = loggerStub();
    const warnings = ['Could not set permissions 664 on /m/a.mp3 (EPERM)', 'Could not set permissions 664 on /m/b.mp3 (EPERM)', 'third'];

    const message = reportImportStatus(evidence({ permissionWarnings: warnings }), logger);

    expect(message).toBe('permissions could not be applied to 3 files');
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toBe(
      'Permissions could not be applied to 3 file(s): Could not set permissions 664 on /m/a.mp3 (EPERM) (and 2 more)'
    );
  });
});
