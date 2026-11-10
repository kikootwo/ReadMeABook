/**
 * Component: E2E stop flow tests (node:test, host-run): Docker events + FinishedAt → the container's own stop time
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStopEvents, rfc3339Ns } from '../stop-flow.mjs';

const ID = 'a1b2c3d4e5f6';
const FULL = `${ID}${'0'.repeat(52)}`;
const OTHER = `ffffffffffff${'0'.repeat(52)}`;
const line = (ns, action, actor = FULL) => `${ns} ${actor} ${action}`;
// 2026-11-10T01:17:58Z in Unix nanoseconds, and an inspect-style time n ns after it
const BASE = 1794273478000000000n;
const at = (offsetNs) => `${BASE + BigInt(offsetNs)}`;
const finished = (offsetNs) => {
  const ns = BASE + BigInt(offsetNs);
  return `${new Date(Number(ns / 1_000_000n)).toISOString().slice(0, 19)}.${String(ns % 1_000_000_000n).padStart(9, '0')}Z`;
};

test('rfc3339Ns: nanosecond precision, offsets, zero time and junk', () => {
  assert.equal(rfc3339Ns('2026-11-10T01:17:58.627665665Z'), BASE + 627665665n);
  assert.equal(rfc3339Ns('2026-11-10T01:17:58.5Z'), BASE + 500000000n);
  assert.equal(rfc3339Ns('2026-11-10T01:17:58Z'), BASE);
  assert.equal(rfc3339Ns('2026-11-10T02:17:58.1+01:00'), BASE + 100000000n);
  assert.equal(rfc3339Ns('0001-01-01T00:00:00Z'), null, "Docker's zero time");
  assert.equal(rfc3339Ns(''), null);
  assert.equal(rfc3339Ns('Error: no such object'), null);
});

test('kill then exit: signal to exit from daemon times; the die (logged after) is recorded apart', () => {
  // The die can trail the exit by seconds on a busy host (seen: about 4.7 s); only the exit counts
  const r = parseStopEvents([line(at(627665665), 'kill'), line(at(12_100_000_000), 'die')].join('\n'), ID, finished(7_000_000_000));
  assert.equal(r.seconds, 6.372);
  assert.equal(r.killToDieSeconds, 11.472);
  assert.deepEqual(r.events, [`${at(627665665)} kill`, `${at(12_100_000_000)} die`]);
});

test("several kills (Docker's follow-up SIGKILL): timed from the first", () => {
  const r = parseStopEvents([
    line(at(1_000_000_000), 'kill'), line(at(11_000_000_000), 'kill'), line(at(11_600_000_000), 'die'),
  ].join('\r\n'), ID, finished(11_500_000_000));
  assert.equal(r.seconds, 10.5);
  assert.equal(r.killToDieSeconds, 10.6);
});

test('no events, no kill, or no exit time: null, never a guess', () => {
  assert.deepEqual(parseStopEvents('', ID, finished(1)), { seconds: null, killToDieSeconds: null, events: [] });
  assert.equal(parseStopEvents(undefined, ID, finished(1)).seconds, null);
  assert.equal(parseStopEvents('Error response from daemon: no such container', ID, finished(1)).seconds, null);
  assert.equal(parseStopEvents(line(at(5), 'die'), ID, finished(1)).seconds, null, 'die without kill');
  const noExit = [line(at(1), 'kill'), line(at(2_000_000_000), 'die')].join('\n');
  assert.equal(parseStopEvents(noExit, ID, '').seconds, null, 'FinishedAt unread');
  assert.equal(parseStopEvents(noExit, ID, '0001-01-01T00:00:00Z').seconds, null, 'never exited');
  const r = parseStopEvents(line(at(1_000_000_000), 'kill'), ID, finished(2_500_000_000));
  assert.equal(r.seconds, 1.5, 'kill + exit time is enough');
  assert.equal(r.killToDieSeconds, null, 'die not read');
  assert.equal(parseStopEvents(line(at(3_000_000_000), 'kill'), ID, finished(2_000_000_000)).seconds, null, 'kill after the exit');
});

test('events for another container are ignored', () => {
  const r = parseStopEvents([
    line(at(1_000_000_000), 'kill', OTHER), line(at(2_000_000_000), 'kill'), line(at(3_000_000_000), 'die', OTHER),
    line(at(4_600_000_000), 'die'),
  ].join('\n'), ID, finished(4_500_000_000));
  assert.equal(r.seconds, 2.5);
  assert.equal(r.killToDieSeconds, 2.6);
  assert.deepEqual(r.events, [`${at(2_000_000_000)} kill`, `${at(4_600_000_000)} die`]);
  const others = [line(at(1), 'kill', OTHER), line(at(2), 'die', OTHER)].join('\n');
  assert.equal(parseStopEvents(others, ID, finished(2)).seconds, null);
  assert.equal(parseStopEvents([line(at(1), 'kill'), line(at(2), 'die')].join('\n'), '', finished(2)).seconds, null, 'empty id matches nothing');
});

test('an earlier stop in the window: only the kill after its die counts; out-of-order lines sorted', () => {
  const r = parseStopEvents([
    line(at(9_100_000_000), 'die'), line(at(1_000_000_000), 'kill'), line(at(2_000_000_000), 'die'), line(at(7_000_000_000), 'kill'),
  ].join('\n'), ID, finished(9_000_000_000));
  assert.equal(r.seconds, 2);
  assert.equal(r.killToDieSeconds, 2.1);
});
