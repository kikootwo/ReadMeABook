/**
 * Component: Setup BookDate Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookDateStep } from '@/app/setup/steps/BookDateStep';

const BookDateHarness = ({
  onNext,
  onSkip,
  onBack,
  initialState,
}: {
  onNext: () => void;
  onSkip: () => void;
  onBack: () => void;
  initialState?: Partial<React.ComponentProps<typeof BookDateStep>>;
}) => {
  const [state, setState] = useState({
    bookdateProvider: 'openai',
    bookdateApiKey: '',
    bookdateModel: '',
    bookdateConfigured: false,
    ...initialState,
  });

  return (
    <BookDateStep
      {...state}
      onUpdate={(field, value) => setState((prev) => ({ ...prev, [field]: value }))}
      onNext={onNext}
      onSkip={onSkip}
      onBack={onBack}
    />
  );
};

describe('BookDateStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables connection test when API key is missing', async () => {
    render(
      <BookDateHarness onNext={vi.fn()} onSkip={vi.fn()} onBack={vi.fn()} />
    );

    expect(screen.getByRole('button', { name: /Test Connection/ })).toBeDisabled();
  });

  it('fetches models and proceeds after successful test', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { id: 'model-1', name: 'Model One' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNext = vi.fn();

    render(
      <BookDateHarness
        onNext={onNext}
        onSkip={vi.fn()}
        onBack={vi.fn()}
        initialState={{ bookdateApiKey: 'key' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/bookdate/test-connection', expect.any(Object));
    });

    expect(await screen.findByText('Select Model')).toBeInTheDocument();

    const nextButton = screen.getByRole('button', { name: 'Next' });
    await waitFor(() => {
      expect(nextButton).not.toBeDisabled();
    });
    fireEvent.click(nextButton);
    expect(onNext).toHaveBeenCalled();
  });

  it('shows an error when the connection test fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Invalid API key' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BookDateHarness
        onNext={vi.fn()}
        onSkip={vi.fn()}
        onBack={vi.fn()}
        initialState={{ bookdateApiKey: 'bad-key' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));

    await waitFor(() => {
      expect(screen.getByText('Invalid API key')).toBeInTheDocument();
    });
  });

  it('auto-selects the first model and shows the note', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { id: 'model-1', name: 'Model One' },
          { id: 'model-2', name: 'Model Two' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BookDateHarness
        onNext={vi.fn()}
        onSkip={vi.fn()}
        onBack={vi.fn()}
        initialState={{ bookdateApiKey: 'key' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));

    await waitFor(() => {
      expect(screen.getByText('Select Model')).toBeInTheDocument();
    });

    const selects = screen.getAllByRole('combobox');
    const modelSelect = selects[1];
    expect(modelSelect).toHaveValue('model-1');
    expect(screen.getByText(/Library scope and custom prompt preferences/)).toBeInTheDocument();
  });

  it('clears tested state and models when switching providers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ id: 'model-1', name: 'Model One' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BookDateHarness
        onNext={vi.fn()}
        onSkip={vi.fn()}
        onBack={vi.fn()}
        initialState={{ bookdateApiKey: 'key' }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/ }));

    await waitFor(() => {
      expect(screen.getByText('Select Model')).toBeInTheDocument();
    });

    const providerSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(providerSelect, { target: { value: 'claude' } });

    expect(screen.queryByText('Select Model')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});
