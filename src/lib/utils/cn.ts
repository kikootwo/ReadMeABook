/**
 * Component: Class Name Utility
 * Documentation: documentation/frontend/components.md
 */

import clsx, { ClassValue } from 'clsx';

/**
 * Utility for merging Tailwind CSS classes
 * Handles conditional classes and removes duplicates
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
