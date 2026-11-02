/**
 * Component: Process Guards for the Credential Recovery Script
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * terminalProblem(): the script refuses CLI arguments and needs a terminal on stdin AND
 * stdout (the hidden password prompt needs raw mode; output must not go to a file).
 * installExitHandlers(): restores the terminal on exit, SIGTERM (143) and SIGHUP (129).
 * hold() defers those signals and Ctrl+C (130) until release(), so a full recovery is not
 * cut off between the DB commit and writing the new key to disk.
 * passwordResetData(): the user row update for a reset; it ends existing sessions.
 */

'use strict';

const RUN_HINT = 'Run: docker exec -it <container> npm run rmab:recover';

/** Lines to print (to stderr) and exit code 2, or null when the script may run. */
function terminalProblem({ argv, stdin, stdout }) {
  if (argv.length > 2) {
    return ['This script does not accept CLI arguments. All input is via interactive prompts.', RUN_HINT];
  }
  if (!stdin || !stdin.isTTY || !stdout || !stdout.isTTY) {
    return ['This script is interactive and needs a terminal (stdin and stdout).', RUN_HINT];
  }
  return null;
}

const EXIT_SIGNALS = [
  ['SIGTERM', 143],
  ['SIGHUP', 129],
];

function installExitHandlers({ proc = process, prompter, log = (line) => console.error(line) }) {
  let holding = false;
  let pending = null;

  const exitNow = (code) => {
    prompter.close();
    proc.exit(code);
  };
  const defer = (code) => {
    if (pending === null) {
      pending = code;
      log('  Finishing the recovery before exiting (the new key must reach disk)...');
    }
  };
  const onInterrupt = () => defer(130);

  proc.on('exit', () => prompter.close());
  for (const [signal, code] of EXIT_SIGNALS) {
    proc.on(signal, () => (holding ? defer(code) : exitNow(code)));
  }

  return {
    /** Defer SIGTERM/SIGHUP/SIGINT until the returned release() is called. */
    hold() {
      if (holding) return () => {};
      holding = true;
      proc.on('SIGINT', onInterrupt);
      let released = false;
      return function release() {
        if (released) return;
        released = true;
        holding = false;
        proc.removeListener('SIGINT', onInterrupt);
        if (pending !== null) exitNow(pending);
      };
    },
  };
}

/** Update for the reset user: new password hash, and every existing session ended. */
function passwordResetData(encryptedHash, now = new Date()) {
  return { authToken: encryptedHash, lastLoginAt: null, sessionsInvalidatedAt: now };
}

module.exports = { terminalProblem, installExitHandlers, passwordResetData, EXIT_SIGNALS };
