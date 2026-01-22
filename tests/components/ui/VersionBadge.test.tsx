/**
 * Component: Version Badge Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { VersionBadge } from '@/components/ui/VersionBadge';

const originalCommit = process.env.NEXT_PUBLIC_GIT_COMMIT;

describe('VersionBadge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalCommit === undefined) {
      delete process.env.NEXT_PUBLIC_GIT_COMMIT;
    } else {
      process.env.NEXT_PUBLIC_GIT_COMMIT = originalCommit;
    }
  });

  it('renders short version from build-time commit', async () => {
    process.env.NEXT_PUBLIC_GIT_COMMIT = 'abcdef1234';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<VersionBadge />);

    expect(await screen.findByText('v.abcdef1')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to API when build-time commit is unavailable', async () => {
    process.env.NEXT_PUBLIC_GIT_COMMIT = 'unknown';
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ version: 'v.1.2.3' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<VersionBadge />);

    expect(await screen.findByText('v.1.2.3')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/version');
  });

  it('shows dev version when API fetch fails', async () => {
    process.env.NEXT_PUBLIC_GIT_COMMIT = 'unknown';
    const fetchMock = vi.fn().mockRejectedValue(new Error('down'));
    const errorMock = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);

    render(<VersionBadge />);

    await waitFor(() => {
      expect(screen.getByText('v.dev')).toBeInTheDocument();
    });
    expect(errorMock).toHaveBeenCalledWith('Failed to fetch version:', expect.any(Error));
  });
});
