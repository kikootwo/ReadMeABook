/**
 * Component: Requester tag option (Audiobookshelf library settings, #232)
 * Documentation: documentation/features/requester-tags.md
 *
 * The "Tag items with the requester's username" checkbox, what it exposes, and an amber box
 * (while ticked) listing names that share a tag, pending or rejected lookalikes, names that
 * leave no tag, and tags also held by deleted users.
 */

import { Settings } from '../../lib/types';

interface RequesterTagOptionProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

const quote = (names: string[]) => names.map((n) => `"${n}"`).join(', ');

function WarningBox({ settings }: { settings: Settings }) {
  const w = settings.audiobookshelf.requesterTagWarnings;
  if (!w) return null;
  const lines: string[] = [
    ...w.shared.map((s) => `${s.tag} is shared by ${quote(s.usernames)}: none of them is tagged.`),
    ...w.lookalikes.map((l) =>
      `${l.tag} is also the tag of ${l.status === 'rejected' ? 'rejected' : 'pending'} user "${l.username}": if you approve them, neither is tagged.`),
    ...w.untaggable.map((n) => `"${n}" has no letters or digits a tag can use and is never tagged.`),
    ...w.deletedOverlaps.map((d) =>
      `${d.tag} (user "${d.username}") is also the tag of deleted user ${quote(d.deletedUsernames)}; books tagged for them still carry it.`),
  ];
  if (lines.length === 0) return null;
  return (
    <div
      data-testid="requester-tag-warnings"
      className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800 mt-2"
    >
      <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Some users can&apos;t be tagged as expected</p>
      <ul className="text-sm text-amber-700 dark:text-amber-300 mt-1 list-disc pl-5 space-y-1 break-words">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="text-sm text-amber-700 dark:text-amber-300 mt-2">
        Usernames come from Plex or your OIDC provider; a change there applies at the user&apos;s next sign-in.
        Local usernames can&apos;t be changed here: tag those users&apos; books in Audiobookshelf by hand.
      </p>
    </div>
  );
}

export function RequesterTagOption({ settings, onChange }: RequesterTagOptionProps) {
  const checked = settings.audiobookshelf.tagRequester === true;
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange({ ...settings, audiobookshelf: { ...settings.audiobookshelf, tagRequester: e.target.checked } })}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
        />
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Tag items with the requester&apos;s username
          </span>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            When a requested audiobook becomes available, ReadMeABook adds a <code>req:&lt;username&gt;</code> tag
            to its Audiobookshelf item and keeps the item&apos;s other tags. Audiobookshelf can use these tags to
            limit what each user sees.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Every Audiobookshelf user with access to this library can see these tags, including the full list in
            its tag filter. Users who sign in with OIDC and have no username are tagged with their email address
            (for example <code>req:johnsmithexamplecom</code>), or their sign-in ID when there is no email.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            While this is on, a <code>req:</code> tag removed in Audiobookshelf comes back on the next library
            scan; to take a book away from one user, turn this off or change that user&apos;s access in
            Audiobookshelf. Turning this on also tags books that are already available. Turning it off
            doesn&apos;t remove tags already written.
          </p>
        </div>
      </label>
      {checked && <WarningBox settings={settings} />}
    </div>
  );
}
