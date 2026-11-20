/**
 * Component: User E-Reader Devices Section Tests
 * Documentation: documentation/integrations/ebook-sidecar.md
 */

// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useSWRMock = vi.hoisted(() => vi.fn());
vi.mock('swr', () => ({ default: useSWRMock }));

const devices = [
  { name: 'Kindle', email: 'me@kindle.com', sendable: true },
  { name: 'Kobo', email: 'me@kobo.com', sendable: false },
];

describe('EreaderDevicesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSWRMock.mockReturnValue({ data: { devices } });
  });

  it('renders nothing when Audiobookshelf has no devices', async () => {
    useSWRMock.mockReturnValue({ data: { devices: [] } });
    const { EreaderDevicesSection } = await import('@/components/admin/users/EreaderDevicesSection');

    const { container } = render(<EreaderDevicesSection selected={[]} onChange={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('ticks and unticks devices', async () => {
    const onChange = vi.fn();
    const { EreaderDevicesSection } = await import('@/components/admin/users/EreaderDevicesSection');

    render(<EreaderDevicesSection selected={['Kindle']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Kobo/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Kindle/ }));

    expect(onChange).toHaveBeenNthCalledWith(1, ['Kindle', 'Kobo']);
    expect(onChange).toHaveBeenNthCalledWith(2, []);
  });

  it("warns about a device Audiobookshelf won't let RMAB send to", async () => {
    const { EreaderDevicesSection } = await import('@/components/admin/users/EreaderDevicesSection');

    render(<EreaderDevicesSection selected={[]} onChange={vi.fn()} />);

    expect(screen.getAllByText(/won.t let RMAB send to this device/)).toHaveLength(1);
  });

  it('keeps a device removed from Audiobookshelf listed so it can be cleared', async () => {
    const onChange = vi.fn();
    const { EreaderDevicesSection } = await import('@/components/admin/users/EreaderDevicesSection');

    render(<EreaderDevicesSection selected={['Old Kindle']} onChange={onChange} />);
    expect(screen.getByText('No longer in Audiobookshelf')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Old Kindle/ }));

    expect(onChange).toHaveBeenCalledWith([]);
  });
});
