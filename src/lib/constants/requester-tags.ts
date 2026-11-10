/**
 * Component: Requester tag constants (#232)
 * Documentation: documentation/features/requester-tags.md
 */

/** Config key of the setting ('true' = on; absent = off). */
export const REQUESTER_TAG_SETTING_KEY = 'audiobookshelf.tag_requester';
/** Every requester tag starts with this. */
export const REQUESTER_TAG_PREFIX = 'req:';
/** Most items a scan run repairs (books delivered in that run don't count). */
export const REQUESTER_TAG_REPAIR_CAP = 25;
/** Consecutive ABS failures that stop a run. */
export const REQUESTER_TAG_FAILURE_LIMIT = 3;
/** The backfill re-reads the setting every this many items. */
export const REQUESTER_TAG_RECHECK_EVERY = 25;
/** Listed item ids per candidate read (keeps each query's IN list small on a large library). */
export const REQUESTER_TAG_ITEM_IDS_PER_READ = 1000;
