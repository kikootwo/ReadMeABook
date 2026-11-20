/**
 * Component: "Access" pill on an access request (book already in the library)
 * Documentation: documentation/features/requester-tags.md
 */

import React from 'react';

export function AccessRequestPill() {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full whitespace-nowrap bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200"
      title="Already in the library: approving grants access, with no download"
    >
      Access
    </span>
  );
}
