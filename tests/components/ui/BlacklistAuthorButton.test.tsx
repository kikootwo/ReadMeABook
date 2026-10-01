/**
 * Component: BlacklistAuthorButton Tests
 * Documentation: documentation/admin-features/author-blacklist.md
 */

// @vitest-environment jsdom

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../helpers/render';

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ entries: [], count: 0 }),
  }),
}));

describe('BlacklistAuthorButton', () => {
  let BlacklistAuthorButton: typeof import('@/components/ui/BlacklistAuthorButton').BlacklistAuthorButton;

  beforeAll(async () => {
    ({ BlacklistAuthorButton } = await import(
      '@/components/ui/BlacklistAuthorButton'
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing for non-admin users', () => {
    const { container } = renderWithProviders(
      <BlacklistAuthorButton authorName="Stephen King" />,
      {
        auth: {
          user: {
            id: 'u1',
            plexId: 'plex-1',
            plexUsername: 'user',
            role: 'user',
          } as any,
          accessToken: 'token',
          isLoading: false,
        },
      }
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Blacklist Author/i)).not.toBeInTheDocument();
  });

  it('shows Blacklist Author for admins', async () => {
    renderWithProviders(<BlacklistAuthorButton authorName="Stephen King" />, {
      auth: {
        user: {
          id: 'admin-1',
          plexId: 'local-admin',
          plexUsername: 'admin',
          role: 'admin',
        } as any,
        accessToken: 'token',
        isLoading: false,
      },
    });

    expect(
      await screen.findByRole('button', { name: /Blacklist Author/i })
    ).toBeInTheDocument();
  });
});
