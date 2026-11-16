/**
 * Component: "Can approve requests" option in the token create forms + Settings → API switch
 * Documentation: documentation/backend/services/api-tokens.md
 */

// @vitest-environment jsdom

import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain holders: the config's mockReset clears vi.fn implementations per test
const server = vi.hoisted(() => ({
  available: true,
  setting: false,
  posts: [] as Array<{ url: string; body: Record<string, unknown> }>,
  patches: [] as Array<Record<string, unknown>>,
}));

const ADMIN_ID = 'admin-1';
const OTHER_ID = 'user-2';

function reply(data: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => data } as Response;
}

vi.mock('@/lib/utils/api', () => ({
  fetchWithAuth: async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/admin/settings/api-tokens') {
      if (method === 'PATCH') {
        const body = JSON.parse(String(init!.body));
        server.patches.push(body);
        server.setting = body.allowRequestApproval;
      }
      return reply({ allowRequestApproval: server.setting });
    }
    if (url === '/api/admin/users') {
      return reply({ users: [{ id: ADMIN_ID, plexUsername: 'admin', role: 'admin' }, { id: OTHER_ID, plexUsername: 'reader', role: 'user' }] });
    }
    if (method === 'POST') {
      server.posts.push({ url, body: JSON.parse(String(init!.body)) });
      return reply({ fullToken: 'rmab_created', token: {} }, 201);
    }
    const tokens = [{ id: 't1', name: 'Approver', tokenPrefix: 'rmab_t1', role: 'admin', lastUsedAt: null, expiresAt: null, createdAt: '2026-11-01T00:00:00Z', canApproveRequests: true, createdBy: 'admin', createdById: ADMIN_ID, tokenUser: 'admin', tokenUserId: ADMIN_ID }];
    return reply({ tokens, approvalTokensAvailable: server.available });
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: ADMIN_ID } }) }));
vi.mock('@/lib/utils/client-url', () => ({ getInstanceUrl: () => 'http://rmab.test' }));

import { ApiTokensSection } from '@/components/profile/ApiTokensSection';
import { ApiTab } from '@/app/admin/settings/tabs/ApiTab/ApiTab';

const CHECKBOX = { name: /Can approve requests/ };

async function openForm(ui: React.ReactElement) {
  await act(async () => {
    render(ui);
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Create New Token' }));
  });
}

const expirySelect = () => screen.getAllByRole('combobox')[0] as HTMLSelectElement;
const optionValues = (select: HTMLSelectElement) => [...select.options].map((o) => o.value);

beforeEach(() => {
  server.available = true;
  server.setting = false;
  server.posts = [];
  server.patches = [];
});

describe('Profile create form', () => {
  it('is hidden unless the server offers approval tokens', async () => {
    server.available = false;
    await openForm(<ApiTokensSection />);

    expect(screen.queryByRole('checkbox', CHECKBOX)).toBeNull();
    expect(optionValues(expirySelect())).toEqual(['never', '30d', '90d', '1y']);

    cleanup();
    server.available = true;
    await openForm(<ApiTokensSection />);
    expect(screen.getByRole('checkbox', CHECKBOX)).toBeTruthy();
  });

  it('ticked: only 30 and 90 days, 90 by default, and the flag is sent', async () => {
    await openForm(<ApiTokensSection />);
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', CHECKBOX));
    });

    expect(optionValues(expirySelect())).toEqual(['30d', '90d']);
    expect(expirySelect().value).toBe('90d');

    fireEvent.change(screen.getByPlaceholderText(/Home Assistant/), { target: { value: 'Approver' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    });

    expect(server.posts).toHaveLength(1);
    expect(server.posts[0].url).toBe('/api/user/api-tokens');
    expect(server.posts[0].body).toMatchObject({ name: 'Approver', canApproveRequests: true });
    const days = (Date.parse(String(server.posts[0].body.expiresAt)) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThanOrEqual(90.05);
  });

  it('offered but not ticked: the flag is not sent at all', async () => {
    await openForm(<ApiTokensSection />);
    expect((screen.getByRole('checkbox', CHECKBOX) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByPlaceholderText(/Home Assistant/), { target: { value: 'Plain' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Token' }));
    });

    expect(server.posts[0].body).not.toHaveProperty('canApproveRequests');
    expect(server.posts[0].body.expiresAt).toBeNull();
  });

  it('the help text says approve only, the 90-day expiry and the switch stops it', async () => {
    await openForm(<ApiTokensSection />);
    const text = screen.getByRole('checkbox', CHECKBOX).closest('label')!.textContent!;

    expect(text).toContain('It cannot deny them');
    expect(text).toContain('must expire within 90 days');
    expect(text).toContain('stops it at once');
  });

  it('the token list shows a badge on an approval token', async () => {
    await act(async () => {
      render(<ApiTokensSection />);
    });
    const row = (await screen.findByText('rmab_t1...')).closest('tr')!;
    expect(within(row).getByText('Can approve requests')).toBeTruthy();
  });
});

describe('Settings → API', () => {
  it('the option shows for the current user and hides for another user', async () => {
    await openForm(<ApiTab />);
    expect(screen.getByRole('checkbox', CHECKBOX)).toBeTruthy();

    const userSelect = screen.getAllByRole('combobox')[1] as HTMLSelectElement;
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', CHECKBOX));
    });
    await act(async () => {
      fireEvent.change(userSelect, { target: { value: OTHER_ID } });
    });
    expect(screen.queryByRole('checkbox', CHECKBOX)).toBeNull();
    expect(optionValues(expirySelect())).toEqual(['never', '30d', '90d', '1y']);

    await act(async () => {
      fireEvent.change(userSelect, { target: { value: ADMIN_ID } });
    });
    expect((screen.getByRole('checkbox', CHECKBOX) as HTMLInputElement).checked).toBe(false);
  });

  it('the switch saves on toggle and its help names the kill switch and revoking', async () => {
    await act(async () => {
      render(<ApiTab />);
    });
    const toggle = await screen.findByRole('switch', { name: 'Allow API tokens to approve requests' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(server.patches).toEqual([{ allowRequestApproval: true }]);
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    const help = document.getElementById(toggle.getAttribute('aria-describedby')!)!.textContent!;
    expect(help).toContain('Off by default');
    expect(help).toContain('stops every approval token immediately');
    expect(help).toContain('revoke the token');
  });
});
