/**
 * Utility: Permission Resolution
 * Documentation: documentation/admin-dashboard.md
 *
 * Resolves effective user permissions from the tri-state pattern:
 *   admin → always granted
 *   per-user setting (true/false) → explicit override
 *   null → falls back to global setting
 */

import { prisma } from '@/lib/db';

/**
 * Resolve a tri-state permission (admin → per-user → global fallback).
 * @param userRole - 'admin' or 'user'
 * @param userValue - per-user setting (true, false, or null)
 * @param globalValue - global setting from Configuration table
 * @returns effective boolean permission
 */
export function resolvePermission(
  userRole: string,
  userValue: boolean | null,
  globalValue: boolean
): boolean {
  if (userRole === 'admin') return true;
  if (userValue === true) return true;
  if (userValue === false) return false;
  return globalValue;
}

/**
 * Fetch a global boolean setting from the Configuration table.
 * @param key - Configuration key
 * @param defaultValue - Value to use if the key doesn't exist
 */
export async function getGlobalBooleanSetting(
  key: string,
  defaultValue: boolean = true
): Promise<boolean> {
  const config = await prisma.configuration.findUnique({
    where: { key },
  });
  return config == null ? defaultValue : config.value === 'true';
}

/**
 * Resolve a user's effective interactive search access permission.
 */
export async function resolveInteractiveSearchAccess(
  userRole: string,
  userInteractiveSearchAccess: boolean | null
): Promise<boolean> {
  if (userRole === 'admin') return true;
  if (userInteractiveSearchAccess === true) return true;
  if (userInteractiveSearchAccess === false) return false;
  return getGlobalBooleanSetting('interactive_search_access', true);
}

/**
 * Resolve a user's effective download access permission.
 */
export async function resolveDownloadAccess(
  userRole: string,
  userDownloadAccess: boolean | null
): Promise<boolean> {
  if (userRole === 'admin') return true;
  if (userDownloadAccess === true) return true;
  if (userDownloadAccess === false) return false;
  return getGlobalBooleanSetting('download_access', true);
}
