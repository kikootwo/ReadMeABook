/**
 * Component: Status Badge Tests
 * Documentation: documentation/frontend/components.md
 */

// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from '@/components/requests/StatusBadge';

describe('StatusBadge', () => {
  it('uses the initializing label for zero-progress downloads', () => {
    render(<StatusBadge status="downloading" progress={0} />);
    expect(screen.getByText('Initializing...')).toBeInTheDocument();
  });

  it('falls back to the raw status when unknown', () => {
    render(<StatusBadge status="custom_status" />);
    expect(screen.getByText('custom_status')).toBeInTheDocument();
  });
});
