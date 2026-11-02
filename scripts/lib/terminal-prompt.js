/**
 * Component: Terminal Prompts for the Credential Recovery Script
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * ask(): one short-lived readline interface per question, closed before returning, so
 * nothing is left listening on stdin. askHidden(): raw-mode read with no readline
 * attached, so typed characters are never echoed (a '*' is shown per character).
 * The TTY's raw mode is always restored: on Enter, Ctrl+C, Ctrl+D, close() and exit.
 */

'use strict';

const readline = require('readline');

const CANCELLED = 'CANCELLED';

function cancelledError() {
  const error = new Error('Cancelled by user');
  error.code = CANCELLED;
  return error;
}

/**
 * @param {{ input?: NodeJS.ReadStream, output?: NodeJS.WriteStream }} [streams]
 */
function createPrompter({ input = process.stdin, output = process.stdout } = {}) {
  let restoreRawMode = null;
  let active = null; // the pending prompt's cleanup, if any

  function restoreTerminal() {
    if (restoreRawMode) {
      const restore = restoreRawMode;
      restoreRawMode = null;
      try {
        restore();
      } catch {
        // stream already gone
      }
    }
  }

  /** Ask a question and return the typed line (echoed normally). */
  function ask(question) {
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input, output, terminal: Boolean(input.isTTY && output.isTTY) });
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        active = null;
        rl.close();
        input.pause();
        fn(value);
      };
      active = () => finish(reject, cancelledError());
      rl.on('SIGINT', () => {
        output.write('\n');
        finish(reject, cancelledError());
      });
      rl.on('close', () => finish(reject, cancelledError())); // Ctrl+D / end of input
      rl.question(question, (answer) => finish(resolve, answer));
    });
  }

  /** Ask for a secret: raw mode, never echoed. Requires a TTY. */
  function askHidden(question) {
    return new Promise((resolve, reject) => {
      if (!input.isTTY || typeof input.setRawMode !== 'function') {
        reject(new Error('Password input needs a terminal. Run with: docker exec -it <container> npm run rmab:recover'));
        return;
      }

      const wasRaw = Boolean(input.isRaw);
      input.setRawMode(true);
      restoreRawMode = () => input.setRawMode(wasRaw);
      input.setEncoding('utf8');
      output.write(question);

      let buffer = '';
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        active = null;
        input.removeListener('data', onData);
        input.removeListener('end', onEnd);
        restoreTerminal();
        input.pause();
        output.write('\n');
        fn(value);
      };
      const onEnd = () => finish(reject, cancelledError());
      const onData = (chunk) => {
        for (const ch of String(chunk)) {
          if (ch === '\u0003' || (ch === '\u0004' && buffer === '')) return finish(reject, cancelledError()); // Ctrl+C / Ctrl+D
          if (ch === '\r' || ch === '\n') return finish(resolve, buffer);
          if (ch === '\u007f' || ch === '\b') {
            if (buffer.length > 0) {
              buffer = buffer.slice(0, -1);
              output.write('\b \b');
            }
            continue;
          }
          if (ch === '\u001b') break; // escape sequence (arrow keys etc.): ignore the rest of this chunk
          if (ch < ' ') continue; // other control characters
          buffer += ch;
          output.write('*');
        }
      };

      active = () => finish(reject, cancelledError());
      input.on('data', onData);
      input.once('end', onEnd);
      input.resume();
    });
  }

  /** Cancel any pending prompt and restore the terminal. Safe to call more than once. */
  function close() {
    if (active) active();
    restoreTerminal();
  }

  return { ask, askHidden, close };
}

module.exports = { createPrompter, CANCELLED };
