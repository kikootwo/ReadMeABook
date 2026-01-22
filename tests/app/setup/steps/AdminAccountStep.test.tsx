/**
 * Component: Admin Account Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminAccountStep } from '@/app/setup/steps/AdminAccountStep';

const AdminAccountHarness = ({
  onNext,
  onBack,
  initialUsername = '',
  initialPassword = '',
}: {
  onNext: () => void;
  onBack: () => void;
  initialUsername?: string;
  initialPassword?: string;
}) => {
  const [adminUsername, setAdminUsername] = useState(initialUsername);
  const [adminPassword, setAdminPassword] = useState(initialPassword);

  return (
    <AdminAccountStep
      adminUsername={adminUsername}
      adminPassword={adminPassword}
      onUpdate={(field, value) => {
        if (field === 'adminUsername') {
          setAdminUsername(value);
        }
        if (field === 'adminPassword') {
          setAdminPassword(value);
        }
      }}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

describe('AdminAccountStep', () => {
  it('shows validation errors and blocks next when invalid', async () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(
      <AdminAccountStep
        adminUsername="ad"
        adminPassword="short"
        onUpdate={vi.fn()}
        onNext={onNext}
        onBack={onBack}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText('Username must be at least 3 characters')).toBeInTheDocument();
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('allows navigation when credentials are valid', async () => {
    const onNext = vi.fn();
    const onBack = vi.fn();
    render(
      <AdminAccountHarness
        onNext={onNext}
        onBack={onBack}
        initialUsername="admin"
        initialPassword="supersecret"
      />
    );

    fireEvent.change(screen.getByLabelText('Confirm Password'), {
      target: { value: 'supersecret' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });
});
