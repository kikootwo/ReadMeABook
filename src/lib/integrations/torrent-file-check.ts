/**
 * Component: Downloaded .torrent File Structure Check
 * Documentation: documentation/phase3/download-clients.md
 *
 * One iterative pass over the bytes (no recursion, linear time, never throws) that a
 * downloaded .torrent file must pass before it is handed to parse-torrent.
 */

const DICT = 0x64; // 'd'
const LIST = 0x6c; // 'l'
const INT = 0x69; // 'i'
const END = 0x65; // 'e'
const COLON = 0x3a; // ':'
const MINUS = 0x2d; // '-'

/** Error message when a downloaded file fails the check (same path as a parse failure) */
export const INVALID_TORRENT_FILE = 'Invalid .torrent file - the downloaded file is not a well-formed .torrent file';

/** Deepest list/dict nesting accepted */
export const MAX_TORRENT_DEPTH = 100;
/** Most digits in a string length prefix (allows up to 9,999,999,999 bytes) */
const MAX_LENGTH_DIGITS = 10;
/** Most digits in an integer value */
const MAX_INT_DIGITS = 32;

// Open container states on the stack
const IN_LIST = 0;
const DICT_KEY = 1; // a dict waiting for a key (or its end)
const DICT_VALUE = 2; // a dict waiting for the value of the key just read

const isDigit = (b: number) => b >= 0x30 && b <= 0x39;

/** Position after `<digits>:<bytes>` starting at `pos`, or -1 when malformed or past the end */
function skipString(buf: Uint8Array, pos: number): number {
  let length = 0;
  let i = pos;
  while (i < buf.length && isDigit(buf[i])) {
    if (i - pos >= MAX_LENGTH_DIGITS) return -1;
    length = length * 10 + (buf[i] - 0x30);
    i++;
  }
  if (i === pos || i >= buf.length || buf[i] !== COLON) return -1;
  const end = i + 1 + length;
  return end <= buf.length ? end : -1;
}

/** Position after `i-?<digits>e` whose `i` is at `pos`, or -1 when malformed */
function skipInteger(buf: Uint8Array, pos: number): number {
  let i = pos + 1;
  if (buf[i] === MINUS) i++;
  const digitsStart = i;
  while (i < buf.length && isDigit(buf[i])) {
    if (i - digitsStart >= MAX_INT_DIGITS) return -1;
    i++;
  }
  if (i === digitsStart || i >= buf.length || buf[i] !== END) return -1;
  return i + 1;
}

/**
 * True when `bytes` starts with one well-formed bencoded dict: strings are `<digits>:` with a
 * length that ends inside the buffer, integers are `i-?<digits>e`, dict keys are strings,
 * every list/dict is closed, and nesting is at most MAX_TORRENT_DEPTH. The walk stops where the
 * top-level dict closes; any bytes after it are ignored, as the parser ignores them.
 */
export function isWellFormedTorrentFile(bytes: Buffer): boolean {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes[0] !== DICT) return false;
  const stack: number[] = [];
  // A value finished: the dict holding it now waits for its next key (or for its value)
  const valueDone = () => {
    const top = stack.length - 1;
    if (top >= 0 && stack[top] !== IN_LIST) stack[top] = stack[top] === DICT_KEY ? DICT_VALUE : DICT_KEY;
  };
  let pos = 0;
  while (pos < bytes.length) {
    const b = bytes[pos];
    const state = stack.length > 0 ? stack[stack.length - 1] : -1;
    if (b === END) {
      if (state === -1 || state === DICT_VALUE) return false;
      stack.pop();
      pos++;
      valueDone();
    } else if (state === DICT_KEY && !isDigit(b)) {
      return false;
    } else if (b === DICT || b === LIST) {
      if (stack.length >= MAX_TORRENT_DEPTH) return false;
      stack.push(b === DICT ? DICT_KEY : IN_LIST);
      pos++;
    } else if (b === INT || isDigit(b)) {
      pos = b === INT ? skipInteger(bytes, pos) : skipString(bytes, pos);
      if (pos < 0) return false;
      valueDone();
    } else {
      return false;
    }
    if (stack.length === 0) return true;
  }
  return false;
}
