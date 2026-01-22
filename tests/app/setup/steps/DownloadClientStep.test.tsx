/**
 * Component: Setup Download Client Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadClientStep } from '@/app/setup/steps/DownloadClientStep';

const DownloadClientHarness = ({
  onNext,
  onBack,
  initialState,
}: {
  onNext: () => void;
  onBack: () => void;
  initialState?: Partial<React.ComponentProps<typeof DownloadClientStep>>;
}) => {
  const [state, setState] = useState({
    downloadClient: 'qbittorrent' as const,
    downloadClientUrl: 'https://qbittorrent.local',
    downloadClientUsername: 'admin',
    downloadClientPassword: 'secret',
    disableSSLVerify: false,
    remotePathMappingEnabled: false,
    remotePath: '',
    localPath: '',
    ...initialState,
  });

  return (
    <DownloadClientStep
      {...state}
      onUpdate={(field, value) => setState((prev) => ({ ...prev, [field]: value }))}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

describe('DownloadClientStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tests connection and enables navigation after success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, version: '1.2.3' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNext = vi.fn();

    render(<DownloadClientHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-download-client', expect.any(Object));
    });

    expect(screen.getByText(/Connected successfully!/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });

  it('shows remote path fields and toggles SSL verify', async () => {
    render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

    const sslToggle = screen.getByLabelText('Disable SSL Certificate Verification');
    fireEvent.click(sslToggle);
    expect(sslToggle).toBeChecked();

    const remoteToggle = screen.getByLabelText('Enable Remote Path Mapping');
    fireEvent.click(remoteToggle);

    expect(screen.getByPlaceholderText('/remote/mnt/d/done')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('/downloads')).toBeInTheDocument();
  });

  it('switches to SABnzbd and shows API key field', async () => {
    render(
      <DownloadClientHarness
        onNext={vi.fn()}
        onBack={vi.fn()}
        initialState={{ downloadClient: 'qbittorrent' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /SABnzbd/ }));

    expect(screen.getByText('API Key')).toBeInTheDocument();
    expect(screen.queryByText('Username')).toBeNull();
  });

  it('blocks next when connection has not been tested', async () => {
    const onNext = vi.fn();
    render(<DownloadClientHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Please test the connection before proceeding')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('shows an error when the connection test fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Bad credentials' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<DownloadClientHarness onNext={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test Connection' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-download-client', expect.any(Object));
    });

    expect(screen.getByText('Bad credentials')).toBeInTheDocument();
  });

  it('disables test connection when SABnzbd fields are incomplete', async () => {
    render(
      <DownloadClientHarness
        onNext={vi.fn()}
        onBack={vi.fn()}
        initialState={{
          downloadClient: 'sabnzbd',
          downloadClientUrl: '',
          downloadClientPassword: '',
        }}
      />
    );

    const testButton = screen.getByRole('button', { name: 'Test Connection' });
    expect(testButton).toBeDisabled();
  });

  it('hides SSL toggle when using http URLs', async () => {
    render(
      <DownloadClientHarness
        onNext={vi.fn()}
        onBack={vi.fn()}
        initialState={{ downloadClientUrl: 'http://qbittorrent.local' }}
      />
    );

    expect(screen.queryByLabelText('Disable SSL Certificate Verification')).toBeNull();
  });
});
