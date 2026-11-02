/**
 * Component: User E-Reader Devices Section
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * Lets an admin choose which Audiobookshelf e-reader devices a user's ebooks are emailed to.
 * Hidden when Audiobookshelf reports no devices (including Plex mode).
 */

'use client';

import useSWR from 'swr';
import { authenticatedFetcher } from '@/lib/utils/api';

interface EreaderDevice {
  name: string;
  email: string;
  sendable: boolean;
}

interface EreaderDevicesSectionProps {
  selected: string[];
  onChange: (deviceNames: string[]) => void;
}

export function EreaderDevicesSection({ selected, onChange }: EreaderDevicesSectionProps) {
  const { data } = useSWR<{ devices: EreaderDevice[] }>('/api/admin/settings/ebook/ereader-devices', authenticatedFetcher);
  const devices = data?.devices ?? [];
  if (devices.length === 0) return null;

  // Devices removed from Audiobookshelf stay listed until unticked, so they can be cleared
  const missing = selected.filter((name) => !devices.some((d) => d.name === name));

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  return (
    <div>
      <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
        E-Reader Devices
      </h3>
      <div className="space-y-2">
        {devices.map((device) => (
          <label
            key={device.name}
            className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
          >
            <input
              type="checkbox"
              checked={selected.includes(device.name)}
              onChange={() => toggle(device.name)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{device.name}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{device.email}</div>
              {!device.sendable && (
                <div className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  Audiobookshelf won&apos;t let RMAB send to this device. Allow RMAB&apos;s Audiobookshelf user on
                  it in Audiobookshelf (Settings → Email).
                </div>
              )}
            </div>
          </label>
        ))}
        {missing.map((name) => (
          <label key={name} className="flex items-start gap-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg cursor-pointer">
            <input
              type="checkbox"
              checked
              onChange={() => toggle(name)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{name}</div>
              <div className="text-xs text-amber-700 dark:text-amber-400">No longer in Audiobookshelf</div>
            </div>
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
        Ebooks this user requests are emailed to the ticked devices when e-reader delivery is on (Settings → E-book Sidecar).
      </p>
    </div>
  );
}
