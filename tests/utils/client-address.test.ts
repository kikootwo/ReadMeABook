/**
 * Component: Client Address Key Tests
 * Documentation: documentation/backend/services/auth.md
 */

import net from 'net';
import { describe, expect, it, vi } from 'vitest';
import { clientAddressKey } from '@/lib/utils/client-address';

const keyFor = (xff?: string) => clientAddressKey(new Headers(xff === undefined ? {} : { 'x-forwarded-for': xff }));

describe('clientAddressKey', () => {
  it.each([
    ['192.168.1.50', '4:192.168.1.50', 'a lone private address is the fallback'],
    ['::ffff:192.168.1.50', '4:192.168.1.50', 'an IPv4-mapped socket address becomes IPv4'],
    ['203.0.113.7', '4:203.0.113.7', 'a public address'],
    ['198.51.100.4, 10.0.0.2', '4:198.51.100.4', 'a private proxy hop is skipped'],
    ['1.2.3.4, 203.0.113.7', '4:203.0.113.7', 'entries left of the appended address are ignored'],
    ['made-up, 203.0.113.7', '4:203.0.113.7', 'an invalid prefix is ignored'],
    ['203.0.113.9, 172.18.0.5', '4:203.0.113.9', 'tunnel then a proxy on a Docker network'],
    ['172.18.0.5', '4:172.18.0.5', 'only a proxy address: the fallback'],
    ['100.101.102.103', '4:100.101.102.103', 'CGNAT counts as a client address'],
    ['203.0.113.7:51234', '4:203.0.113.7', 'an IPv4 port is stripped'],
    ['[2001:db8:a:b::1]:443', '6:2001:db8:a:b::/64', 'a bracketed IPv6 port is stripped'],
    ['[2001:db8:a:b::1]', '6:2001:db8:a:b::/64', 'brackets without a port'],
    ['2001:db8:a:b:1:2:3:4', '6:2001:db8:a:b::/64', 'IPv6 keyed by /64'],
    ['2001:db8:a:b::9', '6:2001:db8:a:b::/64', 'same /64, same key'],
    ['2001:db8::1:443', '6:2001:db8:0:0::/64', 'a bare IPv6 address keeps its last hextet'],
    ['::ffff:203.0.113.7', '4:203.0.113.7', 'IPv4-mapped, dotted'],
    ['::ffff:cb00:7107', '4:203.0.113.7', 'IPv4-mapped, hex'],
    ['::1', '6:0:0:0:0::/64', 'loopback only: the fallback'],
    ['fe80::1, 203.0.113.7', '4:203.0.113.7', 'public wins over link-local'],
    ['203.0.113.7, fd00::5', '4:203.0.113.7', 'unique-local is not public'],
    ['2001:DB8:A:B::1', '6:2001:db8:a:b::/64', 'IPv6 case is normalised'],
    ['  203.0.113.7  ', '4:203.0.113.7', 'whitespace is trimmed'],
  ])('%s → %s (%s)', (xff, expected) => {
    expect(keyFor(xff)).toBe(expected);
  });

  it('returns none without the header', () => {
    expect(keyFor()).toBe('none');
  });

  it.each([['unknown'], ['garbage'], ['01.2.3.4'], [''], [' , ,'], ['1.2.3.4.5'], ['[203.0.113.7]:80']])(
    'skips the invalid entry %j',
    (xff) => {
      expect(keyFor(xff)).toBe('none');
      expect(keyFor(`${xff}, 198.51.100.4`)).toBe('4:198.51.100.4');
    }
  );

  it('rejects zone IDs, including one long enough to pass net.isIP', () => {
    const longZone = `fe80::1%${'x'.repeat(5000)}`;
    expect(net.isIP(longZone)).toBe(6);
    expect(keyFor(longZone)).toBe('none');
    expect(keyFor('fe80::1%eth0')).toBe('none');
    expect(keyFor(`198.51.100.4, fe80::1%${'x'.repeat(40)}`)).toBe('4:198.51.100.4');
  });

  it('rejects any entry over 64 characters before parsing it', () => {
    const isIP = vi.spyOn(net, 'isIP');
    try {
      expect(keyFor(`2001:db8::${'a'.repeat(60)}`)).toBe('none');
      expect(isIP).not.toHaveBeenCalled();
      expect(keyFor('203.0.113.7')).toBe('4:203.0.113.7');
      expect(isIP).toHaveBeenCalled();
    } finally {
      isIP.mockRestore();
    }
  });

  it('keeps the trailing 1 KiB of a long header', () => {
    const prefix = Array.from({ length: 500 }, (_, i) => `10.0.${i % 250}.1`).join(', ');
    expect(prefix.length).toBeGreaterThan(5000);
    expect(keyFor(`${prefix}, 203.0.113.7`)).toBe('4:203.0.113.7');
  });

  it('walks at most 16 entries from the right', () => {
    const privates = Array.from({ length: 16 }, (_, i) => `10.0.0.${i + 1}`).join(', ');
    expect(keyFor(`203.0.113.7, ${privates}`)).toBe('4:10.0.0.16');
  });
});
