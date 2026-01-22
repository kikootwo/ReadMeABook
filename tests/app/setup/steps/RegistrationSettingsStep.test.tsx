/**
 * Component: Registration Settings Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RegistrationSettingsStep } from '@/app/setup/steps/RegistrationSettingsStep';

const RegistrationHarness = ({
  onNext,
  onBack,
  initialValue = false,
}: {
  onNext: () => void;
  onBack: () => void;
  initialValue?: boolean;
}) => {
  const [requireAdminApproval, setRequireAdminApproval] = useState(initialValue);

  return (
    <RegistrationSettingsStep
      requireAdminApproval={requireAdminApproval}
      onUpdate={(_, value) => setRequireAdminApproval(value)}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

describe('RegistrationSettingsStep', () => {
  it('toggles admin approval and navigates', async () => {
    const onNext = vi.fn();
    const onBack = vi.fn();

    render(<RegistrationHarness onNext={onNext} onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(onBack).toHaveBeenCalled();
    expect(onNext).toHaveBeenCalled();

    expect(screen.getByText('Auto-Approval Enabled')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    const toggleButton = buttons.find((button) => !['Back', 'Next'].includes(button.textContent || ''));
    expect(toggleButton).toBeDefined();
    fireEvent.click(toggleButton as HTMLButtonElement);
    expect(screen.getByText('Admin Approval Workflow')).toBeInTheDocument();
  });
});
