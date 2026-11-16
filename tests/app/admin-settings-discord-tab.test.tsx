/**
 * Component: Discord Settings Tab Tests
 * Documentation: documentation/settings-pages.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithAuthMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/utils/api', () => ({ fetchWithAuth: fetchWithAuthMock }));

const MASK = '••••••••••••';
const GUILD = '222222222222222222';

const response = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body });

function savedSettings(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      enabled: false,
      botToken: MASK,
      guildId: GUILD,
      requestChannelId: '',
      adminRoleId: '',
      adminNotifyChannelId: '',
      ...overrides,
    },
    isConfigured: overrides.enabled === true,
    status: { state: overrides.enabled === true ? 'running' : 'stopped' },
  };
}

const testCalls = () => fetchWithAuthMock.mock.calls.filter(([url]) => String(url).includes('test-discord'));

async function renderTab(loaded: ReturnType<typeof savedSettings>) {
  fetchWithAuthMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/admin/settings/discord' && (!init || !init.method || init.method === 'GET')) return response(loaded);
    if (url === '/api/admin/settings/test-discord') {
      return response({
        bot: { id: '111111111111111111', username: 'RMAB Bot' },
        inviteUrl: 'https://discord.com/oauth2/authorize?client_id=111111111111111111&permissions=84992&scope=bot+applications.commands',
        guilds: [{ id: GUILD, name: 'Book Club' }],
        guild: { id: GUILD, name: 'Book Club' },
        names: {},
        warnings: [],
      });
    }
    if (url === '/api/admin/settings/discord' && init?.method === 'PUT') return response(loaded);
    throw new Error(`unexpected fetch ${url}`);
  });
  const { DiscordTab } = await import('@/app/admin/settings/tabs/DiscordTab/DiscordTab');
  const onSuccess = vi.fn();
  const onError = vi.fn();
  render(<DiscordTab onSuccess={onSuccess} onError={onError} />);
  await waitFor(() => expect(screen.getByLabelText('Bot token')).toBeTruthy());
  return { onSuccess, onError };
}

describe('Discord settings tab', () => {
  beforeEach(() => {
    fetchWithAuthMock.mockReset();
  });

  it.each([
    ['disabled, token saved', savedSettings()],
    ['enabled, token saved', savedSettings({ enabled: true })],
  ])('on load (%s) it reads the saved settings only: no test or name lookup', async (_label, loaded) => {
    await renderTab(loaded);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(testCalls()).toHaveLength(0);
    expect(fetchWithAuthMock.mock.calls.map(([url]) => url)).toEqual(['/api/admin/settings/discord']);
    expect((screen.getByLabelText('Bot token') as HTMLInputElement).value).toBe(MASK);
    expect((screen.getByLabelText('Server ID') as HTMLInputElement).value).toBe(GUILD);
  });

  it('Test runs only on a click and shows the bot and the invite link', async () => {
    await renderTab(savedSettings());

    fireEvent.click(screen.getByRole('button', { name: 'Test' }));

    await waitFor(() => expect(testCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.getByText(/RMAB Bot/)).toBeTruthy());
    const invite = screen.getByRole('link', { name: /Invite the bot/ }) as HTMLAnchorElement;
    expect(invite.href).toContain('permissions=84992');
    const body = JSON.parse(testCalls()[0][1].body as string);
    expect(body.botToken).toBe(MASK);
  });

  it('Save sends every field and reports success', async () => {
    const { onSuccess } = await renderTab(savedSettings());

    fireEvent.click(screen.getByRole('switch', { name: 'Enable the Discord bot' }));
    fireEvent.change(screen.getByLabelText('Request channel ID'), { target: { value: '444444444444444444' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    const put = fetchWithAuthMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(put![1].body as string)).toEqual({
      enabled: true,
      botToken: MASK,
      guildId: GUILD,
      requestChannelId: '444444444444444444',
      adminRoleId: '',
      adminNotifyChannelId: '',
    });
  });

  it('an ID that is not a Discord ID shows an inline error and disables Save', async () => {
    await renderTab(savedSettings());

    fireEvent.change(screen.getByLabelText('Admin role ID'), { target: { value: 'librarians' } });

    expect(screen.getByText('Discord IDs are 15 to 20 digits')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
