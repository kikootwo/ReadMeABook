/**
 * Component: BookDate Loading Screen Tests
 * Documentation: documentation/features/bookdate.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/layout/Header', () => ({
  Header: () => <div data-testid="header" />,
}));

describe('LoadingScreen', () => {
  it('renders the loading message and header', async () => {
    const { LoadingScreen } = await import('@/components/bookdate/LoadingScreen');

    render(<LoadingScreen />);

    expect(screen.getByTestId('header')).toBeInTheDocument();
    expect(screen.getByText('Finding your next great listen...')).toBeInTheDocument();
  });
});
