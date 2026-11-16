/**
 * Component: Discord /status, Cancel and /delete Test Doubles (shared by the handler tests)
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Linked accounts, request rows and service results as the handlers read them, and a check that
 * every payload a step sent pings nobody.
 */

import { expect } from 'vitest';
import type { FakeStep } from './discord-request-fakes';

export const ADMIN_ROLE = '666666666666666666';
export const ID = '0b6f2c1e-4d6a-4c1e-9a8b-1f2e3d4c5b6a';

export type Account = { id: string; plexUsername: string; role: string; registrationStatus: string; deletedAt: Date | null };

export const account = (overrides: Partial<Account> = {}): Account => ({
  id: 'user-1', plexUsername: 'reader', role: 'user', registrationStatus: 'approved', deletedAt: null, ...overrides,
});
export const admin = (overrides: Partial<Account> = {}) => account({ id: 'admin-1', plexUsername: 'boss', role: 'admin', ...overrides });

/** A request row with the cancel service's fields plus the requester. */
export const record = (userId = 'user-1', status = 'downloading', type = 'audiobook') => ({
  id: ID, userId, status, audiobookId: 'ab-1', type,
  audiobook: { title: 'Book', author: 'Author' }, user: { plexUsername: 'reader' },
});

export const cancelled = (fields: Record<string, unknown> = {}) => ({
  success: true, request: { id: ID, status: 'cancelled', cancelledAt: new Date() }, download: 'none', message: 'Request cancelled.', ...fields,
});

export const deleted = (fields: Record<string, unknown> = {}) => ({
  success: true, message: 'Request deleted successfully', filesDeleted: false, torrentsRemoved: 0, torrentsKeptSeeding: 0,
  torrentsKeptUnlimited: 0, torrentsKeptShared: 0, torrentsKeptNotOwned: 0, ...fields,
});

/** Every payload sent carries no-mention allowedMentions. */
export function expectNoMentions(step: FakeStep) {
  for (const [payload] of [...step.editReply.mock.calls, ...step.reply.mock.calls]) {
    expect(payload).toMatchObject({ allowedMentions: { parse: [] } });
  }
}

type Button = { label: string; custom_id: string };

/** The buttons of the step's last edit. */
export function lastButtons(step: FakeStep): Button[] {
  const rows = (step.editReply.mock.calls.at(-1)?.[0].components ?? []) as Array<{ components: Button[] }>;
  return rows.flatMap((row) => row.components);
}
