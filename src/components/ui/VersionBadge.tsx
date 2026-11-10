/**
 * Component: Version Badge
 * Documentation: documentation/frontend/components.md
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';

const GITHUB_REPO = 'kikootwo/ReadMeABook';
const REMOTE_PACKAGE_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/refs/heads/main/package.json`;
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

function compareVersions(current: string, latest: string): number {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const a = parse(current);
  const b = parse(latest);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (b[i] || 0) - (a[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

interface VersionBadgeProps {
  /**
   * From 1024 to 1279 px (lg) only the update notice shows, as a dot: the header's inline nav needs
   * the room. With no update the badge is hidden in that band.
   */
  compactAtLg?: boolean;
}

export function VersionBadge({ compactAtLg = false }: VersionBadgeProps = {}) {
  const [version, setVersion] = useState<string | null>(null);
  const [rawVersion, setRawVersion] = useState<string | null>(null);
  const [commit, setCommit] = useState<string | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    // Try to get version from build-time env var first (instant, no API call)
    const buildTimeVersion = process.env.NEXT_PUBLIC_APP_VERSION;

    if (buildTimeVersion && buildTimeVersion !== 'unknown') {
      setVersion(`v${buildTimeVersion}`);
      setRawVersion(buildTimeVersion);
      // Also get commit for tooltip if available
      const buildTimeCommit = process.env.NEXT_PUBLIC_GIT_COMMIT;
      if (buildTimeCommit && buildTimeCommit !== 'unknown') {
        const shortCommit = buildTimeCommit.length >= 7
          ? buildTimeCommit.substring(0, 7)
          : buildTimeCommit;
        setCommit(shortCommit);
      }
    } else {
      // Fallback to API call if build-time env var is not available
      fetch('/api/version')
        .then((res) => res.json())
        .then((data) => {
          setVersion(data.version);
          setRawVersion(data.fullVersion);
          if (data.commit && data.commit !== 'unknown') {
            setCommit(data.commit.substring(0, 7));
          }
        })
        .catch((error) => {
          console.error('Failed to fetch version:', error);
          setVersion('vDEV');
        });
    }
  }, []);

  const checkForUpdates = useCallback(() => {
    if (!rawVersion || rawVersion === 'unknown') return;

    fetch(REMOTE_PACKAGE_URL)
      .then((res) => res.json())
      .then((data) => {
        if (data.version) {
          setLatestVersion(data.version);
          setUpdateAvailable(compareVersions(rawVersion, data.version) > 0);
        }
      })
      .catch(() => {
        // Silently fail - update check is non-critical
      });
  }, [rawVersion]);

  // Check for updates on mount and periodically (every 6 hours)
  useEffect(() => {
    if (!rawVersion || rawVersion === 'unknown') return;

    checkForUpdates();
    const interval = setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [rawVersion, checkForUpdates]);

  if (!version) {
    return null;
  }

  const releaseUrl = rawVersion && rawVersion !== 'unknown'
    ? `https://github.com/${GITHUB_REPO}/releases/tag/v${rawVersion}`
    : `https://github.com/${GITHUB_REPO}/releases`;

  const tooltipText = updateAvailable && latestVersion
    ? `${version}${commit ? ` (${commit})` : ''} — Update available: v${latestVersion}`
    : commit ? `${version} (${commit})` : version;

  const showUpdate = updateAvailable && !!latestVersion;
  // the bare dot at 1024-1279 stays a 24 px target, centred
  const compact = compactAtLg ? (showUpdate ? 'lg:px-1.5 lg:min-w-6 lg:justify-center' : 'lg:hidden xl:inline-flex') : '';

  return (
    <a
      href={updateAvailable && latestVersion
        ? `https://github.com/${GITHUB_REPO}/releases/tag/v${latestVersion}`
        : releaseUrl
      }
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 border border-gray-300 dark:border-gray-600 shadow-sm hover:shadow-md transition-shadow no-underline ${compact}`}
      title={tooltipText}
      aria-label={tooltipText}
      data-update-available={showUpdate ? 'true' : undefined}
    >
      <span className={`text-xs font-mono font-medium text-gray-700 dark:text-gray-300 ${compactAtLg ? 'lg:hidden xl:inline' : ''}`}>
        {version}
      </span>
      {showUpdate && (
        <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-amber-600 dark:text-amber-400">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
          </span>
          <span className={compactAtLg ? 'lg:hidden xl:inline' : undefined}>v{latestVersion}</span>
        </span>
      )}
    </a>
  );
}
