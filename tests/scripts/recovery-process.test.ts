/**
 * Component: Credential Recovery Process Guard Tests
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * The terminal check (stdin AND stdout must be TTYs, no CLI args) and the exit wiring:
 * the terminal is restored on exit/SIGTERM/SIGHUP, and while held (full recovery, DB
 * commit to key on disk) SIGTERM/SIGHUP/Ctrl+C wait until release.
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const { terminalProblem, installExitHandlers, passwordResetData } = require('../../scripts/lib/recovery-process.js');

const tty = { isTTY: true };
const pipe = { isTTY: false };
const argv = ['node', 'recover-credentials.js'];

describe('terminalProblem', () => {
  it('allows a run with a terminal on stdin and stdout and no arguments', () => {
    expect(terminalProblem({ argv, stdin: tty, stdout: tty })).toBeNull();
  });

  it.each([
    ['stdout is not a terminal (output redirected)', tty, pipe],
    ['stdin is not a terminal (input piped)', pipe, tty],
    ['neither is a terminal', pipe, pipe],
    ['stdout is missing', tty, undefined],
  ])('refuses when %s', (_label, stdin, stdout) => {
    expect(terminalProblem({ argv, stdin, stdout })).toEqual([
      'This script is interactive and needs a terminal (stdin and stdout).',
      'Run: docker exec -it <container> npm run rmab:recover',
    ]);
  });

  it('refuses CLI arguments before looking at the terminal', () => {
    expect(terminalProblem({ argv: [...argv, '--user', 'admin'], stdin: tty, stdout: tty })?.[0]).toMatch(/does not accept CLI arguments/);
  });
});

function fakeProcess() {
  const proc = new EventEmitter() as EventEmitter & { exit: ReturnType<typeof vi.fn> };
  proc.exit = vi.fn();
  return proc;
}

function setup() {
  const proc = fakeProcess();
  const prompter = { close: vi.fn() };
  const log = vi.fn();
  const control = installExitHandlers({ proc, prompter, log });
  return { proc, prompter, log, control };
}

describe('installExitHandlers', () => {
  it('restores the terminal on exit', () => {
    const { proc, prompter } = setup();
    proc.emit('exit', 0);
    expect(prompter.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGHUP', 129],
  ])('%s restores the terminal and exits with %i', (signal, code) => {
    const { proc, prompter } = setup();
    proc.emit(signal);
    expect(prompter.close).toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(code);
  });

  it('leaves Ctrl+C to the prompts outside a held section (no SIGINT listener)', () => {
    const { proc } = setup();
    expect(proc.listenerCount('SIGINT')).toBe(0);
  });

  it.each([
    ['SIGTERM', 143],
    ['SIGHUP', 129],
    ['SIGINT', 130],
  ])('while held, %s waits until release, then exits with %i', (signal, code) => {
    const { proc, prompter, log, control } = setup();
    const release = control.hold();

    proc.emit(signal);
    expect(proc.exit).not.toHaveBeenCalled();
    expect(prompter.close).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Finishing the recovery/));

    release();
    expect(prompter.close).toHaveBeenCalled();
    expect(proc.exit).toHaveBeenCalledWith(code);
  });

  it('keeps the first deferred signal, and release without a signal does not exit', () => {
    const first = setup();
    const release = first.control.hold();
    first.proc.emit('SIGHUP');
    first.proc.emit('SIGTERM');
    release();
    expect(first.proc.exit).toHaveBeenCalledTimes(1);
    expect(first.proc.exit).toHaveBeenCalledWith(129);

    const quiet = setup();
    const releaseQuiet = quiet.control.hold();
    releaseQuiet();
    releaseQuiet();
    expect(quiet.proc.exit).not.toHaveBeenCalled();
    expect(quiet.proc.listenerCount('SIGINT')).toBe(0);
  });

  it('after release, signals exit immediately again', () => {
    const { proc, control } = setup();
    control.hold()();
    proc.emit('SIGTERM');
    expect(proc.exit).toHaveBeenCalledWith(143);
  });
});

describe('passwordResetData', () => {
  it('sets the new hash, clears the last login and ends existing sessions', () => {
    const now = new Date('2026-10-19T12:00:00Z');
    expect(passwordResetData('enc-hash', now)).toEqual({ authToken: 'enc-hash', lastLoginAt: null, sessionsInvalidatedAt: now });
  });
});
