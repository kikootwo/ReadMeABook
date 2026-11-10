/**
 * Component: Explicit mark option (Audiobookshelf library settings, #542)
 * Documentation: documentation/features/explicit-flag.md
 *
 * The switch for audiobookshelf.explicit_mark_enabled (off by default). While it is off the
 * Explicit mark is nowhere in the app and ReadMeABook writes nothing to Audiobookshelf for it.
 */

import { useId } from 'react';
import { Settings } from '../../lib/types';

interface ExplicitMarkOptionProps {
  settings: Settings;
  onChange: (settings: Settings) => void;
}

export function ExplicitMarkOption({ settings, onChange }: ExplicitMarkOptionProps) {
  const on = settings.audiobookshelf.explicitMarkEnabled === true;
  const id = useId();
  const switchId = `${id}-switch`;
  const helpId = `${id}-help`;
  return (
    <div className="flex items-start gap-4">
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby={helpId}
        onClick={() => onChange({ ...settings, audiobookshelf: { ...settings.audiobookshelf, explicitMarkEnabled: !on } })}
        className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 mt-0.5"
        style={{ backgroundColor: on ? '#3b82f6' : '#d1d5db' }}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
      <div className="flex-1 min-w-0">
        <label htmlFor={switchId} className="text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
          Explicit mark on requests
        </label>
        <p id={helpId} className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Adds an Explicit checkbox to requests. ReadMeABook turns on a marked book&apos;s Explicit flag in Audiobookshelf.
        </p>
      </div>
    </div>
  );
}
