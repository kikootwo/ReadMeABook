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
      clearBotToken: false,
    });
  });

  it('emptying a saved token asks the server to clear it on purpose', async () => {
    await renderTab(savedSettings());

    fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchWithAuthMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true));
    const put = fetchWithAuthMock.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(put![1].body as string)).toMatchObject({ botToken: '', clearBotToken: true });
  });

  it.each([
    ['a 500', () => response({ error: 'Failed to read Discord settings' }, false, 500)],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('a failed load (%s) shows the error with Retry, and no Save or Test until a load works', async (_label, failure) => {
    const loaded = savedSettings();
    let fail = true;
    fetchWithAuthMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method) throw new Error(`unexpected ${init.method} ${url}`);
      return fail ? failure() : response(loaded);
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { DiscordTab } = await import('@/app/admin/settings/tabs/DiscordTab/DiscordTab');
    render(<DiscordTab onSuccess={vi.fn()} onError={vi.fn()} />);

    await waitFor(() => expect(screen.getByText(/Could not load the saved Discord settings/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull();
    expect(screen.queryByLabelText('Bot token')).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect((screen.getByLabelText('Bot token') as HTMLInputElement).value).toBe(MASK));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchWithAuthMock.mock.calls.every(([, init]) => !init?.method)).toBe(true);
  });

  it('after a Save that enables the bot, reads the status again until it settles (bounded)', async () => {
    const statuses = [{ state: 'starting' }, { state: 'failed', lastError: 'An invalid token was provided.' }];
    let gets = 0;
    fetchWithAuthMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return response({ ...savedSettings({ enabled: true }), status: { state: 'stopped' } });
      gets++;
      if (gets === 1) return response(savedSettings());
      return response({ ...savedSettings({ enabled: true }), status: statuses[Math.min(gets - 2, statuses.length - 1)] });
    });
    const { DiscordTab } = await import('@/app/admin/settings/tabs/DiscordTab/DiscordTab');
    render(<DiscordTab onSuccess={vi.fn()} onError={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Bot token')).toBeTruthy());

    fireEvent.click(screen.getByRole('switch', { name: 'Enable the Discord bot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Could not connect')).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText(/Last error: An invalid token was provided/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(gets).toBe(3); // the load, then two reads: none after "failed"
  }, 10_000);

  it('changing an ID or the token clears the last Test result', async () => {
    await renderTab(savedSettings());
    fireEvent.click(screen.getByRole('button', { name: 'Test' }));
    await waitFor(() => expect(screen.getByText(/Token works/)).toBeTruthy());

    fireEvent.change(screen.getByLabelText('Server ID'), { target: { value: '333333333333333333' } });

    expect(screen.queryByText(/Token works/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Invite the bot/ })).toBeNull();
  });

  it('an ID that is not a Discord ID shows an inline error and disables Save', async () => {
    await renderTab(savedSettings());

    fireEvent.change(screen.getByLabelText('Admin role ID'), { target: { value: 'librarians' } });

    expect(screen.getByText('Discord IDs are 15 to 20 digits')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
