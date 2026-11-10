/**
 * Component: Download Category Field
 * Documentation: documentation/phase3/download-clients.md
 *
 * The client's category (or label) with the client's own names as suggestions after a passed
 * Test, and an amber note when the name already exists there (ReadMeABook leaves it alone).
 */

'use client';

import React, { useId } from 'react';
import { Input } from '@/components/ui/Input';
import { existingCategoryNote } from '@/lib/utils/download-category';

interface DownloadCategoryFieldProps {
  type?: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** The client's names, fetched after a passed Test (SABnzbd's `*` already left out) */
  suggestions: string[];
  /** The name already exists in the client and isn't ReadMeABook's own */
  inClient: boolean;
  /** Where qBittorrent files go, for its note */
  downloadsTo: string;
}

export function DownloadCategoryField({ type, value, onChange, error, suggestions, inClient, downloadsTo }: DownloadCategoryFieldProps) {
  const id = useId();
  const note = inClient ? existingCategoryNote(type, downloadsTo) : null;

  return (
    <div>
      <label htmlFor={`${id}-input`} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
        Category
      </label>
      <Input
        id={`${id}-input`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="readmeabook"
        error={error}
        list={suggestions.length > 0 ? `${id}-options` : undefined}
        autoComplete="off"
        {...(note && !error ? { 'aria-describedby': `${id}-note` } : {})}
      />
      {suggestions.length > 0 && (
        <datalist id={`${id}-options`}>
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      )}
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Category or label ReadMeABook gives its downloads.
      </p>
      {note && (
        <p id={`${id}-note`} className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
          {note}
        </p>
      )}
    </div>
  );
}
