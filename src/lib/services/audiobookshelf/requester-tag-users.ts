/**
 * Component: Requester tags, username → tag map and its warnings (#232)
 * Documentation: documentation/features/requester-tags.md
 *
 * Turns usernames into `req:<username>` tags and decides who can be tagged. The tag set is every
 * non-deleted user whose registration is approved (or predates registration status). Two or more
 * of them with one tag are refused on every path; a pending or rejected lookalike, a deleted
 * user's tag and a name that leaves no tag are warnings only. Used by the tagger (one users query
 * per run) and by the settings GET (the amber box).
 */

import { prisma } from '@/lib/db';
import type { RMABLogger } from '@/lib/utils/logger';
import { REQUESTER_TAG_PREFIX } from '@/lib/constants/requester-tags';

/** A users row as the tagger reads it. */
export interface TagUser {
  id: string;
  plexUsername: string;
  deletedAt: Date | null;
  registrationStatus: string | null;
  /** 'admin' or 'user'; an admin's request that RMAB never downloaded is not tagged */
  role?: string;
}

export interface RequesterTagWarnings {
  /** Tags shared by two or more taggable users: none of them is tagged */
  shared: { tag: string; usernames: string[] }[];
  /** Pending or rejected users whose tag equals a taggable user's tag */
  lookalikes: { tag: string; username: string; status: string; matches: string[] }[];
  /** Taggable users whose name leaves no letters or digits a tag can use */
  untaggable: string[];
  /** Taggable users whose tag equals a deleted user's tag */
  deletedOverlaps: { tag: string; username: string; deletedUsernames: string[] }[];
}

export interface RequesterTagMap {
  usersById: Map<string, TagUser>;
  /** user id → tag, for taggable users with a tag of their own */
  tagByUser: Map<string, string>;
  /** user ids that are deleted or not approved: their requests are never tagged */
  excludedUsers: Set<string>;
  /** user ids whose tag is shared (refused) or empty */
  refusedUsers: Map<string, 'shared' | 'no_tag'>;
  warnings: RequesterTagWarnings;
}

/**
 * `req:<username>` for a username, or '' when nothing usable remains: NFKD, combining marks
 * dropped, trimmed, lowercased, whitespace runs → `_`, everything outside `[a-z0-9_-]` dropped.
 * A result with no letter or digit gives '' (`---`, `_`, emoji only), and so does a name with
 * letters none of which survive (not `req:_1` for "Дочь 1").
 */
export function requesterTag(username: string | null | undefined): string {
  if (typeof username !== 'string') return '';
  const suffix = username
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]/g, '');
  if (!/[a-z0-9]/.test(suffix)) return '';
  if (/\p{L}/u.test(username) && !/[a-z]/.test(suffix)) return '';
  return `${REQUESTER_TAG_PREFIX}${suffix}`;
}

/** Taggable: not deleted, registration approved or never set. */
export function isTaggableUser(user: TagUser): boolean {
  return !user.deletedAt && (user.registrationStatus === null || user.registrationStatus === 'approved');
}

function groupByTag(users: TagUser[]): Map<string, TagUser[]> {
  const groups = new Map<string, TagUser[]>();
  for (const user of users) {
    const tag = requesterTag(user.plexUsername);
    if (!tag) continue;
    groups.set(tag, [...(groups.get(tag) ?? []), user]);
  }
  return groups;
}

const names = (users: TagUser[]) => users.map((u) => u.plexUsername);

export function buildRequesterTagMap(users: TagUser[]): RequesterTagMap {
  const taggable = users.filter(isTaggableUser);
  const live = groupByTag(taggable);
  const map: RequesterTagMap = {
    usersById: new Map(users.map((u) => [u.id, u])),
    tagByUser: new Map(),
    excludedUsers: new Set(users.filter((u) => !isTaggableUser(u)).map((u) => u.id)),
    refusedUsers: new Map(),
    warnings: { shared: [], lookalikes: [], untaggable: [], deletedOverlaps: [] },
  };

  for (const user of taggable) {
    if (!requesterTag(user.plexUsername)) {
      map.refusedUsers.set(user.id, 'no_tag');
      map.warnings.untaggable.push(user.plexUsername);
    }
  }
  for (const [tag, group] of live) {
    if (group.length > 1) {
      group.forEach((u) => map.refusedUsers.set(u.id, 'shared'));
      map.warnings.shared.push({ tag, usernames: names(group) });
    } else {
      map.tagByUser.set(group[0].id, tag);
    }
  }

  const waiting = users.filter((u) => !u.deletedAt && !isTaggableUser(u));
  for (const [tag, group] of groupByTag(waiting)) {
    const matches = live.get(tag);
    if (!matches) continue;
    for (const user of group) {
      map.warnings.lookalikes.push({ tag, username: user.plexUsername, status: user.registrationStatus ?? 'pending_approval', matches: names(matches) });
    }
  }

  for (const [tag, deleted] of groupByTag(users.filter((u) => u.deletedAt))) {
    for (const user of live.get(tag) ?? []) {
      map.warnings.deletedOverlaps.push({ tag, username: user.plexUsername, deletedUsernames: names(deleted) });
    }
  }
  return map;
}

export async function loadRequesterTagMap(): Promise<RequesterTagMap> {
  const users = await prisma.user.findMany({
    select: { id: true, plexUsername: true, deletedAt: true, registrationStatus: true, role: true },
  });
  return buildRequesterTagMap(users);
}

const EMPTY_WARNINGS = (): RequesterTagWarnings => ({ shared: [], lookalikes: [], untaggable: [], deletedOverlaps: [] });

/** Warnings for the settings page; a failed users query gives empty lists, never an error. */
export async function loadRequesterTagWarnings(logger?: RMABLogger): Promise<RequesterTagWarnings> {
  try {
    return (await loadRequesterTagMap()).warnings;
  } catch (error) {
    logger?.warn(`Requester tag warnings unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return EMPTY_WARNINGS();
  }
}

/**
 * Logs each warning that concerns this run's candidates, once per tag (or user, for names that
 * leave no tag) per run. `seen` is the run's de-duplication set.
 */
export function logRunWarning(
  map: RequesterTagMap,
  user: TagUser | undefined,
  seen: Set<string>,
  logger: RMABLogger
): void {
  if (!user) return;
  const once = (key: string, line: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    logger.warn(line);
  };
  const reason = map.refusedUsers.get(user.id);
  if (reason === 'no_tag') {
    once(`none:${user.id}`, `Not tagging requests of "${user.plexUsername}": the username has no letters or digits a tag can use`);
    return;
  }
  const tag = requesterTag(user.plexUsername);
  if (reason === 'shared') {
    const shared = map.warnings.shared.find((s) => s.tag === tag);
    once(`shared:${tag}`, `Not tagging with ${tag}: shared by ${shared?.usernames.join(', ') ?? user.plexUsername}`);
    return;
  }
  const looks = map.warnings.lookalikes.filter((l) => l.tag === tag);
  if (looks.length > 0) {
    const who = looks.map((l) => `${l.status === 'rejected' ? 'rejected' : 'pending'} user "${l.username}"`).join(', ');
    once(`look:${tag}`, `${tag} is also the tag of ${who}: if they are approved, neither is tagged`);
  }
  for (const overlap of map.warnings.deletedOverlaps.filter((o) => o.tag === tag)) {
    once(`deleted:${tag}`, `${tag} is also the tag of deleted user ${overlap.deletedUsernames.map((n) => `"${n}"`).join(', ')}; books tagged for them still carry it`);
  }
}
