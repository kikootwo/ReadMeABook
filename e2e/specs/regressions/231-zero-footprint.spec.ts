/**
 * Component: E2E regression #231 PR 2 (the Discord bot leaves no footprint until configured)
 * Documentation: documentation/testing/e2e-harness.md
 *
 * Default flags; exec bridge (psql, RMAB logs). fake-arr's :443 sinkhole records every connection to
 * discord.com, gateway.discord.gg, cdn.discordapp.com and discordapp.com (stack aliases).
 *   A  bot never configured: a user's requests are approved (dashboard card), approved (API), denied,
 *      cancelled (PATCH and POST /cancel) and deleted by the admin; the Users page shows no Discord
 *      field. Then: 0 sinkhole records, `Discord bot not started` logged once (0 on an image without
 *      the bot) and no other Discord line, no discord_user_id set. Answers saved for the main comparison.
 *   B  positive control (skipped without the bot): enable with a fake token and server ID through the
 *      settings API; the sinkhole sees discord.com, the bot reports `failed`, `Failed to start the
 *      Discord bot` is logged, web approve still works, the Users page shows the field. Disable: no new
 *      records. With the token saved and the bot off, opening Settings → Discord makes 0 records.
 */

import { test, expect } from '@playwright/test';
import { execBridgeAvailable, EXEC_BRIDGE_SKIP, Rmab, writeEvidence } from '../../lib/harness';
import { psql, sqlStr } from './242-helpers';
import { viewer } from './177-library-page-helpers';
import {
  DIR, SETTINGS, FAKE_TOKEN, TOKEN_MASK, VIEWPORTS, adminPage, answer, discordLogLines, dropSeeded, lastSeq,
  openDiscordTab, openUserDialog, saveDiscord, seedRequest, settle, sinkholeRecords,
} from './231-footprint-helpers';

test.skip(!execBridgeAvailable(), EXEC_BRIDGE_SKIP);
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const READER = `d231f${stamp}`;
const GUILD_ID = '123456789012345678';
const LINKED_ID = '223456789012345678';
let hasBot = false;
let readerId = '';

test('231 A: bot never configured: no Discord connection, one log line, web flows unchanged', async ({ browser }) => {
  const admin = await Rmab.loginAdmin();
  const result: Record<string, unknown> = {};
  const books: string[] = [];
  try {
    const reader = await viewer(admin, READER);
    readerId = reader.id;
    const asReader = new Rmab(reader.accessToken);
    const seed = (label: string, status: string, futureRelease = false) => {
      const s = seedRequest(reader.id, label, status, { futureRelease });
      books.push(s.bookId);
      return s;
    };
    const approveUi = seed('A1', 'awaiting_approval', true);
    const approveApi = seed('A2', 'awaiting_approval', true);
    const deny = seed('D1', 'awaiting_approval');
    const cancelPatch = seed('C1', 'awaiting_search');
    const cancelPost = seed('C2', 'awaiting_search');
    const del = seed('X1', 'awaiting_search');

    const answers: Record<string, unknown> = {};
    {
      const { ctx, page } = await adminPage(browser, VIEWPORTS[0]);
      await page.goto('/admin');
      const card = page.locator('div.relative', { has: page.getByRole('heading', { name: approveUi.title, exact: true }) });
      await expect(card).toBeVisible({ timeout: 30_000 });
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().endsWith(`/api/admin/requests/${approveUi.requestId}/approve`)),
        card.getByRole('button', { name: 'Approve' }).click(),
      ]);
      answers.approveUi = { status: res.status(), requestStatus: (await res.json().catch(() => null))?.request?.status ?? null };
      await ctx.close();
    }
    answers.approveApi = await answer(await admin.raw('POST', `/api/admin/requests/${approveApi.requestId}/approve`, { action: 'approve' }));
    answers.deny = await answer(await admin.raw('POST', `/api/admin/requests/${deny.requestId}/approve`, { action: 'deny' }));
    answers.denyAgain = await answer(await admin.raw('POST', `/api/admin/requests/${deny.requestId}/approve`, { action: 'deny' }));
    answers.cancelPatch = await answer(await asReader.raw('PATCH', `/api/requests/${cancelPatch.requestId}`, { action: 'cancel' }));
    answers.cancelPost = await answer(await asReader.raw('POST', `/api/requests/${cancelPost.requestId}/cancel`));
    answers.deleteByAdmin = await answer(await admin.raw('DELETE', `/api/admin/requests/${del.requestId}`));
    answers.deleteAgain = await answer(await admin.raw('DELETE', `/api/admin/requests/${del.requestId}`));
    const ids = [approveUi, approveApi, deny, cancelPatch, cancelPost, del].map((s) => sqlStr(s.requestId)).join(', ');
    answers.rows = psql(`select concat_ws('|', a.title, r.status, (r.deleted_at is not null)::text) from requests r join audiobooks a on a.id = r.audiobook_id where r.id in (${ids}) order by a.title`).split('\n');
    result.answers = answers;

    // Users page: no Discord field while the bot is not configured
    const dialogs: Record<string, unknown> = {};
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await adminPage(browser, vp);
      dialogs[vp.name] = await openUserDialog(page, READER, `unconfigured-${vp.name}`);
      await ctx.close();
    }
    result.usersPage = dialogs;

    hasBot = (await admin.raw('GET', SETTINGS)).status === 200;
    result.hasBot = hasBot;
    await new Promise((r) => setTimeout(r, 5_000));
    result.sinkhole = await sinkholeRecords();
    result.discordLog = discordLogLines();
    result.linkedUsers = psql('select count(*) from users where discord_user_id is not null');
  } finally {
    writeEvidence(`${DIR}/run-a.json`, result);
    dropSeeded(books);
  }

  expect(result.sinkhole, 'no Discord connection attempt').toEqual([]);
  const log = result.discordLog as string[];
  const notStarted = log.filter((l) => l.includes('Discord bot not started'));
  expect(notStarted.length, '`Discord bot not started` once (none without the bot)').toBe(hasBot ? 1 : 0);
  if (hasBot) expect(notStarted[0]).toContain('[Discord.Bot]');
  expect(log.filter((l) => !l.includes('Discord bot not started')), 'no other Discord log line').toEqual([]);
  expect(result.linkedUsers, 'discord_user_id all NULL').toBe('0');
  for (const vp of VIEWPORTS) expect((result.usersPage as any)[vp.name].hasField, `${vp.name}: no Discord field`).toBe(false);
});

test('231 B: enabled with a fake token: the sinkhole sees discord.com; disabled: silent again', async ({ browser }) => {
  test.skip(!hasBot, 'image without the Discord bot (main)');
  const admin = await Rmab.loginAdmin();
  const result: Record<string, unknown> = {};
  const books: string[] = [];
  try {
    const before = await lastSeq();
    result.enable = await saveDiscord(admin, { enabled: true, botToken: FAKE_TOKEN, guildId: GUILD_ID });
    const deadline = Date.now() + 120_000;
    let status: any = null;
    while (Date.now() < deadline) {
      status = (await admin.get(SETTINGS)).status;
      if (status?.state === 'failed') break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    result.statusAfterEnable = status;
    result.enabledGet = await admin.get(SETTINGS);
    result.sinkholeEnabled = await sinkholeRecords(before);
    result.discordLogEnabled = discordLogLines();
    result.tokenStored = psql(`select concat_ws('|', encrypted::text, (value = ${sqlStr(FAKE_TOKEN)})::text) from configuration where key = 'discord.bot_token'`);

    // Web approve still works while the bot is failing
    const approve = seedRequest(readerId, 'B1', 'awaiting_approval', { futureRelease: true });
    books.push(approve.bookId);
    result.approveWhileEnabled = await answer(await admin.raw('POST', `/api/admin/requests/${approve.requestId}/approve`, { action: 'approve' }));

    // Users page with the bot configured: the field and the linked ID line
    result.link = (await admin.raw('PUT', `/api/admin/users/${readerId}/discord`, { discordUserId: LINKED_ID })).status;
    const dialogs: Record<string, unknown> = {};
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await adminPage(browser, vp);
      dialogs[vp.name] = await openUserDialog(page, READER, `configured-${vp.name}`);
      await ctx.close();
    }
    result.usersPage = dialogs;
    {
      const { ctx, page } = await adminPage(browser, VIEWPORTS[0]);
      result.tabFailed = await openDiscordTab(page, 'failed-1280-light');
      await ctx.close();
    }

    // Disable (token kept): nothing new reaches the sinkhole
    result.disable = await saveDiscord(admin, { enabled: false, botToken: TOKEN_MASK, guildId: GUILD_ID });
    await new Promise((r) => setTimeout(r, 3_000));
    const afterDisable = await lastSeq();
    await new Promise((r) => setTimeout(r, 15_000));
    result.sinkholeAfterDisable = await sinkholeRecords(afterDisable);
    result.statusAfterDisable = (await admin.get(SETTINGS)).status;

    // Settings → Discord with the token saved and the bot off: opening the tab contacts no one
    const beforeTab = await lastSeq();
    const tabs: Record<string, unknown> = {};
    for (const vp of VIEWPORTS) {
      const { ctx, page } = await adminPage(browser, vp);
      tabs[vp.name] = await openDiscordTab(page, `saved-off-${vp.name}`);
      await settle(page);
      await ctx.close();
    }
    result.tabSavedOff = tabs;
    await new Promise((r) => setTimeout(r, 5_000));
    result.sinkholeTabOpen = await sinkholeRecords(beforeTab);
  } finally {
    result.cleanup = {
      unlink: readerId ? (await admin.raw('PUT', `/api/admin/users/${readerId}/discord`, { discordUserId: null })).status : null,
      settings: (await saveDiscord(admin, {})).status,
    };
    writeEvidence(`${DIR}/run-b.json`, result);
    dropSeeded(books);
  }

  expect(result.enable).toMatchObject({ status: 200 });
  expect((result.sinkholeEnabled as { host: string }[]).some((r) => r.host === 'discord.com'), 'sinkhole saw discord.com').toBe(true);
  expect(result.statusAfterEnable).toMatchObject({ state: 'failed' });
  expect((result.discordLogEnabled as string[]).some((l) => l.includes('Failed to start the Discord bot'))).toBe(true);
  expect((result.discordLogEnabled as string[]).join('\n'), 'token never logged').not.toContain(FAKE_TOKEN);
  expect(result.tokenStored, 'token stored encrypted').toBe('true|false');
  expect((result.enabledGet as any).settings.botToken).toBe(TOKEN_MASK);
  expect(result.approveWhileEnabled).toMatchObject({ status: 200, requestStatus: 'awaiting_release' });
  expect(result.link).toBe(200);
  for (const vp of VIEWPORTS) {
    expect((result.usersPage as any)[vp.name].hasField, `${vp.name}: Discord field shown`).toBe(true);
  }
  expect(result.disable).toMatchObject({ status: 200 });
  expect(result.sinkholeAfterDisable, 'no record after disable').toEqual([]);
  expect(result.statusAfterDisable).toMatchObject({ state: 'stopped' });
  for (const vp of VIEWPORTS) expect((result.tabSavedOff as any)[vp.name]).toEqual({ enabled: 'false', token: TOKEN_MASK });
  expect(result.sinkholeTabOpen, 'opening Settings → Discord makes no Discord connection').toEqual([]);
  expect(result.cleanup).toEqual({ unlink: 200, settings: 200 });
});
