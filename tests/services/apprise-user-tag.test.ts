/**
 * Component: Apprise {user} Tag Tests
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPayload } from '@/lib/services/notification';

const fetchMock = vi.hoisted(() => vi.fn());
const loggerInfo = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: { notificationBackend: { findMany: findManyMock } } }));

vi.mock('@/lib/services/encryption.service', () => ({
  getEncryptionService: () => ({ isEncryptedFormat: () => false, decrypt: (v: string) => v, encrypt: (v: string) => v }),
}));

vi.mock('@/lib/utils/logger', () => {
  const instance = { info: loggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { RMABLogger: { create: () => instance } };
});

const STATEFUL = { serverUrl: 'http://apprise:8000', configKey: 'family' };

function payload(userName: string, event: NotificationPayload['event'] = 'request_available'): NotificationPayload {
  return {
    event,
    requestId: 'req-1',
    title: 'Test Book',
    author: 'Test Author',
    userName,
    requestType: 'audiobook',
    timestamp: new Date('2026-01-01T00:00:00Z'),
  };
}

async function send(config: Record<string, string>, userName: string) {
  const { AppriseProvider } = await import('@/lib/services/notification');
  return new AppriseProvider().send(config, payload(userName));
}

/** The tag the provider posted to Apprise (undefined when no tag key was sent) */
function sentTag(): string | undefined {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return JSON.parse(fetchMock.mock.calls[0][1].body).tag;
}

async function tagFor(tag: string, userName: string): Promise<string | undefined> {
  await send({ ...STATEFUL, tag }, userName);
  return sentTag();
}

describe('Apprise Tag with {user}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true, text: async () => 'ok' });
    vi.stubGlobal('fetch', fetchMock);
  });

  describe('literal tags', () => {
    it('sends a tag without {user} exactly as configured', async () => {
      expect(await tagFor('admin ,  audiobooks+Family', 'Jane Doe')).toBe('admin ,  audiobooks+Family');
    });

    it('sends a tag without {user} even when there is no requester', async () => {
      expect(await tagFor('admin', '')).toBe('admin');
    });

    it('sends a tag with | and & but no {user} byte for byte', async () => {
      expect(await tagFor('admin|family & kids', 'Jane Doe')).toBe('admin|family & kids');
    });
  });

  describe('expansion', () => {
    it('replaces {user} with the lowercased username, spaces as -', async () => {
      expect(await tagFor('user-{user}', 'Jane Doe')).toBe('user-jane-doe');
    });

    it('lowercases', async () => {
      expect(await tagFor('{user}', 'ALICE')).toBe('alice');
    });

    it('turns punctuation runs into one - and trims - and _ at the ends', async () => {
      expect(await tagFor('user-{user}', "o'Brien.Mike@example.com")).toBe('user-o-brien-mike-example-com');
      vi.clearAllMocks();
      expect(await tagFor('user-{user}', '  _Bob -- Smith_ ')).toBe('user-bob-smith');
    });

    it('never passes an Apprise separator or operator through', async () => {
      expect(await tagFor('user-{user}', 'a,b c+d;e[f]:g\th')).toBe('user-a-b-c-d-e-f-g-h');
    });

    it('removes accents from non-ASCII letters', async () => {
      expect(await tagFor('user-{user}', 'José Núñez')).toBe('user-jose-nunez');
    });

    it('keeps digits and underscores inside the name', async () => {
      expect(await tagFor('user-{user}', 'reader_42')).toBe('user-reader_42');
    });
  });

  describe('OR and AND forms', () => {
    it('expands {user} inside an OR list', async () => {
      expect(await tagFor('admin, user-{user}', 'Jane')).toBe('admin, user-jane');
    });

    it('expands {user} inside an AND group (space or +)', async () => {
      expect(await tagFor('books user-{user}', 'Jane')).toBe('books user-jane');
      vi.clearAllMocks();
      expect(await tagFor('books+user-{user}', 'Jane')).toBe('books user-jane');
    });

    it('drops a whole AND group whose {user} cannot be filled, so it never widens', async () => {
      expect(await tagFor('books user-{user}, admin', '')).toBe('admin');
    });

    it('reads | as OR, the way apprise-api splits a tag', async () => {
      expect(await tagFor('admin|user-{user}', 'Jane')).toBe('admin, user-jane');
      vi.clearAllMocks();
      expect(await tagFor('admin | user-{user}', 'Jane')).toBe('admin, user-jane');
    });

    it('reads & and + (with or without spaces) as AND', async () => {
      expect(await tagFor('admin&user-{user}', 'Jane')).toBe('admin user-jane');
      vi.clearAllMocks();
      expect(await tagFor('admin + user-{user}', 'Jane')).toBe('admin user-jane');
    });

    it('keeps the other OR group when {user} is in a |-separated group with no requester', async () => {
      expect(await tagFor('admin|user-{user}', '')).toBe('admin');
    });

    it('drops an &-joined AND group with no requester instead of widening it to admin', async () => {
      expect(await tagFor('admin&user-{user}|owner', '')).toBe('owner');
      vi.clearAllMocks();
      expect(await send({ ...STATEFUL, tag: 'admin&user-{user}' }, '')).toEqual({ skipped: true, reason: expect.stringContaining('no requester') });
      expect(await send({ ...STATEFUL, tag: 'admin + user-{user}' }, '')).toEqual({ skipped: true, reason: expect.stringContaining('no requester') });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('no requester', () => {
    it('drops the {user} part and keeps the rest', async () => {
      expect(await tagFor('admin, user-{user}', '')).toBe('admin');
    });

    it('treats the "Unknown User" fallback as no requester', async () => {
      expect(await tagFor('admin, user-{user}', 'Unknown User')).toBe('admin');
    });

    it('treats a name with no a-z or 0-9 as no requester', async () => {
      expect(await tagFor('admin, user-{user}', '李明')).toBe('admin');
    });

    it('treats a name whose letters all drop out as no requester, not its digits', async () => {
      expect(await tagFor('admin, user-{user}', 'Дочь 1')).toBe('admin');
    });

    it('keeps a name made only of digits, and the a-z part of a mixed-script name', async () => {
      expect(await tagFor('user-{user}', '12345')).toBe('user-12345');
      vi.clearAllMocks();
      expect(await tagFor('user-{user}', '李明 Lee')).toBe('user-lee');
    });

    it('gives names that differ only in case, spaces or punctuation the same tag', async () => {
      expect(await tagFor('user-{user}', 'Jane Doe')).toBe('user-jane-doe');
      vi.clearAllMocks();
      expect(await tagFor('user-{user}', 'jane.doe')).toBe('user-jane-doe');
    });

    it('does not send when nothing is left, and says why without the username', async () => {
      const result = await send({ ...STATEFUL, tag: 'user-{user}' }, '');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({ skipped: true, reason: expect.stringContaining('no requester') });
    });

    it('does not send when {user} would become the Apprise "all" tag', async () => {
      for (const [tag, name] of [['{user}', 'All'], ['2:{user}', 'all'], ['{user}', 'All!'], ['{user}', 'ａｌｌ']]) {
        const result = await send({ ...STATEFUL, tag }, name);
        expect(result).toEqual({ skipped: true, reason: expect.stringContaining("'all'") });
        expect(JSON.stringify(result)).not.toMatch(/All!|ａｌｌ/);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never lets a name become "all" through a | group: sends only to the other group', async () => {
      for (const name of ['all', 'All!', 'ａｌｌ']) {
        vi.clearAllMocks();
        expect(await tagFor('admin|{user}', name)).toBe('admin');
      }
    });
  });

  describe('notification service log', () => {
    const backend = { id: 'b1', name: 'Family Apprise', type: 'apprise', enabled: true, events: ['request_available'] };

    async function sendThroughService(tag: string, userName: string) {
      findManyMock.mockResolvedValue([{ ...backend, config: { ...STATEFUL, tag } }]);
      const { NotificationService } = await import('@/lib/services/notification');
      await new NotificationService().sendNotification(payload(userName));
      return loggerInfo.mock.calls.map((c) => [String(c[0]), JSON.stringify(c[1] ?? {})].join(' '));
    }

    it('logs a skipped backend as skipped with the reason, not as succeeded', async () => {
      const lines = await sendThroughService('user-{user}', '');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lines).toContainEqual(expect.stringContaining('0 succeeded, 1 skipped, 0 failed'));
      expect(lines).toContainEqual(expect.stringMatching(/Skipped backend Family Apprise: .*no requester/));
    });

    it('says when the skip is because the name would mean every target, without the name', async () => {
      const lines = await sendThroughService('{user}', 'ALL');
      expect(lines).toContainEqual(expect.stringMatching(/Skipped backend Family Apprise: .*every Apprise target/));
      expect(lines.join('\n')).not.toMatch(/ALL|apprise:8000|"family"/);
    });

    it('logs a backend that sent as succeeded', async () => {
      const lines = await sendThroughService('user-{user}', 'Jane');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(lines).toContainEqual(expect.stringContaining('1 succeeded, 0 skipped, 0 failed'));
      expect(lines.join('\n')).not.toContain('Skipped backend');
    });
  });

  describe('stateless mode (urls)', () => {
    it('ignores the Tag field, {user} included, and still sends', async () => {
      await send({ serverUrl: 'http://apprise:8000', urls: 'mailto://a@example.com', tag: 'user-{user}' }, '');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('http://apprise:8000/notify/');
      expect(sentTag()).toBeUndefined();
    });
  });

  describe('settings form', () => {
    it('explains {user} and that the Tag needs a Config Key', async () => {
      const { AppriseProvider } = await import('@/lib/services/notification');
      const field = new AppriseProvider().metadata.configFields.find((f) => f.name === 'tag');
      expect(field?.helpText).toContain('{user}');
      expect(field?.helpText).toContain('Config Key only');
      expect(field?.helpText).toContain('lowercase with - for spaces and punctuation');
      expect(field?.helpText).toContain('Jane Doe → jane-doe');
      expect(field?.placeholder).toContain('{user}');
    });
  });
});
