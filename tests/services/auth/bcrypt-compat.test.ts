/**
 * Component: bcrypt Compatibility Tests (real native module, not mocked)
 * Documentation: documentation/backend/services/auth.md
 *
 * Password hashes saved before the bcrypt 5 → 6 upgrade must keep verifying. The
 * fixtures below were made with bcrypt 5.1.1 (cost 10) for FIXTURE_PASSWORD.
 */

import { execFileSync } from 'child_process';
import path from 'path';
import bcrypt from 'bcrypt';
import { describe, expect, it } from 'vitest';

const FIXTURE_PASSWORD = 'rmab fixture password: correct horse';
const BCRYPT5_HASH_2B = '$2b$10$BCZK8blZtIYmsophxubCeuHI.JXqtmORQYGOK53Ld/rNsVm3WR/NK';
const BCRYPT5_HASH_2A = '$2a$10$9AWTL2dw.m2jeAVyFdPCN.5IZNINLfMzuNGHAFVP.OqYyLUkR2FOq';

describe('bcrypt compatibility', () => {
  it.each([
    ['$2b$', BCRYPT5_HASH_2B],
    ['$2a$', BCRYPT5_HASH_2A],
  ])('verifies a %s hash made by bcrypt 5', async (_label, hash) => {
    await expect(bcrypt.compare(FIXTURE_PASSWORD, hash)).resolves.toBe(true);
    await expect(bcrypt.compare('wrong password', hash)).resolves.toBe(false);
  });

  it('makes $2b$ cost-10 hashes that verify', async () => {
    const hash = await bcrypt.hash(FIXTURE_PASSWORD, 10);

    expect(hash).toMatch(/^\$2b\$10\$[./A-Za-z0-9]{53}$/);
    await expect(bcrypt.compare(FIXTURE_PASSWORD, hash)).resolves.toBe(true);
  });

  it('loads with plain Node require, as the credential recovery script does', () => {
    const script = [
      "const bcrypt = require('bcrypt');",
      `const ok = bcrypt.compareSync(${JSON.stringify(FIXTURE_PASSWORD)}, ${JSON.stringify(BCRYPT5_HASH_2B)});`,
      "const fresh = bcrypt.hashSync('x', 10);",
      "process.stdout.write(JSON.stringify({ ok, fresh: bcrypt.compareSync('x', fresh) }));",
    ].join('\n');
    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: path.resolve(__dirname, '../../..'),
      encoding: 'utf8',
    });

    expect(JSON.parse(output)).toEqual({ ok: true, fresh: true });
  });
});
