/**
 * Component: Setup Welcome Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('WelcomeStep', () => {
  it('calls onNext when Get Started is clicked', async () => {
    const onNext = vi.fn();
    const { WelcomeStep } = await import('@/app/setup/steps/WelcomeStep');

    render(<WelcomeStep onNext={onNext} />);

    fireEvent.click(screen.getByRole('button', { name: /Get Started/i }));
    expect(onNext).toHaveBeenCalled();
  });
});
