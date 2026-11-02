/**
 * Component: Apprise {user} Tag Tests
 * Documentation: documentation/backend/services/notifications.md
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationPayload } from '@/lib/services/notification';

const fetchMock = vi.hoisted(() => vi.fn());
const loggerInfo = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({ prisma: {} }));

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
  await new AppriseProvider().send(config, payload(userName));
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

    it('does not send when nothing is left, and logs one info line', async () => {
      await send({ ...STATEFUL, tag: 'user-{user}' }, '');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(loggerInfo).toHaveBeenCalledTimes(1);
      expect(loggerInfo.mock.calls[0][0]).toContain('{user}');
      expect(loggerInfo.mock.calls[0][1]).toEqual({ event: 'request_available' });
    });

    it('does not send when {user} would become the Apprise "all" tag', async () => {
      await send({ ...STATEFUL, tag: '{user}' }, 'All');
      await send({ ...STATEFUL, tag: '2:{user}' }, 'all');
      expect(fetchMock).not.toHaveBeenCalled();
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
      expect(field?.placeholder).toContain('{user}');
    });
  });
});
