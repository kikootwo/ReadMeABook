/**
 * Component: Auth Method Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

describe('AuthMethodStep', () => {
  it('highlights the selected auth method', async () => {
    const { AuthMethodStep } = await import('@/app/setup/steps/AuthMethodStep');

    const { rerender } = render(
      <AuthMethodStep
        value="oidc"
        onChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    const oidcLabel = screen.getByRole('radio', { name: /OIDC Provider/i }).closest('label');
    const manualLabel = screen.getByRole('radio', { name: /Manual Registration/i }).closest('label');
    const bothLabel = screen.getByRole('radio', { name: /Both/i }).closest('label');

    expect(oidcLabel).toHaveClass('border-blue-500');
    expect(manualLabel).toHaveClass('border-gray-200');
    expect(bothLabel).toHaveClass('border-gray-200');

    rerender(
      <AuthMethodStep
        value="manual"
        onChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole('radio', { name: /Manual Registration/i }).closest('label')).toHaveClass('border-blue-500');

    rerender(
      <AuthMethodStep
        value="both"
        onChange={vi.fn()}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByRole('radio', { name: /Both/i }).closest('label')).toHaveClass('border-blue-500');
  });

  it('updates auth method and navigates', async () => {
    const onChange = vi.fn();
    const onNext = vi.fn();
    const onBack = vi.fn();
    const { AuthMethodStep } = await import('@/app/setup/steps/AuthMethodStep');

    const { rerender } = render(
      <AuthMethodStep
        value="oidc"
        onChange={onChange}
        onNext={onNext}
        onBack={onBack}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /Manual Registration/i }));
    expect(onChange).toHaveBeenCalledWith('manual');

    rerender(
      <AuthMethodStep
        value="manual"
        onChange={onChange}
        onNext={onNext}
        onBack={onBack}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /OIDC Provider/i }));
    expect(onChange).toHaveBeenCalledWith('oidc');

    rerender(
      <AuthMethodStep
        value="oidc"
        onChange={onChange}
        onNext={onNext}
        onBack={onBack}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: /Both/i }));
    expect(onChange).toHaveBeenCalledWith('both');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(onBack).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();
  });
});
