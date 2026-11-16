/**
 * Component: Discord /request Test Doubles (shared by the request handler tests)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * A fake interaction for each /request step that records every reply, and helpers to read
 * the custom ids the previous step put on its menu and buttons.
 */

import { vi } from 'vitest';

export const GUILD = '222222222222222222';
export const DISCORD_USER = '333333333333333333';
export const REQUESTER_ROLE = '555555555555555555';
export const ASIN = 'B0ABCDE123';

export type StepKind = 'command' | 'modal' | 'select' | 'button';

export interface FakeStepOptions {
  guildId?: string | null;
  /** Default: a member holding the requester role. */
  member?: unknown;
  customId?: string;
  options?: Record<string, string>;
  query?: string;
  values?: string[];
  /** Shared call log (database reads push 'db' into it too). */
  order?: string[];
}

/** reply, deferReply, editReply and showModal take one payload. */
type Send = (payload: Record<string, unknown>) => Promise<void>;

export type FakeStep = ReturnType<typeof fakeStep>;

export function fakeStep(kind: StepKind, opts: FakeStepOptions = {}) {
  const order = opts.order ?? [];
  const step = {
    guildId: opts.guildId === undefined ? GUILD : opts.guildId,
    user: { id: DISCORD_USER },
    member: opts.member === undefined ? { roles: [REQUESTER_ROLE] } : opts.member,
    customId: opts.customId,
    commandName: kind === 'command' ? 'request' : undefined,
    deferred: false,
    replied: false,
    isChatInputCommand: () => kind === 'command',
    isModalSubmit: () => kind === 'modal',
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isAnySelectMenu: () => kind === 'select',
    options: { getString: (name: string) => opts.options?.[name] ?? null },
    fields: { getTextInputValue: () => opts.query ?? '' },
    values: opts.values,
    order,
    reply: vi.fn<Send>(async () => {
      order.push('reply');
      step.replied = true;
    }),
    deferReply: vi.fn<Send>(async () => {
      order.push('deferReply');
      step.deferred = true;
    }),
    deferUpdate: vi.fn(async () => {
      order.push('deferUpdate');
      step.deferred = true;
    }),
    editReply: vi.fn<Send>(async () => {
      order.push('editReply');
    }),
    showModal: vi.fn<Send>(async () => {
      order.push('showModal');
      step.replied = true;
    }),
  };
  return step;
}

/** Every payload the step sent (reply, editReply, showModal), in order. */
export function sent(step: FakeStep): Record<string, unknown>[] {
  return [...step.reply.mock.calls, ...step.editReply.mock.calls, ...step.showModal.mock.calls].map(([payload]) => payload);
}

/** The last text the step showed. */
export function lastText(step: FakeStep): string | undefined {
  const payloads = [...step.reply.mock.calls, ...step.editReply.mock.calls].map(([payload]) => payload);
  return payloads.at(-1)?.content as string | undefined;
}

type Row = { components: Array<Record<string, unknown>> };

/** The custom ids on the components of the step's last edit. */
export function componentIds(step: FakeStep): string[] {
  const rows = (step.editReply.mock.calls.at(-1)?.[0].components ?? []) as Row[];
  return rows.flatMap((row) => row.components.map((component) => component.custom_id as string));
}

/** The select options of the step's last edit. */
export function selectOptions(step: FakeStep): Array<{ label: string; value: string; description?: string }> {
  const rows = (step.editReply.mock.calls.at(-1)?.[0].components ?? []) as Row[];
  return (rows[0]?.components[0]?.options ?? []) as Array<{ label: string; value: string }>;
}
