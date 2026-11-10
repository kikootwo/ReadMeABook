/**
 * Component: Explicit mark constants (#542)
 * Documentation: documentation/features/explicit-flag.md
 */

/** Config key of the admin setting ('true' = on; absent or anything else = off, the default). */
export const EXPLICIT_MARK_SETTING_KEY = 'audiobookshelf.explicit_mark_enabled';

/** Refusal text of PUT /api/requests/[id]/explicit while the setting is off. */
export const EXPLICIT_MARK_OFF_MESSAGE = 'The Explicit mark is turned off in Settings';
