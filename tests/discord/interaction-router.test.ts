/**
 * Component: Discord Interaction Router Tests
 * Documentation: documentation/integrations/discord-bot.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DISCORD_COMMANDS, routeInteraction, type RoutableInteraction } from '@/lib/services/discord/discord-interaction-router';

const requestHandlers = vi.hoisted(() => ({
  handleRequestCommand: vi.fn(async () => undefined),
  handleRequestComponent: vi.fn(async () => undefined),
}));
vi.mock('@/lib/services/discord/request/discord-request-handlers', () => requestHandlers);
const approvalHandlers = vi.hoisted(() => ({ handleApprovalComponent: vi.fn(async () => undefined) }));
vi.mock('@/lib/services/discord/approval/discord-approval-handler', () => approvalHandlers);
const statusHandlers = vi.hoisted(() => ({ handleStatusCommand: vi.fn(async () => undefined), handleStatusComponent: vi.fn(async () => undefined) }));
vi.mock('@/lib/services/discord/manage/discord-status-handler', () => statusHandlers);
const deleteHandlers = vi.hoisted(() => ({ handleDeleteCommand: vi.fn(async () => undefined), handleDeleteComponent: vi.fn(async () => undefined) }));
vi.mock('@/lib/services/discord/manage/discord-delete-handler', () => deleteHandlers);

const GUILD = '222222222222222222';
const REQUEST_ID = 'rmab:req:pick:a:abcdefghij';

type Kind = 'command' | 'autocomplete' | 'modal' | 'button' | 'select' | 'context-menu';

/** Only the kind's own check is true, like discord.js (every type guard present). */
function interaction(kind: Kind, guildId: string | null, extra: Partial<RoutableInteraction> = {}): RoutableInteraction {
  const fake = {
    guildId,
    commandName: 'probe',
    isChatInputCommand: () => kind === 'command',
    isAutocomplete: () => kind === 'autocomplete',
    isModalSubmit: () => kind === 'modal',
    isContextMenuCommand: () => kind === 'context-menu',
    isButton: () => kind === 'button',
    isAnySelectMenu: () => kind === 'select',
    ...extra,
  };
  return fake;
}

describe('Discord interaction router', () => {
  beforeEach(() => {
    requestHandlers.handleRequestCommand.mockClear();
    requestHandlers.handleRequestComponent.mockClear();
    approvalHandlers.handleApprovalComponent.mockClear();
    for (const fn of [...Object.values(statusHandlers), ...Object.values(deleteHandlers)]) fn.mockClear();
  });

  it('Approve / Deny buttons in the server go to the approval handler, not the /request one', async () => {
    const id = 'rmab:apr:a:0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a:abcdefghij';
    expect(await routeInteraction(interaction('button', GUILD, { customId: id }), GUILD)).toBe('handled');
    expect(approvalHandlers.handleApprovalComponent).toHaveBeenCalledTimes(1);
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
    expect(await routeInteraction(interaction('button', '999999999999999999', { customId: id }), GUILD)).toBe('ignored-foreign-guild');
    expect(approvalHandlers.handleApprovalComponent).toHaveBeenCalledTimes(1);
  });

  it('registers /request (type required: audiobook or ebook; query optional), server-only', () => {
    expect(DISCORD_COMMANDS.map((command) => command.name)).toEqual(['request', 'status', 'delete']);
    const [request] = DISCORD_COMMANDS as Array<{ options: Array<Record<string, unknown>> }>;
    expect(request.options.map((o) => [o.name, o.required])).toEqual([['type', true], ['query', false]]);
    expect((request.options[0].choices as Array<{ value: string }>).map((c) => c.value)).toEqual(['audiobook', 'ebook']);
  });

  it('registers /status with no options, and /delete hidden from members without Administrator', () => {
    const [, status, del] = DISCORD_COMMANDS as Array<Record<string, unknown>>;
    expect(status).not.toHaveProperty('options');
    expect(status).not.toHaveProperty('default_member_permissions');
    expect(del).not.toHaveProperty('options');
    expect(del.default_member_permissions).toBe('8');
  });

  it('/status and /delete go to their handlers; status and delete components by prefix, Cancel also from a DM', async () => {
    const command = (name: string) => interaction('command', GUILD, { commandName: name });
    expect(await routeInteraction(command('status'), GUILD)).toBe('handled');
    expect(await routeInteraction(command('delete'), GUILD)).toBe('handled');
    expect(statusHandlers.handleStatusCommand).toHaveBeenCalledTimes(1);
    expect(deleteHandlers.handleDeleteCommand).toHaveBeenCalledTimes(1);

    const cancel = 'rmab:sts:x:0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a:abcdefghij';
    expect(await routeInteraction(interaction('button', null, { customId: cancel }), GUILD)).toBe('handled');
    expect(await routeInteraction(interaction('select', GUILD, { customId: 'rmab:del:m:0:abcdefghij' }), GUILD)).toBe('handled');
    expect(statusHandlers.handleStatusComponent).toHaveBeenCalledTimes(1);
    expect(deleteHandlers.handleDeleteComponent).toHaveBeenCalledTimes(1);
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
    expect(approvalHandlers.handleApprovalComponent).not.toHaveBeenCalled();
    // A command from a DM is still dropped
    expect(await routeInteraction(interaction('command', null, { commandName: 'delete' }), GUILD)).toBe('ignored-foreign-guild');
    expect(deleteHandlers.handleDeleteCommand).toHaveBeenCalledTimes(1);
  });

  it('the server command carries no global-command fields (dm_permission, contexts)', () => {
    for (const command of DISCORD_COMMANDS) {
      expect(command).not.toHaveProperty('dm_permission');
      expect(command).not.toHaveProperty('contexts');
    }
  });

  it('runs a command handler only for the configured server', async () => {
    const handler = vi.fn(async () => undefined);
    const handlers = new Map([['probe', handler]]);

    expect(await routeInteraction(interaction('command', GUILD), GUILD, handlers)).toBe('handled');
    expect(await routeInteraction(interaction('command', '333333333333333333'), GUILD, handlers)).toBe('ignored-foreign-guild');
    expect(await routeInteraction(interaction('command', null), GUILD, handlers)).toBe('ignored-foreign-guild');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each(['autocomplete', 'modal', 'context-menu'] as const)('drops a %s with no server', async (kind) => {
    expect(await routeInteraction(interaction(kind, null, { customId: REQUEST_ID }), GUILD, new Map())).toBe('ignored-foreign-guild');
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
  });

  it.each(['button', 'select'] as const)('a %s from a DM passes the server check; from another server it does not', async (kind) => {
    expect(await routeInteraction(interaction(kind, null), GUILD, new Map())).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction(kind, '333333333333333333'), GUILD, new Map())).toBe('ignored-foreign-guild');
  });

  it('an unknown command in the right server is ignored', async () => {
    expect(await routeInteraction(interaction('command', GUILD), GUILD)).toBe('ignored-unhandled');
  });

  it('/request goes to the request command handler (loaded on first use)', async () => {
    const command = interaction('command', GUILD, { commandName: 'request' });
    expect(await routeInteraction(command, GUILD)).toBe('handled');
    expect(requestHandlers.handleRequestCommand).toHaveBeenCalledWith(command);
  });

  it.each(['modal', 'button', 'select'] as const)('a %s with a /request custom id goes to the request step handler', async (kind) => {
    const step = interaction(kind, GUILD, { customId: REQUEST_ID });
    expect(await routeInteraction(step, GUILD)).toBe('handled');
    expect(requestHandlers.handleRequestComponent).toHaveBeenCalledWith(step);
  });

  it('a component with another custom id, or none, is ignored', async () => {
    expect(await routeInteraction(interaction('button', GUILD, { customId: 'other:thing' }), GUILD)).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction('button', GUILD), GUILD)).toBe('ignored-unhandled');
    expect(await routeInteraction(interaction('autocomplete', GUILD, { customId: REQUEST_ID }), GUILD)).toBe('ignored-unhandled');
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
  });

  it('a command is never routed by a custom id', async () => {
    const command = interaction('command', GUILD, { commandName: 'probe', customId: REQUEST_ID });
    expect(await routeInteraction(command, GUILD)).toBe('ignored-unhandled');
    expect(requestHandlers.handleRequestComponent).not.toHaveBeenCalled();
  });
});
