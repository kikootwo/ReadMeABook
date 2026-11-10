/**
 * Component: E2E stop flow tests (node:test, host-run): Docker events + FinishedAt + container logs → the
 * container's and the app's own stop times
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStopEvents, parseStopLogs, rfc3339Ns } from '../stop-flow.mjs';

const ID = 'a1b2c3d4e5f6';
const FULL = `${ID}${'0'.repeat(52)}`;
const OTHER = `ffffffffffff${'0'.repeat(52)}`;
// The stream's format ends with the signal attribute: 15 on the stop's kill, empty on a die
const line = (ns, action, actor = FULL, signal = action === 'kill' ? '15' : '') => `${ns} ${actor} ${action} ${signal}`;
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
  assert.deepEqual(r.events, [`${at(627665665)} kill 15`, `${at(12_100_000_000)} die`]);
  assert.equal(r.killNs, BASE + 627665665n);
});

test("SIGTERM then Docker's follow-up SIGKILL: timed from the SIGTERM", () => {
  const r = parseStopEvents([
    line(at(1_000_000_000), 'kill'), line(at(11_000_000_000), 'kill', FULL, '9'), line(at(11_600_000_000), 'die'),
  ].join('\r\n'), ID, finished(11_500_000_000));
  assert.equal(r.seconds, 10.5);
  assert.equal(r.killToDieSeconds, 10.6);
  assert.deepEqual(r.events.slice(0, 2), [`${at(1_000_000_000)} kill 15`, `${at(11_000_000_000)} kill 9`]);
});

test('only the follow-up SIGKILL in the window (SIGTERM unseen): null, never the later kill', () => {
  const r = parseStopEvents([line(at(11_000_000_000), 'kill', FULL, '9'), line(at(11_600_000_000), 'die')].join('\n'), ID, finished(11_500_000_000));
  assert.equal(r.seconds, null);
  assert.equal(r.killToDieSeconds, null);
  assert.equal(r.killNs, null);
  assert.equal(parseStopEvents(`${at(1_000_000_000)} ${FULL} kill`, ID, finished(2_000_000_000)).seconds, null, 'kill without a signal attribute');
});

test('a kill exactly at FinishedAt counts (0 s); one ns after it does not', () => {
  assert.equal(parseStopEvents(line(at(2_000_000_000), 'kill'), ID, finished(2_000_000_000)).seconds, 0);
  assert.equal(parseStopEvents(line(at(2_000_000_001), 'kill'), ID, finished(2_000_000_000)).seconds, null);
});

test('stream lines for other actions (the exec_die that shows the stream is live) are ignored', () => {
  const r = parseStopEvents([line(at(500_000_000), 'exec_die'), line(at(1_000_000_000), 'kill')].join('\n'), ID, finished(1_800_000_000));
  assert.equal(r.seconds, 0.8);
  assert.deepEqual(r.events, [`${at(1_000_000_000)} kill 15`]);
});

test('no events, no kill, or no exit time: null, never a guess', () => {
  assert.deepEqual(parseStopEvents('', ID, finished(1)), { seconds: null, killToDieSeconds: null, killNs: null, events: [] });
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
  assert.deepEqual(r.events, [`${at(2_000_000_000)} kill 15`, `${at(4_600_000_000)} die`]);
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

// `docker logs --timestamps` lines: the daemon's receive time (RFC 3339, trailing zeros trimmed), then the line
const logLine = (offsetNs, text) => `${finished(offsetNs).replace(/\.?0+Z$/, 'Z')} ${text}`;
const KILL = BASE + 1_000_000_000n;
const CKPT = 'LOG:  checkpoint complete: wrote 146 buffers (0.9%); write=0.311 s, sync=3.025 s, total=3.769 s; sync files=53';

test('app part: the stop signal to the first `[App] node exited` after it; PostgreSQL shutdown checkpoint total', () => {
  const stdout = [
    logLine(200_000_000, '[App] node exited (status 137)'), // a crash earlier in this start
    logLine(1_050_000_000, '[INFO] [Shutdown] SIGTERM received'),
    logLine(1_880_000_000, '[App] node exited (status 0)'),
    logLine(1_900_000_000, '2026-11-10 01:18:00,000 INFO stopped: app (exit status 0)'),
  ];
  const stderr = [
    logLine(100_000_000, `2026-11-10 01:17:58.100 UTC [420] ${CKPT.replace('3.769', '0.050')}`), // periodic, before the stop
    logLine(2_000_000_000, '2026-11-10 01:18:00.000 UTC [420] LOG:  checkpoint starting: shutdown immediate'),
    logLine(5_770_000_000, `..2026-11-10 01:18:03.770 UTC [420] ${CKPT}`),
  ];
  const r = parseStopLogs(`${stdout.join('\n')}\n${stderr.join('\r\n')}`, KILL);
  assert.equal(r.appSeconds, 0.88);
  assert.match(r.appLine, /node exited \(status 0\)$/);
  assert.equal(r.pgCheckpointSeconds, 3.769);
});

test('app part missing: no line after the kill (only one from an earlier start), no kill, or no logs → null', () => {
  const earlier = [logLine(200_000_000, '[App] node exited (status 0)'), logLine(900_000_000, '[INFO] Server ready')].join('\n');
  assert.deepEqual(parseStopLogs(earlier, KILL), { appSeconds: null, appLine: null, pgCheckpointSeconds: null });
  assert.equal(parseStopLogs(logLine(3_000_000_000, '[App] node exited (status 0)'), null).appSeconds, null, 'kill unseen');
  assert.equal(parseStopLogs('', KILL).appSeconds, null);
  assert.equal(parseStopLogs('[App] node exited (status 0)', KILL).appSeconds, null, 'line without a timestamp');
  const noCkptEnd = [logLine(1_500_000_000, '[App] node exited (status 0)'), logLine(2_000_000_000, 'LOG:  checkpoint starting: shutdown immediate')];
  const r = parseStopLogs(noCkptEnd.join('\n'), KILL);
  assert.equal(r.appSeconds, 0.5);
  assert.equal(r.pgCheckpointSeconds, null, 'checkpoint never completed');
});

test('app part: a line received exactly at the kill counts; the frozen-node watchdog stop reads its 6 s', () => {
  assert.equal(parseStopLogs(logLine(1_000_000_000, '[App] node exited (status 0)'), KILL).appSeconds, 0);
  const frozen = [
    logLine(7_180_000_000, '[App] node did not stop within 6s, sending SIGKILL'),
    logLine(7_190_000_000, '[App] node exited (status 137)'),
  ].join('\n');
  assert.equal(parseStopLogs(frozen, KILL).appSeconds, 6.19);
});
