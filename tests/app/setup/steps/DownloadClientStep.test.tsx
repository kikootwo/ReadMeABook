/**
 * Component: Setup Download Client Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadClientStep } from '@/app/setup/steps/DownloadClientStep';

interface DownloadClient {
  id: string;
  type: 'qbittorrent' | 'sabnzbd' | 'transmission';
  name: string;
  enabled: boolean;
  url: string;
  username?: string;
  password: string;
  disableSSLVerify: boolean;
  remotePathMappingEnabled: boolean;
  remotePath?: string;
  localPath?: string;
  category?: string;
}

const DownloadClientHarness = ({
  onNext,
  onBack,
  initialClients = [],
}: {
  onNext: () => void;
  onBack: () => void;
  initialClients?: DownloadClient[];
}) => {
  const [downloadClients, setDownloadClients] = useState<DownloadClient[]>(initialClients);

  return (
    <DownloadClientStep
      downloadClients={downloadClients}
      onUpdate={(field, value) => {
        if (field === 'downloadClients') {
          setDownloadClients(value);
        }
      }}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

// Helper to create a mock client
const createMockClient = (overrides: Partial<DownloadClient> = {}): DownloadClient => ({
  id: 'test-client-1',
  type: 'qbittorrent',
  name: 'qBittorrent',
  enabled: true,
  url: 'http://localhost:8080',
  username: 'admin',
  password: 'secret',
  disableSSLVerify: false,
  remotePathMappingEnabled: false,
  category: 'readmeabook',
  ...overrides,
});

describe('DownloadClientStep', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('shows empty state when no clients configured', () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      expect(screen.getByText('No download clients configured yet')).toBeInTheDocument();
      expect(screen.getByText('Add at least one client to start downloading audiobooks')).toBeInTheDocument();
    });

    it('shows Add qBittorrent and Add SABnzbd buttons', () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      expect(screen.getByRole('button', { name: /Add qBittorrent/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add SABnzbd/i })).toBeInTheDocument();
    });

    it('displays configured clients when provided', () => {
      const mockClient = createMockClient({ name: 'My qBittorrent' });
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} initialClients={[mockClient]} />);

      expect(screen.getByText('My qBittorrent')).toBeInTheDocument();
      expect(screen.queryByText('No download clients configured yet')).not.toBeInTheDocument();
    });
  });

  describe('Adding a qBittorrent Client', () => {
    it('opens modal when clicking Add qBittorrent', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });
    });

    it('shows correct form fields for qBittorrent', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // qBittorrent should show Name, URL, Username, Password
      expect(screen.getByText('Name')).toBeInTheDocument();
      expect(screen.getByText('URL')).toBeInTheDocument();
      expect(screen.getByText('Username')).toBeInTheDocument();
      expect(screen.getByText('Password')).toBeInTheDocument();
      expect(screen.getByText('Category')).toBeInTheDocument();
    });

    it('validates required fields before testing connection', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Click Test Connection without filling required fields
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      // Should show validation errors
      await waitFor(() => {
        expect(screen.getByText(/URL is required/i)).toBeInTheDocument();
      });

      // fetch should not have been called
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('tests connection and shows success message', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'Connected to qBittorrent v4.5.0' }),
      });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Fill in required fields
      const urlInput = screen.getByPlaceholderText('http://localhost:8080');
      const usernameInput = screen.getByPlaceholderText('admin');
      const passwordInput = screen.getByPlaceholderText('Password');

      fireEvent.change(urlInput, { target: { value: 'http://localhost:8080' } });
      fireEvent.change(usernameInput, { target: { value: 'admin' } });
      fireEvent.change(passwordInput, { target: { value: 'secret' } });

      // Test connection
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-download-client', expect.any(Object));
      });

      await waitFor(() => {
        expect(screen.getByText(/Connected to qBittorrent v4.5.0/i)).toBeInTheDocument();
      });
    });

    it('shows error message when connection test fails', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Invalid credentials' }),
      });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Fill in required fields
      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://localhost:8080' },
      });
      fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong' } });

      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Invalid credentials/i)).toBeInTheDocument();
      });
    });

    it('enables save button only after successful connection test', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'Connected successfully!' }),
      });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Add Client button should be disabled initially
      const addButton = screen.getByRole('button', { name: /Add Client/i });
      expect(addButton).toBeDisabled();

      // Fill and test
      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://localhost:8080' },
      });
      fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Connected successfully!/i)).toBeInTheDocument();
      });

      // Now Add Client should be enabled
      expect(addButton).not.toBeDisabled();
    });

    it('adds client to list after saving', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'Connected successfully!' }),
      });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Fill and test
      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://localhost:8080' },
      });
      fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } });
      fireEvent.change(screen.getByPlaceholderText('readmeabook'), { target: { value: 'audiobooks' } });
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Connected successfully!/i)).toBeInTheDocument();
      });

      // Save the client
      fireEvent.click(screen.getByRole('button', { name: /Add Client/i }));

      // Modal should close and client should appear in list
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Add qBittorrent/i })).not.toBeInTheDocument();
      });

      // Client should be in the configured clients list
      expect(screen.getByText('Configured Clients')).toBeInTheDocument();
      // The client name should be visible in the configured clients section
      const configuredSection = screen.getByText('Configured Clients').parentElement;
      expect(configuredSection).toBeInTheDocument();
      // There should be edit/delete buttons for the configured client
      expect(screen.getByTitle('Edit client')).toBeInTheDocument();
      expect(screen.getByTitle('Delete client')).toBeInTheDocument();
      expect(screen.getByText('Category: audiobooks')).toBeInTheDocument();
    });
  });

  describe('Adding a SABnzbd Client', () => {
    it('opens modal when clicking Add SABnzbd', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add SABnzbd/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add SABnzbd/i })).toBeInTheDocument();
      });
    });

    it('shows API Key field instead of Username for SABnzbd', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add SABnzbd/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add SABnzbd/i })).toBeInTheDocument();
      });

      // SABnzbd should show API Key, not Username
      expect(screen.getByText('API Key')).toBeInTheDocument();
      expect(screen.getByText('Category')).toBeInTheDocument();
      expect(screen.queryByText('Username')).not.toBeInTheDocument();
    });

    it('validates API key is required for SABnzbd', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add SABnzbd/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add SABnzbd/i })).toBeInTheDocument();
      });

      // Fill URL but not API key
      fireEvent.change(screen.getByPlaceholderText('http://localhost:8081'), {
        target: { value: 'http://localhost:8081' },
      });

      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/API key is required/i)).toBeInTheDocument();
      });
    });
  });

  describe('SSL Verification Toggle', () => {
    it('shows SSL toggle only for HTTPS URLs', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // SSL toggle should not be visible for HTTP
      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://localhost:8080' },
      });

      expect(screen.queryByText(/Disable SSL certificate verification/i)).not.toBeInTheDocument();

      // Change to HTTPS - SSL toggle should appear
      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'https://localhost:8080' },
      });

      await waitFor(() => {
        expect(screen.getByText(/Disable SSL certificate verification/i)).toBeInTheDocument();
      });
    });
  });

  describe('Remote Path Mapping', () => {
    it('shows remote path fields when enabled', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Remote path fields should not be visible initially
      expect(screen.queryByText(/Remote Path \(qBittorrent\)/i)).not.toBeInTheDocument();

      // Enable remote path mapping
      const toggle = screen.getByLabelText(/Enable Remote Path Mapping/i);
      fireEvent.click(toggle);

      // Now remote path fields should be visible
      await waitFor(() => {
        expect(screen.getByText(/Remote Path \(qBittorrent\)/i)).toBeInTheDocument();
        expect(screen.getByText(/Local Path \(ReadMeABook\)/i)).toBeInTheDocument();
      });
    });

    it('validates remote path fields when enabled', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'Connected!' }),
      });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Fill required fields
      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://localhost:8080' },
      });
      fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } });

      // Enable remote path mapping but don't fill paths
      fireEvent.click(screen.getByLabelText(/Enable Remote Path Mapping/i));

      // Try to test connection
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Remote path is required/i)).toBeInTheDocument();
      });
    });
  });

  describe('Navigation', () => {
    it('blocks Next when no enabled client is configured', () => {
      const onNext = vi.fn();
      render(<DownloadClientHarness onNext={onNext} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      expect(screen.getByText(/Please add at least one download client before proceeding/i)).toBeInTheDocument();
      expect(onNext).not.toHaveBeenCalled();
    });

    it('allows Next when at least one enabled client exists', () => {
      const onNext = vi.fn();
      const mockClient = createMockClient();

      render(<DownloadClientHarness onNext={onNext} onBack={vi.fn()} initialClients={[mockClient]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      expect(onNext).toHaveBeenCalled();
    });

    it('blocks Next when client exists but is disabled', () => {
      const onNext = vi.fn();
      const mockClient = createMockClient({ enabled: false });

      render(<DownloadClientHarness onNext={onNext} onBack={vi.fn()} initialClients={[mockClient]} />);

      fireEvent.click(screen.getByRole('button', { name: 'Next' }));

      expect(screen.getByText(/Please add at least one download client before proceeding/i)).toBeInTheDocument();
      expect(onNext).not.toHaveBeenCalled();
    });

    it('calls onBack when Back button is clicked', () => {
      const onBack = vi.fn();
      render(<DownloadClientHarness onNext={vi.fn()} onBack={onBack} />);

      fireEvent.click(screen.getByRole('button', { name: 'Back' }));

      expect(onBack).toHaveBeenCalled();
    });
  });

  describe('Client Type Restrictions', () => {
    it('shows "Protocol already configured" when a torrent client is already added', () => {
      const mockClient = createMockClient({ type: 'qbittorrent' });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} initialClients={[mockClient]} />);

      // "Protocol already configured" text should appear for torrent clients
      const configuredMessages = screen.getAllByText('Protocol already configured');
      expect(configuredMessages.length).toBeGreaterThanOrEqual(1);

      // Add qBittorrent and Add Transmission buttons should not exist (torrent protocol taken)
      expect(screen.queryByRole('button', { name: /Add qBittorrent/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add Transmission/i })).not.toBeInTheDocument();

      // SABnzbd should still have Add button (different protocol)
      expect(screen.getByRole('button', { name: /Add SABnzbd/i })).toBeInTheDocument();
    });

    it('shows "Protocol already configured" when SABnzbd is already added', () => {
      const mockClient = createMockClient({ type: 'sabnzbd', name: 'My SABnzbd' });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} initialClients={[mockClient]} />);

      // "Protocol already configured" text should appear for both usenet client cards (SABnzbd + NZBGet)
      const configuredMessages = screen.getAllByText('Protocol already configured');
      expect(configuredMessages.length).toBe(2);

      // Add SABnzbd and NZBGet buttons should not exist (usenet protocol taken)
      expect(screen.queryByRole('button', { name: /Add SABnzbd/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add NZBGet/i })).not.toBeInTheDocument();

      // Torrent clients should still have Add buttons
      expect(screen.getByRole('button', { name: /Add qBittorrent/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Add Transmission/i })).toBeInTheDocument();
    });
  });

  describe('Client Card Actions', () => {
    it('opens edit modal when edit button is clicked', async () => {
      const mockClient = createMockClient({ name: 'My qBittorrent' });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} initialClients={[mockClient]} />);

      // Find and click edit button
      const editButton = screen.getByTitle('Edit client');
      fireEvent.click(editButton);

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Edit qBittorrent/i })).toBeInTheDocument();
      });
    });

    it('shows delete confirmation when delete button is clicked', async () => {
      const mockClient = createMockClient({ name: 'My qBittorrent' });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} initialClients={[mockClient]} />);

      // Find and click delete button
      const deleteButton = screen.getByTitle('Delete client');
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByText(/Delete Download Client/i)).toBeInTheDocument();
        expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument();
      });
    });

    it('removes client when delete is confirmed', async () => {
      const mockClient = createMockClient({ name: 'My qBittorrent' });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} initialClients={[mockClient]} />);

      // Click delete button
      fireEvent.click(screen.getByTitle('Delete client'));

      await waitFor(() => {
        expect(screen.getByText(/Delete Download Client/i)).toBeInTheDocument();
      });

      // Confirm deletion
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

      // Client should be removed
      await waitFor(() => {
        expect(screen.queryByText('My qBittorrent')).not.toBeInTheDocument();
        expect(screen.getByText('No download clients configured yet')).toBeInTheDocument();
      });
    });

    it('cancels delete when cancel is clicked', async () => {
      const mockClient = createMockClient({ name: 'My qBittorrent' });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} initialClients={[mockClient]} />);

      // Click delete button
      fireEvent.click(screen.getByTitle('Delete client'));

      await waitFor(() => {
        expect(screen.getByText(/Delete Download Client/i)).toBeInTheDocument();
      });

      // Cancel deletion
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      // Dialog should close, client should still be there
      await waitFor(() => {
        expect(screen.queryByText(/Delete Download Client/i)).not.toBeInTheDocument();
        expect(screen.getByText('My qBittorrent')).toBeInTheDocument();
      });
    });
  });

  describe('Multiple Clients', () => {
    it('allows configuring both qBittorrent and SABnzbd', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, message: 'Connected!' }),
      });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      // Add qBittorrent
      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://localhost:8080' },
      });
      fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'admin' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'secret' } });
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Connected!/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Add Client/i }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Add qBittorrent/i })).not.toBeInTheDocument();
      });

      // Now add SABnzbd
      fireEvent.click(screen.getByRole('button', { name: /Add SABnzbd/i }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add SABnzbd/i })).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('http://localhost:8081'), {
        target: { value: 'http://localhost:8081' },
      });
      fireEvent.change(screen.getByPlaceholderText(/API Key from SABnzbd/i), {
        target: { value: 'my-api-key' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        // Find the success message in the modal
        const successMessages = screen.getAllByText(/Connected!/i);
        expect(successMessages.length).toBeGreaterThan(0);
      });

      fireEvent.click(screen.getByRole('button', { name: /Add Client/i }));

      // Both clients should be in the list - check for edit buttons (2 of them)
      await waitFor(() => {
        const editButtons = screen.getAllByTitle('Edit client');
        expect(editButtons).toHaveLength(2);
      });

      // Both "Protocol already configured" messages should appear (torrent + usenet)
      const alreadyConfiguredMessages = screen.getAllByText('Protocol already configured');
      expect(alreadyConfiguredMessages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Modal Behavior', () => {
    it('closes modal when Cancel is clicked', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Add qBittorrent/i })).not.toBeInTheDocument();
      });
    });

    it('closes modal when clicking the X button', async () => {
      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Find and click the close button (X icon in modal header)
      const modal = screen.getByRole('heading', { name: /Add qBittorrent/i }).closest('[class*="relative"]');
      const closeButton = within(modal!).getAllByRole('button')[0]; // First button in modal header area
      fireEvent.click(closeButton);

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Add qBittorrent/i })).not.toBeInTheDocument();
      });
    });

    it('resets form state when reopening modal', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Connection failed' }),
      });

      render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

      // Open, fill, and trigger error
      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      fireEvent.change(screen.getByPlaceholderText('http://localhost:8080'), {
        target: { value: 'http://bad-url' },
      });
      fireEvent.change(screen.getByPlaceholderText('admin'), { target: { value: 'user' } });
      fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pass' } });
      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Connection failed/i)).toBeInTheDocument();
      });

      // Close modal
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Add qBittorrent/i })).not.toBeInTheDocument();
      });

      // Reopen - error should be cleared
      fireEvent.click(screen.getByRole('button', { name: /Add qBittorrent/i }));
      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /Add qBittorrent/i })).toBeInTheDocument();
      });

      // Error message should not be present
      expect(screen.queryByText(/Connection failed/i)).not.toBeInTheDocument();
    });
  });
});
