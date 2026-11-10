/**
 * Component: Requester tag option (Audiobookshelf library settings, #232)
 * Documentation: documentation/features/requester-tags.md
 *
 * The "Tag items with the requester's username" checkbox (its label is the title only; the help
 * text describes it for screen readers), what it exposes, and an amber box (while ticked) listing
 * names that share a tag, pending or rejected lookalikes, names that leave no tag, and tags also
 * held by deleted users.
 */

import { useId } from 'react';
import { Settings } from '../../lib/types';

interface RequesterTagOptionProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

const quote = (names: string[]) => names.map((n) => `"${n}"`).join(', ');
const nobodyTagged = (count: number) => (count === 2 ? 'neither is tagged' : 'none of them is tagged');

function WarningBox({ settings }: { settings: Settings }) {
  const w = settings.audiobookshelf.requesterTagWarnings;
  if (!w) return null;
  const lines: string[] = [
    ...w.shared.map((s) => `${s.tag} is shared by ${quote(s.usernames)}: ${nobodyTagged(s.usernames.length)}.`),
    ...w.lookalikes.map((l) =>
      `${l.tag} is also the tag of ${l.status === 'rejected' ? 'rejected' : 'pending'} user "${l.username}": if you approve them, neither is tagged.`),
    ...w.untaggable.map((n) => `"${n}" can't be turned into a tag and is never tagged.`),
    ...w.deletedOverlaps.map((d) =>
      `${d.tag} (user "${d.username}") is also the tag of deleted user ${quote(d.deletedUsernames)}; books tagged for them still carry it.`),
  ];
  if (lines.length === 0) return null;
  // Renaming helps only names that can't be tagged now; a shared tag added by hand would show the
  // book to every user who holds it, so the advice is a tag of the admin's own
  const fixable = w.shared.length > 0 || w.untaggable.length > 0;
  return (
    <div
      data-testid="requester-tag-warnings"
      className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800 mt-2"
    >
      <p className="text-sm font-medium text-amber-900 dark:text-amber-100">Some users can&apos;t be tagged as expected</p>
      <ul className="text-sm text-amber-700 dark:text-amber-300 mt-1 list-disc pl-5 space-y-1 break-words">
        {lines.map((line) => <li key={line}>{line}</li>)}
      </ul>
      {fixable && (
        <p data-testid="requester-tag-advice" className="text-sm text-amber-700 dark:text-amber-300 mt-2">
          Usernames come from Plex or your OIDC provider; a change there applies at the user&apos;s next sign-in.
          Local usernames can&apos;t be changed here: give those users&apos; books a tag of your own in
          Audiobookshelf{w.shared.length > 0 ? ', not the shared one, which would show the book to every user who has it' : ''}.
        </p>
      )}
    </div>
  );
}

export function RequesterTagOption({ settings, onChange }: RequesterTagOptionProps) {
  const checked = settings.audiobookshelf.tagRequester === true;
  const id = useId();
  const inputId = `${id}-input`;
  const helpId = `${id}-help`;
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          aria-describedby={helpId}
          onChange={(e) => onChange({ ...settings, audiobookshelf: { ...settings.audiobookshelf, tagRequester: e.target.checked } })}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800"
        />
        <div className="flex-1 min-w-0">
          <label htmlFor={inputId} className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
            Tag items with the requester&apos;s username
          </label>
          <div id={helpId}>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              When a requested audiobook becomes available, ReadMeABook adds <code className="whitespace-nowrap">req:&lt;username&gt;</code> to its
              Audiobookshelf item, keeping its other tags, so Audiobookshelf can limit each user to their own books.
              Turning this on also tags books already available; turning it off removes no tags.
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Every user of this Audiobookshelf library can see all requesters&apos; usernames in its tag filter.
              OIDC users without a username are tagged with their email address (<code>req:johnsmithexamplecom</code>)
              or sign-in ID. While this is on, a removed <code>req:</code> tag comes back on the next scan; to hide a
              book from one user, change their access in Audiobookshelf.
            </p>
          </div>
        </div>
      </div>
      {checked && <WarningBox settings={settings} />}
    </div>
  );
}
