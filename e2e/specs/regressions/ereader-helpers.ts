/**
 * Component: E2E e-reader delivery helpers (Mailpit inbox, Audiobookshelf email + devices, evidence)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Needs `--overrides mail-catcher` (a Mailpit service on the stack network): Audiobookshelf sends
 * through it as its SMTP server, and specs read what arrived over Mailpit's API. Nothing leaves
 * the stack. Devices are written through Audiobookshelf's own email API as the root user.
 */

import fs from 'node:fs';
import { evidencePath, waitFor, type Abs } from '../../lib/harness';

/** Mailpit inside the stack (runner and ABS both reach it by service name). */
export const MAILPIT = process.env.E2E_MAILPIT_URL || 'http://mailpit:8025';
export const MAIL_FROM = 'rmab-e2e@e2e.test';

/** Devices as an admin sets them up in Audiobookshelf (Settings → Email). */
export const DEVICES = {
  kindle: { name: 'E2E Kindle', email: 'admin-kindle@e2e.test', availabilityOption: 'adminOrUp', users: [] as string[] },
  kobo: { name: 'E2E Kobo', email: 'reader-kobo@e2e.test', availabilityOption: 'adminOrUp', users: [] as string[] },
  // Only listed users may use it, and RMAB's token user (ABS root) isn't listed: RMAB can't send to it.
  // ABS turns "specificUsers" with nobody listed into "adminOrUp", so setUpAbsEmail lists one ABS user.
  locked: { name: 'E2E Locked Reader', email: 'locked@e2e.test', availabilityOption: 'specificUsers', users: [] as string[] },
};

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
  Attachments: number;
  Created: string;
}

export interface MailAttachment {
  FileName: string;
  ContentType: string;
  Size: number;
}

/** Mailpit is up (the override is in use). */
export async function mailpitReady(): Promise<boolean> {
  try {
    return (await fetch(`${MAILPIT}/api/v1/info`)).ok;
  } catch {
    return false;
  }
}

export async function inbox(): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
  if (!res.ok) throw new Error(`Mailpit list: HTTP ${res.status}`);
  return ((await res.json()) as { messages: MailSummary[] }).messages ?? [];
}

export async function attachments(id: string): Promise<MailAttachment[]> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  if (!res.ok) throw new Error(`Mailpit message ${id}: HTTP ${res.status}`);
  return ((await res.json()) as { Attachments?: MailAttachment[] }).Attachments ?? [];
}

export const sentTo = (mail: MailSummary[], address: string) => mail.filter((m) => m.To.some((t) => t.Address === address));

/** Wait until `address` has received more than `already` emails; the new ones, oldest first. */
export async function waitForMail(address: string, already: number, timeoutMs = 300_000): Promise<MailSummary[]> {
  return waitFor(`an email to ${address}`, async () => {
    const got = sentTo(await inbox(), address);
    return got.length > already ? got.slice(0, got.length - already).reverse() : null;
  }, { timeoutMs, intervalMs: 5_000 });
}

/** Audiobookshelf sends through Mailpit, with the three e2e devices (the locked one for an ABS user only). */
export async function setUpAbsEmail(abs: Abs) {
  const settings = await abs.req('PATCH', '/api/emails/settings', {
    host: 'mailpit', port: 1025, secure: false, rejectUnauthorized: false, user: '', pass: '', fromAddress: MAIL_FROM, testAddress: '',
  });
  const users = await abs.req<{ users: { id: string; username: string }[] }>('GET', '/api/users');
  const absReader = users.users.find((u) => u.username === 'e2e-abs-reader')
    ?? (await abs.req<{ user: { id: string } }>('POST', '/api/users', { username: 'e2e-abs-reader', password: 'e2e-abs-reader-pass', type: 'user', isActive: true })).user;
  const ereaderDevices = Object.values(DEVICES).map((d) => (d.availabilityOption === 'specificUsers' ? { ...d, users: [absReader.id] } : d));
  const devices = await abs.req('POST', '/api/emails/ereader-devices', { ereaderDevices });
  return { settings, devices };
}

/** Per-case check recorder; evidence under <evidence>/ereader/<case>/. Compatible with library-delete's Case. */
export class Rec {
  readonly checks: { name: string; kind: string; ok: boolean; detail?: string }[] = [];
  constructor(readonly id: string) {}
  get dir() {
    return `ereader/${this.id}`;
  }
  save(name: string, content: unknown) {
    fs.writeFileSync(evidencePath(this.dir, name), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  check(name: string, ok: boolean, kind = 'feature', detail?: string) {
    this.checks.push({ name, kind, ok, detail });
  }
  finish(): string[] {
    const failed = this.checks.filter((c) => !c.ok);
    this.save('result.json', { case: this.id, image: process.env.E2E_RMAB_IMAGE || '', result: failed.length ? 'FAIL' : 'PASS', checks: this.checks });
    return failed.map((f) => `${f.kind}: ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
  }
}
