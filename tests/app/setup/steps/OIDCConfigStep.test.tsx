/**
 * Component: Setup OIDC Config Step Tests
 * Documentation: documentation/setup-wizard.md
 */

// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OIDCConfigStep } from '@/app/setup/steps/OIDCConfigStep';

const OIDCHarness = ({
  onNext,
  onBack,
  initialState,
}: {
  onNext: () => void;
  onBack: () => void;
  initialState?: Partial<React.ComponentProps<typeof OIDCConfigStep>>;
}) => {
  const [state, setState] = useState({
    oidcProviderName: 'Auth',
    oidcIssuerUrl: 'https://auth.example.com',
    oidcClientId: 'client',
    oidcClientSecret: 'secret',
    oidcAccessControlMethod: 'open',
    oidcAccessGroupClaim: '',
    oidcAccessGroupValue: '',
    oidcAllowedEmails: '',
    oidcAllowedUsernames: '',
    oidcAdminClaimEnabled: false,
    oidcAdminClaimName: '',
    oidcAdminClaimValue: '',
    ...initialState,
  });

  return (
    <OIDCConfigStep
      {...state}
      onUpdate={(field, value) => setState((prev) => ({ ...prev, [field]: value }))}
      onNext={onNext}
      onBack={onBack}
    />
  );
};

describe('OIDCConfigStep', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requires a successful test before proceeding', async () => {
    const onNext = vi.fn();
    render(<OIDCHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Please test the OIDC configuration before proceeding')).toBeInTheDocument();
    expect(onNext).not.toHaveBeenCalled();
  });

  it('tests connection and shows access control fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNext = vi.fn();

    render(<OIDCHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test OIDC Configuration' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/setup/test-oidc', expect.any(Object));
    });

    expect(screen.getByText('OIDC discovery successful! Provider configuration validated.')).toBeInTheDocument();

    const accessControlSelect = screen.getByRole('combobox');
    fireEvent.change(accessControlSelect, {
      target: { value: 'allowed_list' },
    });

    expect(screen.getByPlaceholderText('user1@example.com, user2@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('john_doe, jane_smith')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Enable Admin Role Mapping'));

    expect(screen.getByPlaceholderText('groups')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('readmeabook-admin')).toBeInTheDocument();
  });

  it('disables testing when required fields are missing', () => {
    render(
      <OIDCHarness
        onNext={vi.fn()}
        onBack={vi.fn()}
        initialState={{ oidcIssuerUrl: '' }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Test OIDC Configuration' })).toBeDisabled();
  });

  it('shows error text when connection test fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: false, error: 'Invalid issuer' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<OIDCHarness onNext={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test OIDC Configuration' }));

    await waitFor(() => {
      expect(screen.getByText('Invalid issuer')).toBeInTheDocument();
    });
  });

  it('shows error text when connection test throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(<OIDCHarness onNext={vi.fn()} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test OIDC Configuration' }));

    await waitFor(() => {
      expect(screen.getByText('Network down')).toBeInTheDocument();
    });
  });

  it('updates access control helper text and fields per method', () => {
    render(<OIDCHarness onNext={vi.fn()} onBack={vi.fn()} />);

    const accessControlSelect = screen.getByRole('combobox');
    expect(
      screen.getByText('Anyone who can authenticate with your OIDC provider will have access'),
    ).toBeInTheDocument();

    fireEvent.change(accessControlSelect, {
      target: { value: 'group_claim' },
    });
    expect(screen.getByText('Only users with a specific group/claim can access')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('readmeabook-users')).toBeInTheDocument();

    fireEvent.change(accessControlSelect, {
      target: { value: 'allowed_list' },
    });
    expect(screen.getByText('Only explicitly allowed users can access')).toBeInTheDocument();

    fireEvent.change(accessControlSelect, {
      target: { value: 'admin_approval' },
    });
    expect(
      screen.getByText('New users must be approved by an admin before access is granted'),
    ).toBeInTheDocument();
  });

  it('allows proceeding after a successful test', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const onNext = vi.fn();

    render(<OIDCHarness onNext={onNext} onBack={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Test OIDC Configuration' }));

    await waitFor(() => {
      expect(screen.getByText('OIDC discovery successful! Provider configuration validated.')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalled();
  });

  it('updates provider fields and access control inputs', () => {
    const onUpdate = vi.fn();

    render(
      <OIDCConfigStep
        oidcProviderName="Auth"
        oidcIssuerUrl="https://auth.example.com"
        oidcClientId="client"
        oidcClientSecret="secret"
        oidcAccessControlMethod="group_claim"
        oidcAccessGroupClaim="groups"
        oidcAccessGroupValue="readmeabook-users"
        oidcAllowedEmails=""
        oidcAllowedUsernames=""
        oidcAdminClaimEnabled={true}
        oidcAdminClaimName="groups"
        oidcAdminClaimValue="readmeabook-admin"
        onUpdate={onUpdate}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Authentik'), {
      target: { value: 'Keycloak' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('https://auth.example.com/application/o/readmeabook/'),
      {
        target: { value: 'https://issuer.example' },
      },
    );
    fireEvent.change(screen.getByPlaceholderText('readmeabook'), {
      target: { value: 'rmab-client' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter client secret'), {
      target: { value: 'new-secret' },
    });

    const groupInputs = screen.getAllByPlaceholderText('groups');
    fireEvent.change(groupInputs[0], { target: { value: 'roles' } });
    fireEvent.change(screen.getByPlaceholderText('readmeabook-users'), {
      target: { value: 'rmab-users' },
    });
    fireEvent.change(groupInputs[1], { target: { value: 'admin-roles' } });
    fireEvent.change(screen.getByPlaceholderText('readmeabook-admin'), {
      target: { value: 'rmab-admin' },
    });

    expect(onUpdate).toHaveBeenCalledWith('oidcProviderName', 'Keycloak');
    expect(onUpdate).toHaveBeenCalledWith('oidcIssuerUrl', 'https://issuer.example');
    expect(onUpdate).toHaveBeenCalledWith('oidcClientId', 'rmab-client');
    expect(onUpdate).toHaveBeenCalledWith('oidcClientSecret', 'new-secret');
    expect(onUpdate).toHaveBeenCalledWith('oidcAccessGroupClaim', 'roles');
    expect(onUpdate).toHaveBeenCalledWith('oidcAccessGroupValue', 'rmab-users');
    expect(onUpdate).toHaveBeenCalledWith('oidcAdminClaimName', 'admin-roles');
    expect(onUpdate).toHaveBeenCalledWith('oidcAdminClaimValue', 'rmab-admin');
  });

  it('updates allowed list fields and toggles admin mapping', () => {
    const onUpdate = vi.fn();

    render(
      <OIDCConfigStep
        oidcProviderName="Auth"
        oidcIssuerUrl="https://auth.example.com"
        oidcClientId="client"
        oidcClientSecret="secret"
        oidcAccessControlMethod="allowed_list"
        oidcAccessGroupClaim=""
        oidcAccessGroupValue=""
        oidcAllowedEmails=""
        oidcAllowedUsernames=""
        oidcAdminClaimEnabled={false}
        oidcAdminClaimName=""
        oidcAdminClaimValue=""
        onUpdate={onUpdate}
        onNext={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'allowed_list' },
    });
    fireEvent.change(screen.getByPlaceholderText('user1@example.com, user2@example.com'), {
      target: { value: 'reader@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('john_doe, jane_smith'), {
      target: { value: 'reader1' },
    });

    fireEvent.click(screen.getByLabelText('Enable Admin Role Mapping'));

    expect(onUpdate).toHaveBeenCalledWith('oidcAccessControlMethod', 'allowed_list');
    expect(onUpdate).toHaveBeenCalledWith('oidcAllowedEmails', 'reader@example.com');
    expect(onUpdate).toHaveBeenCalledWith('oidcAllowedUsernames', 'reader1');
    expect(onUpdate).toHaveBeenCalledWith('oidcAdminClaimEnabled', true);
  });

  it('navigates back when Back is clicked', () => {
    const onBack = vi.fn();

    render(<OIDCHarness onNext={vi.fn()} onBack={onBack} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });
});
