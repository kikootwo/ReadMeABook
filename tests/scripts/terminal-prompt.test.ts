/**
 * Component: Credential Recovery Prompt Tests
 * Documentation: documentation/admin-features/credential-recovery.md
 *
 * Drives the prompts with a fake TTY (stdin/stdout) and checks that a typed password
 * never reaches the output, that the terminal leaves raw mode on every exit path, and
 * that the script refuses to run without a terminal.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import readline from 'readline';
import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createPrompter, CANCELLED } = require('../../scripts/lib/terminal-prompt.js');

const PASSWORD = 'Sup3r-secret-pa55';

/** A PassThrough that looks like a TTY stdin, recording raw-mode changes. */
function fakeStdin() {
  const stream = new PassThrough() as PassThrough & { isTTY: boolean; isRaw: boolean; setRawMode: (raw: boolean) => void; rawCalls: boolean[] };
  stream.isTTY = true;
  stream.isRaw = false;
  stream.rawCalls = [];
  stream.setRawMode = (raw: boolean) => {
    stream.isRaw = raw;
    stream.rawCalls.push(raw);
  };
  return stream;
}

/** A TTY-looking stdout that records everything written to it. */
function fakeStdout() {
  const stream = new PassThrough() as PassThrough & { isTTY: boolean; columns: number; text: () => string };
  stream.isTTY = true;
  stream.columns = 120;
  let written = '';
  stream.on('data', (chunk) => {
    written += chunk.toString();
  });
  stream.text = () => written;
  return stream;
}

/** Type characters one at a time, as a terminal in raw mode delivers them. */
async function type(input: PassThrough, text: string) {
  for (const ch of text) {
    input.write(ch);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('terminal prompts', () => {
  it('never echoes the password, after a normal question was asked on the same terminal', async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const prompter = createPrompter({ input, output });

    const username = prompter.ask('Username to reset: ');
    await type(input, 'admin\r');
    await expect(username).resolves.toBe('admin');

    const first = prompter.askHidden('New password: ');
    await type(input, `${PASSWORD}\r`);
    await expect(first).resolves.toBe(PASSWORD);

    const second = prompter.askHidden('Confirm new password: ');
    await type(input, `${PASSWORD}\r`);
    await expect(second).resolves.toBe(PASSWORD);

    const text = output.text();
    expect(text).toContain('Username to reset: ');
    expect(text).toContain('admin'); // normal questions still echo
    expect(text).not.toContain(PASSWORD);
    for (const fragment of ['Sup3r', 'secret', 'pa55']) expect(text).not.toContain(fragment);
    expect(text).toContain('*'.repeat(PASSWORD.length));
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0); // no readline left listening
  });

  it('shows that the earlier pattern (a paused readline left open) did echo, so this harness would catch it', async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const rl = readline.createInterface({ input, output, terminal: true });
    rl.pause();

    // The old askHidden: raw mode plus its own data listener, with the readline still attached
    input.setRawMode(true);
    input.resume();
    const read = new Promise<void>((resolve) => {
      input.on('data', (chunk) => {
        if (String(chunk).includes('\r')) resolve();
      });
    });
    await type(input, `${PASSWORD}\r`);
    await read;
    rl.close();

    expect(output.text()).toContain(PASSWORD);
  });

  it('handles backspace and ignores escape sequences such as arrow keys', async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const prompter = createPrompter({ input, output });

    const answer = prompter.askHidden('Password: ');
    await type(input, 'abcd\u007f');
    input.write('\u001b[A'); // up arrow arrives as one chunk
    await new Promise((resolve) => setImmediate(resolve));
    await type(input, 'e\r');

    await expect(answer).resolves.toBe('abce');
    expect(output.text()).not.toContain('[A');
  });

  it('cancels on Ctrl+C in a hidden prompt and restores the terminal', async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const prompter = createPrompter({ input, output });

    const answer = prompter.askHidden('Password: ').catch((error) => error);
    await type(input, 'abc\u0003');

    expect(await answer).toMatchObject({ code: CANCELLED });
    expect(input.rawCalls).toEqual([true, false]);
    expect(input.listenerCount('data')).toBe(0);
    expect(output.text()).not.toContain('abc');
  });

  it('cancels on Ctrl+D on an empty hidden prompt and on end of input', async () => {
    const input = fakeStdin();
    const prompter = createPrompter({ input, output: fakeStdout() });

    const ctrlD = prompter.askHidden('Password: ').catch((error) => error);
    await type(input, '\u0004');
    expect(await ctrlD).toMatchObject({ code: CANCELLED });

    const ended = prompter.askHidden('Password: ');
    input.end();
    await expect(ended).rejects.toMatchObject({ code: CANCELLED });
    expect(input.isRaw).toBe(false);
  });

  it('cancels a normal question on Ctrl+C', async () => {
    const input = fakeStdin();
    const output = fakeStdout();
    const prompter = createPrompter({ input, output });

    const answer = prompter.ask('Username to reset: ').catch((error) => error);
    await type(input, 'adm\u0003');

    expect(await answer).toMatchObject({ code: CANCELLED });
    expect(input.isRaw).toBe(false);
  });

  it('close() cancels a pending hidden prompt and leaves raw mode', async () => {
    const input = fakeStdin();
    const prompter = createPrompter({ input, output: fakeStdout() });

    const answer = prompter.askHidden('Password: ').catch((error) => error);
    await type(input, 'abc');
    prompter.close();

    expect(await answer).toMatchObject({ code: CANCELLED });
    expect(input.isRaw).toBe(false);
    prompter.close(); // safe to repeat
  });

  it('keeps raw mode as it was if the terminal was already raw', async () => {
    const input = fakeStdin();
    input.isRaw = true;
    const prompter = createPrompter({ input, output: fakeStdout() });

    const answer = prompter.askHidden('Password: ');
    await type(input, 'x\r');

    await expect(answer).resolves.toBe('x');
    expect(input.isRaw).toBe(true);
  });

  it('refuses a hidden prompt without a terminal, reading nothing', async () => {
    const input = new PassThrough();
    const output = fakeStdout();
    const prompter = createPrompter({ input, output });

    await expect(prompter.askHidden('Password: ')).rejects.toThrow(/needs a terminal/);
    expect(input.listenerCount('data')).toBe(0);
    expect(output.text()).toBe('');
  });
});

describe('recover-credentials.js', () => {
  it('exits with a clear message when stdin is not a terminal, before doing anything else', () => {
    const script = path.resolve(__dirname, '../../scripts/recover-credentials.js');
    const result = spawnSync(process.execPath, [script], {
      input: `admin\n${PASSWORD}\n${PASSWORD}\nconfirm\n`,
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: '', CONFIG_ENCRYPTION_KEY: '' },
      timeout: 20_000,
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('needs a terminal');
    expect(result.stdout).not.toContain('Credential Recovery'); // stopped before the banner
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
  });
});
