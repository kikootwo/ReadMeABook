/**
 * Component: Discord Request Custom IDs
 * Documentation: documentation/integrations/discord-bot.md
 *
 * Encodes and checks the custom_id on the /request modal, select menu and buttons:
 * `rmab:req:<step>:<a|e>[:<ASIN>]:<nonce>`. It carries only the step, the media type,
 * the ASIN and a random nonce, never who may act: the sender controls a custom_id, so
 * every step resolves the clicking user again. Anything that does not match exactly
 * (unknown step, bad ASIN, extra parts, over Discord's 100 characters) decodes to null.
 */

import { randomBytes } from 'crypto';

export type RequestMediaType = 'audiobook' | 'ebook';
export type RequestStep = 'modal' | 'pick' | 'confirm' | 'cancel';

export interface RequestCustomId {
  step: RequestStep;
  type: RequestMediaType;
  /** Set on `confirm` only. */
  asin?: string;
  nonce: string;
}

export const REQUEST_CUSTOM_ID_PREFIX = 'rmab:req:';
/** Discord's custom_id limit. */
export const CUSTOM_ID_MAX_LENGTH = 100;

const STEP_CODES: Record<RequestStep, string> = { modal: 'modal', pick: 'pick', confirm: 'ok', cancel: 'no' };
const TYPE_CODES: Record<RequestMediaType, string> = { audiobook: 'a', ebook: 'e' };
const NONCE_PATTERN = /^[a-z0-9]{10}$/;
const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** An Audible ASIN: 10 characters, uppercase letters and digits. */
export function isAsin(value: unknown): value is string {
  return typeof value === 'string' && ASIN_PATTERN.test(value);
}

export function isRequestMediaType(value: unknown): value is RequestMediaType {
  return value === 'audiobook' || value === 'ebook';
}

function newNonce(): string {
  // 8 random bytes in base 36 give at least 10 characters
  return BigInt(`0x${randomBytes(8).toString('hex')}`).toString(36).padStart(10, '0').slice(-10);
}

function findKey<T extends string>(codes: Record<T, string>, code: string): T | undefined {
  return (Object.keys(codes) as T[]).find((key) => codes[key] === code);
}

/** Builds a custom_id. `asin` is required for `confirm` and refused for every other step. */
export function encodeRequestCustomId(step: RequestStep, type: RequestMediaType, asin?: string, nonce = newNonce()): string {
  if ((step === 'confirm') !== (asin !== undefined)) throw new Error(`An ASIN belongs on the confirm step only (${step})`);
  if (asin !== undefined && !isAsin(asin)) throw new Error('Invalid ASIN');
  if (!NONCE_PATTERN.test(nonce)) throw new Error('Invalid nonce');
  const parts = [STEP_CODES[step], TYPE_CODES[type], ...(asin ? [asin] : []), nonce];
  return `${REQUEST_CUSTOM_ID_PREFIX}${parts.join(':')}`;
}

/** True when the id belongs to the /request flow (decode it before trusting any part). */
export function isRequestCustomId(id: unknown): id is string {
  return typeof id === 'string' && id.startsWith(REQUEST_CUSTOM_ID_PREFIX);
}

/** Parses a custom_id from Discord; null for anything not built by encodeRequestCustomId. */
export function decodeRequestCustomId(id: unknown): RequestCustomId | null {
  if (!isRequestCustomId(id) || id.length > CUSTOM_ID_MAX_LENGTH) return null;
  const parts = id.slice(REQUEST_CUSTOM_ID_PREFIX.length).split(':');
  const step = findKey(STEP_CODES, parts[0] ?? '');
  const type = findKey(TYPE_CODES, parts[1] ?? '');
  if (!step || !type) return null;

  const expected = step === 'confirm' ? 4 : 3;
  if (parts.length !== expected) return null;
  const nonce = parts[expected - 1];
  if (!NONCE_PATTERN.test(nonce)) return null;
  if (step !== 'confirm') return { step, type, nonce };

  const asin = parts[2];
  return isAsin(asin) ? { step, type, asin, nonce } : null;
}

/*
 * Approve / Deny buttons on an approval message: `rmab:apr:<a|d>:<request id>:<nonce>`. The
 * request ID says which request the button is for, never that the clicker may decide it: the
 * handler resolves the clicking user and requires an RMAB admin on every click.
 */

export type ApprovalAction = 'approve' | 'deny';

export interface ApprovalCustomId {
  action: ApprovalAction;
  requestId: string;
  nonce: string;
}

export const APPROVAL_CUSTOM_ID_PREFIX = 'rmab:apr:';

const ACTION_CODES: Record<ApprovalAction, string> = { approve: 'a', deny: 'd' };
/** Request IDs are UUIDs (Prisma `@default(uuid())`). */
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

export function encodeApprovalCustomId(action: ApprovalAction, requestId: string, nonce = newNonce()): string {
  if (!isRequestId(requestId)) throw new Error('Invalid request ID');
  if (!NONCE_PATTERN.test(nonce)) throw new Error('Invalid nonce');
  return `${APPROVAL_CUSTOM_ID_PREFIX}${ACTION_CODES[action]}:${requestId}:${nonce}`;
}

/** Parses an Approve/Deny custom_id; null for anything not built by encodeApprovalCustomId. */
export function decodeApprovalCustomId(id: unknown): ApprovalCustomId | null {
  if (typeof id !== 'string' || !id.startsWith(APPROVAL_CUSTOM_ID_PREFIX) || id.length > CUSTOM_ID_MAX_LENGTH) return null;
  const parts = id.slice(APPROVAL_CUSTOM_ID_PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  const action = findKey(ACTION_CODES, parts[0]);
  const [, requestId, nonce] = parts;
  if (!action || !isRequestId(requestId) || !NONCE_PATTERN.test(nonce)) return null;
  return { action, requestId, nonce };
}
