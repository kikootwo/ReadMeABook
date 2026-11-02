/**
 * Component: Audiobookshelf E-Reader Devices
 * Documentation: documentation/integrations/ebook-sidecar.md
 *
 * E-reader devices live in Audiobookshelf's email settings. RMAB emails an ebook to a device
 * through ABS, authenticated as the user that owns RMAB's ABS API token, so ABS only allows
 * devices that user may access (`EmailSettings.checkUserCanAccessDevice` in ABS).
 */

import { absRequest } from './api';
import { RMABLogger } from '@/lib/utils/logger';

const logger = RMABLogger.create('Audiobookshelf.Ereader');

export interface ABSEreaderDevice {
  name: string;
  email: string;
  /** 'adminOrUp' (ABS default) | 'userOrUp' | 'guestOrUp' | 'specificUsers' */
  availabilityOption?: string;
  /** ABS user ids allowed when availabilityOption is 'specificUsers' */
  users?: string[];
}

export interface EreaderDevice {
  name: string;
  email: string;
  /** Whether ABS lets RMAB's token user send to this device */
  sendable: boolean;
}

interface ABSUser {
  id: string;
  type: string;
}

/** Mirrors ABS's access check for the token user */
function canSendTo(device: ABSEreaderDevice, user: ABSUser): boolean {
  const isAdminOrUp = user.type === 'admin' || user.type === 'root';
  switch (device.availabilityOption || 'adminOrUp') {
    case 'adminOrUp':
      return isAdminOrUp;
    case 'userOrUp':
      return isAdminOrUp || user.type === 'user';
    case 'guestOrUp':
      return true;
    case 'specificUsers':
      return (device.users || []).includes(user.id);
    default:
      return false;
  }
}

/**
 * The e-reader devices configured in Audiobookshelf (needs an admin token), each marked with
 * whether RMAB's token user may send to it.
 */
export async function getEreaderDevices(): Promise<EreaderDevice[]> {
  const [{ settings }, me] = await Promise.all([
    absRequest<{ settings?: { ereaderDevices?: ABSEreaderDevice[] } }>('/emails/settings'),
    absRequest<ABSUser>('/me'),
  ]);
  return (settings?.ereaderDevices || []).map((device) => ({
    name: device.name,
    email: device.email,
    sendable: canSendTo(device, me),
  }));
}

/**
 * Email a library item's primary ebook to an e-reader device. ABS answers 200 with plain text.
 *
 * @param libraryItemId - ABS library item whose `media.ebookFile` is sent
 * @param deviceName - Device name as configured in ABS
 */
export async function sendEbookToDevice(libraryItemId: string, deviceName: string): Promise<void> {
  await absRequest('/emails/send-ebook-to-device', {
    method: 'POST',
    body: { libraryItemId, deviceName },
    skipResponseBody: true,
  });
  logger.info(`Sent ebook for item ${libraryItemId} to e-reader device "${deviceName}"`);
}
