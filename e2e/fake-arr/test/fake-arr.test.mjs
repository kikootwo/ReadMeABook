/**
 * Component: E2E fake-arr unit tests (node:test, host-run, real HTTP on ephemeral ports)
 * Documentation: documentation/testing/e2e-harness.md
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startFakeArr } from '../src/server.js';
import { loadConfig } from '../src/state.js';
import { generate } from '../../fixtures/generate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const E2E = path.resolve(HERE, '../..');
// parse-torrent is the exact library RMAB uses to read .torrent files (qbittorrent.service.ts).
const { default: parseTorrent } = await import(pathToFileURL(path.join(E2E, '..', 'node_modules', 'parse-torrent', 'index.js')).href);

let tmp;
let fa;
let cfg;
const KEY = 'test-canary-key';
const TOKEN = 'test-control-token-0123456789';

const base = (svc) => `http://127.0.0.1:${cfg.ports[svc]}`;
const control = (p, body) =>
  fetch(`${base('control')}/__control${p}`, {
    headers: { 'x-control-token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
  }).then((r) => r.json());
const posix = (p) => p.split(path.sep).join('/');

async function loadDef(def) {
  const res = await control('/scenario', { definition: def });
  assert.equal(res.ok, true, JSON.stringify(res));
}

async function qbitLogin() {
  const res = await fetch(`${base('qbit')}/api/v2/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: 'e2e', password: 'pw' }),
  });
  assert.equal(await res.text(), 'Ok.');
  return res.headers.get('set-cookie').split(';')[0];
}

async function search(query = 'Fixture') {
  const res = await fetch(`${base('prowlarr')}/api/v1/search?query=${encodeURIComponent(query)}&type=search`, { headers: { 'X-Api-Key': KEY } });
  assert.equal(res.status, 200);
  return res.json();
}

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-arr-'));
  await generate({
    out: path.join(tmp, 'fixtures'),
    manifest: path.join(E2E, 'fixtures', 'manifest.json'),
    metadata: path.join(E2E, 'fixtures', 'test', 'offline-metadata.json'),
    ffmpeg: process.env.FFMPEG || 'ffmpeg',
  });
  fs.mkdirSync(path.join(tmp, 'downloads'));
  fs.mkdirSync(path.join(tmp, 'media', 'audiobooks'), { recursive: true });
  cfg = loadConfig({
    PROWLARR_API_KEY: KEY,
    QBIT_USER: 'e2e',
    QBIT_PASS: 'pw',
    SAB_API_KEY: 'sabkey',
    PLEX_TOKEN: 'plextoken',
    FIXTURES_DIR: path.join(tmp, 'fixtures'),
    SCENARIOS_DIR: path.join(E2E, 'scenarios'),
    DOWNLOADS_DIR: posix(path.join(tmp, 'downloads')),
    MEDIA_DIR: posix(path.join(tmp, 'media')),
    PUBLIC_HOST: '127.0.0.1',
    TRACKER_HOST: 'localhost',
    PROWLARR_PORT: '0', TRACKER_PORT: '0', QBIT_PORT: '0', SAB_PORT: '0', PLEX_PORT: '0', CONTROL_PORT: '0',
    SCENARIO: 'smoke',
    CONTROL_TOKEN: TOKEN,
  });
  fa = await startFakeArr(cfg);
});

after(async () => {
  await fa?.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('every committed scenario loads against the fixture index', async () => {
  for (const name of await control('/scenarios')) {
    const res = await control('/scenario', { name });
    assert.equal(res.ok, true, `${name}: ${res.error}`);
  }
});

test('prowlarr: key required; results are Prowlarr-shaped with apikey/link/file download URLs', async () => {
  await control('/scenario', { name: 'smoke' });
  assert.equal((await fetch(`${base('prowlarr')}/api/v1/search?query=x`)).status, 401);
  const viaQuery = await fetch(`${base('prowlarr')}/api/v1/indexer?apikey=${KEY}`);
  assert.equal(viaQuery.status, 200);
  const results = await search('Fixture Book One');
  assert.equal(results.length, 2);
  assert.equal((await search('Fixture Book One Test Author')).length, 1);
  const good = results.find((r) => r.title.includes('Unabridged'));
  assert.equal(good.title, 'Test Author - Fixture Book One (Unabridged) [MP3 64kbps]');
  assert.equal(good.size, 420 * 1024 * 1024);
  const u = new URL(good.downloadUrl);
  assert.match(u.pathname, /^\/1\/download$/);
  assert.equal(u.searchParams.get('apikey'), KEY);
  assert.ok(u.searchParams.get('link'));
  assert.equal(u.searchParams.get('file'), 'Fixture Book One');
  assert.equal(good.protocol, 'torrent');
  assert.equal(good.categories[0].id, 3030);
});

test('prowlarr: RSS feed is torznab XML with links', async () => {
  const res = await fetch(`${base('prowlarr')}/1/api?apikey=${KEY}&t=search&cat=3030`);
  const xml = await res.text();
  assert.match(xml, /<rss/);
  assert.match(xml, /torznab:attr name="seeders"/);
  assert.match(xml, /\/1\/download\?apikey=/);
});

test('grab: status sequence repeats its last value, then served torrent parses with the RMAB parser', async () => {
  await loadDef({
    name: 'unit-503',
    book: 'martian',
    releases: [
      { id: 'A', title: '{{author}} - {{title}} [M4B]', fixture: 'martian-m4b', grab: { statuses: [503, 429, 200] } },
      { id: 'B', title: '{{author}} - {{title}} [MP3]', fixture: 'martian-mp3', grab: { statuses: [503] } },
    ],
  });
  const [a, b] = await search('Fixture Book Two');
  const statusesA = [];
  for (let i = 0; i < 4; i++) statusesA.push((await fetch(a.downloadUrl)).status);
  assert.deepEqual(statusesA, [503, 429, 200, 200]);
  for (let i = 0; i < 3; i++) assert.equal((await fetch(b.downloadUrl)).status, 503);
  const body = Buffer.from(await (await fetch(a.downloadUrl)).arrayBuffer());
  const parsed = await parseTorrent(body);
  assert.equal(parsed.infoHash, a.infoHash);
  assert.equal(parsed.name, 'Fixture Book Two');
  assert.equal(parsed.files.length, 1);
  const noKey = new URL(a.downloadUrl);
  noKey.searchParams.delete('apikey');
  assert.equal((await fetch(noKey)).status, 401);
  assert.equal((await fetch(noKey, { headers: { 'X-Api-Key': KEY } })).status, 200);
});

test('redirect knobs: other-port, tracker, relative, magnet at hop 2, direct; recorder keeps listener + headers', async () => {
  await control('/scenario', { name: 'key-scope' });
  const results = await search('Fixture Book One');
  const t = (suffix) => results.find((r) => r.protocol === 'torrent' && r.title.endsWith(` ${suffix}`));

  const other = await fetch(t('other-port').downloadUrl, { redirect: 'manual' });
  assert.equal(other.status, 302);
  assert.equal(other.headers.get('location'), `http://127.0.0.1:${cfg.ports.tracker}/t/t-other-port/0`);

  const tracker = await fetch(t('tracker').downloadUrl, { redirect: 'manual' });
  assert.equal(tracker.headers.get('location'), `http://localhost:${cfg.ports.tracker}/t/t-tracker/0`);

  const rel = await fetch(t('relative').downloadUrl, { redirect: 'manual' });
  assert.equal(rel.headers.get('location'), '/t/t-relative/0');
  const relBody = await fetch(new URL(rel.headers.get('location'), t('relative').downloadUrl));
  assert.equal(relBody.headers.get('content-type'), 'application/x-bittorrent');

  const hop1 = await fetch(t('magnet-hop2').downloadUrl, { redirect: 'manual' });
  const hop2 = await fetch(hop1.headers.get('location'), { redirect: 'manual' });
  assert.equal(hop2.status, 302);
  assert.match(hop2.headers.get('location'), /^magnet:\?xt=urn:btih:[0-9a-f]{40}/);

  const direct = t('direct').downloadUrl;
  assert.equal(new URL(direct).port, String(cfg.ports.tracker));
  assert.equal(new URL(direct).searchParams.get('apikey'), null);
  assert.equal((await fetch(direct, { headers: { 'X-Api-Key': KEY } })).status, 200);

  // Following a chain with fetch() forwards custom headers across origins: the recorder must show it.
  await fetch(t('tracker').downloadUrl, { headers: { 'X-Api-Key': KEY } });
  const records = await control('/requests');
  const trackerHits = records.filter((r) => r.listener === cfg.ports.tracker && r.path.startsWith('/t/t-tracker/'));
  assert.ok(trackerHits.length >= 1);
  assert.equal(trackerHits.at(-1).headers['x-api-key'], KEY);
  assert.equal(trackerHits.at(-1).service, 'tracker');
  const usenet = results.filter((r) => r.protocol === 'usenet');
  assert.equal(usenet.length, 4);
});

test('qbit: auth, category, multipart add, progress with non-zero dlspeed, completion drops files, delete', async () => {
  await loadDef({ name: 'unit-qbit', book: 'phm', releases: [{ id: 'q', title: '{{title}} [MP3]', fixture: 'phm-mp3', download: { completeMs: 600 } }] });
  assert.equal((await fetch(`${base('qbit')}/api/v2/torrents/info`)).status, 403);
  const cookie = await qbitLogin();
  const h = { Cookie: cookie };
  const form = (o) => ({ method: 'POST', headers: { ...h, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
  await fetch(`${base('qbit')}/api/v2/torrents/createCategory`, form({ category: 'readmeabook', savePath: cfg.downloadsDir }));
  const cats = await fetch(`${base('qbit')}/api/v2/torrents/categories`, { headers: h }).then((r) => r.json());
  assert.equal(cats.readmeabook.savePath, cfg.downloadsDir);
  assert.equal(await fetch(`${base('qbit')}/api/v2/app/version`, { headers: h }).then((r) => r.text()), 'v4.6.5');

  const [rel] = await search('Fixture Book One');
  const torrent = Buffer.from(await (await fetch(rel.downloadUrl)).arrayBuffer());
  const fd = new FormData();
  fd.append('torrents', new Blob([torrent], { type: 'application/x-bittorrent' }), 'x.torrent');
  fd.append('category', 'readmeabook');
  fd.append('paused', 'false');
  assert.equal(await fetch(`${base('qbit')}/api/v2/torrents/add`, { method: 'POST', headers: h, body: fd }).then((r) => r.text()), 'Ok.');

  const info = async () => (await fetch(`${base('qbit')}/api/v2/torrents/info?hashes=${rel.infoHash}`, { headers: h }).then((r) => r.json()))[0];
  const first = await info();
  assert.equal(first.state, 'downloading');
  assert.ok(first.dlspeed > 0);
  assert.equal(first.content_path, `${cfg.downloadsDir}/Fixture Book One`);
  const done = await waitFor(async () => {
    const t = await info();
    return t.state === 'uploading' ? t : null;
  });
  assert.equal(done.progress, 1);
  assert.ok(done.completion_on > 0);
  assert.ok(fs.existsSync(path.join(done.content_path, '01 - Chapter 1.mp3')));
  const files = await fetch(`${base('qbit')}/api/v2/torrents/files?hash=${rel.infoHash}`, { headers: h }).then((r) => r.json());
  assert.equal(files.length, 3);

  const st = await control('/state');
  assert.equal(st.torrents[0].releaseId, 'q');
  await fetch(`${base('qbit')}/api/v2/torrents/delete`, form({ hashes: rel.infoHash, deleteFiles: 'true' }));
  assert.equal((await fetch(`${base('qbit')}/api/v2/torrents/info`, { headers: h }).then((r) => r.json())).length, 0);
  assert.equal(fs.existsSync(done.content_path), false);
});

test('qbit: magnet add, stall knob holds progress at 0 B/s, fail knob reports error', async () => {
  await loadDef({
    name: 'unit-knobs',
    book: 'phm',
    releases: [
      { id: 'm', link: 'magnet', title: '{{title}} magnet', fixture: 'phm-mp3', download: { completeMs: 200, stallAtPct: 50 } },
      { id: 'f', title: '{{title}} fail', fixture: 'phm-mp3', download: { completeMs: 200, failAtPct: 30 } },
    ],
  });
  const results = await search('Fixture');
  const magnet = results.find((r) => r.magnetUrl);
  assert.equal(magnet.downloadUrl, undefined);
  const cookie = await qbitLogin();
  const add = (o) => fetch(`${base('qbit')}/api/v2/torrents/add`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) }).then((r) => r.text());
  assert.equal(await add({ urls: magnet.magnetUrl, category: 'readmeabook' }), 'Ok.');
  const failing = results.find((r) => r.title.endsWith('fail'));
  assert.equal(await add({ urls: `magnet:?xt=urn:btih:${failing.infoHash}` }), 'Ok.');
  await new Promise((r) => setTimeout(r, 300));
  const list = await fetch(`${base('qbit')}/api/v2/torrents/info`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const stalled = list.find((t) => t.hash === magnet.infoHash);
  assert.equal(stalled.state, 'stalledDL');
  assert.equal(stalled.progress, 0.5);
  assert.equal(stalled.dlspeed, 0);
  assert.equal(list.find((t) => t.hash === failing.infoHash).state, 'error');
});

test('sab: config, set_config category, addfile, queue then history with storage + files', async () => {
  await loadDef({ name: 'unit-sab', book: 'phm', indexers: [{ id: 2, name: 'U', protocol: 'usenet' }], releases: [{ id: 'n', protocol: 'usenet', indexerId: 2, title: '{{title}} nzb', fixture: 'phm-m4b', download: { completeMs: 400 } }] });
  const api = (q) => fetch(`${base('sab')}/api?${new URLSearchParams({ output: 'json', apikey: 'sabkey', ...q })}`).then((r) => r.json());
  assert.equal((await fetch(`${base('sab')}/api?mode=version&apikey=bad`).then((r) => r.json())).status, false);
  assert.equal((await api({ mode: 'version' })).version, '4.3.3');
  await api({ mode: 'set_config', section: 'categories', keyword: 'readmeabook', dir: 'readmeabook' });
  const conf = await api({ mode: 'get_config' });
  assert.equal(conf.config.misc.complete_dir, cfg.downloadsDir);
  assert.ok(Array.isArray(conf.config.categories));
  const [rel] = await search('Fixture');
  const nzb = Buffer.from(await (await fetch(rel.downloadUrl)).arrayBuffer());
  const fd = new FormData();
  fd.append('nzbfile', new Blob([nzb], { type: 'application/x-nzb' }), 'x.nzb');
  for (const [k, v] of Object.entries({ mode: 'addfile', cat: 'readmeabook', output: 'json', apikey: 'sabkey' })) fd.append(k, v);
  const added = await fetch(`${base('sab')}/api`, { method: 'POST', body: fd }).then((r) => r.json());
  assert.equal(added.status, true);
  const id = added.nzo_ids[0];
  const q = await api({ mode: 'queue' });
  assert.equal(q.queue.slots[0].nzo_id, id);
  const slot = await waitFor(async () => (await api({ mode: 'history' })).history.slots.find((s) => s.nzo_id === id));
  assert.equal(slot.status, 'Completed');
  assert.equal(slot.storage, `${cfg.downloadsDir}/readmeabook/Fixture Book One`);
  assert.ok(fs.existsSync(path.join(slot.storage, 'Fixture Book One.m4b')));
  await api({ mode: 'history', name: 'delete', value: id });
  assert.equal((await api({ mode: 'history' })).history.slots.length, 0);
});

test('sab: a release with sabStorageDir lands there regardless of its category', async () => {
  await loadDef({ name: 'unit-sab-dir', book: 'phm', indexers: [{ id: 2, name: 'U', protocol: 'usenet' }], releases: [{ id: 'n', protocol: 'usenet', indexerId: 2, title: '{{title}} nzb', fixture: 'phm-m4b', sabStorageDir: 'sorted/deeper', download: { completeMs: 300 } }] });
  const api = (q) => fetch(`${base('sab')}/api?${new URLSearchParams({ output: 'json', apikey: 'sabkey', ...q })}`).then((r) => r.json());
  await api({ mode: 'set_config', section: 'categories', keyword: 'readmeabook', dir: 'readmeabook' });
  const [rel] = await search('Fixture');
  const nzb = Buffer.from(await (await fetch(rel.downloadUrl)).arrayBuffer());
  const fd = new FormData();
  fd.append('nzbfile', new Blob([nzb], { type: 'application/x-nzb' }), 'x.nzb');
  for (const [k, v] of Object.entries({ mode: 'addfile', cat: 'readmeabook', output: 'json', apikey: 'sabkey' })) fd.append(k, v);
  const id = (await fetch(`${base('sab')}/api`, { method: 'POST', body: fd }).then((r) => r.json())).nzo_ids[0];
  const slot = await waitFor(async () => (await api({ mode: 'history' })).history.slots.find((s) => s.nzo_id === id));
  assert.equal(slot.storage, `${cfg.downloadsDir}/sorted/deeper/Fixture Book One`);
  assert.ok(fs.existsSync(path.join(slot.storage, 'Fixture Book One.m4b')));
  await api({ mode: 'history', name: 'delete', value: id });
});

test('plex: identity, sections, library listing from the media volume, refresh counter', async () => {
  const hdr = { 'X-Plex-Token': 'plextoken', Accept: 'application/json' };
  assert.equal((await fetch(`${base('plex')}/identity`)).status, 401);
  const id = await fetch(`${base('plex')}/identity`, { headers: hdr }).then((r) => r.json());
  assert.ok(id.MediaContainer.machineIdentifier);
  const sections = await fetch(`${base('plex')}/library/sections`, { headers: hdr }).then((r) => r.json());
  assert.equal(sections.MediaContainer.Directory[0].Location[0].path, `${cfg.mediaDir}/audiobooks`);
  fs.mkdirSync(path.join(tmp, 'media', 'audiobooks', 'Test Author', 'Fixture Book One'), { recursive: true });
  const all = await fetch(`${base('plex')}/library/sections/1/all?type=9`, { headers: hdr }).then((r) => r.json());
  assert.equal(all.MediaContainer.Metadata[0].title, 'Fixture Book One');
  assert.equal(all.MediaContainer.Metadata[0].parentTitle, 'Test Author');
  fs.mkdirSync(path.join(tmp, 'media', 'audiobooks', 'Test Author', 'Fixture Book Two B082BHJMFF'), { recursive: true });
  const lib = await control('/plex-library');
  const two = lib.albums.find((a) => a.title === 'Fixture Book Two');
  assert.equal(two.guid, 'com.plexapp.agents.audible://B082BHJMFF?lang=en');
  await fetch(`${base('plex')}/library/sections/1/refresh`, { headers: hdr });
  assert.equal((await control('/state')).plexRefreshes, 1);
});

test('control API: token required (except /health); wrong token rejected', async () => {
  assert.equal((await fetch(`${base('control')}/__control/health`)).status, 200);
  assert.equal((await fetch(`${base('control')}/__control/requests`)).status, 401);
  assert.equal((await fetch(`${base('control')}/__control/state`, { headers: { 'x-control-token': 'wrong-token-but-long-enough' } })).status, 401);
  assert.equal((await fetch(`${base('control')}/__control/scenario`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"smoke"}' })).status, 401);
});

test('releases sharing a fixture get distinct info-hashes and NZBs', async () => {
  await loadDef({
    name: 'unit-shared',
    book: 'phm',
    indexers: [{ id: 1, name: 'T', protocol: 'torrent' }, { id: 2, name: 'U', protocol: 'usenet' }],
    releases: [
      { id: 't1', title: '{{title}} one', fixture: 'phm-mp3' },
      { id: 't2', title: '{{title}} two', fixture: 'phm-mp3' },
      { id: 'n1', protocol: 'usenet', indexerId: 2, title: '{{title}} nzb one', fixture: 'phm-mp3' },
      { id: 'n2', protocol: 'usenet', indexerId: 2, title: '{{title}} nzb two', fixture: 'phm-mp3' },
    ],
  });
  const st = await control('/state');
  const hashes = st.releases.filter((r) => r.protocol === 'torrent').map((r) => r.infoHash);
  assert.equal(new Set(hashes).size, 2);
  const results = await search('Fixture Book One');
  const nzbs = await Promise.all(results.filter((r) => r.protocol === 'usenet').map(async (r) => Buffer.from(await (await fetch(r.downloadUrl)).arrayBuffer()).toString()));
  assert.equal(nzbs.length, 2);
  assert.notEqual(nzbs[0], nzbs[1]);
});

test('scenario switch keeps the recorder, qBit sessions/categories and in-flight torrents', async () => {
  await control('/reset');
  const cookie = await qbitLogin();
  await fetch(`${base('qbit')}/api/v2/torrents/createCategory`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ category: 'keep', savePath: '/x' }) });
  const before = (await control('/requests')).length;
  assert.ok(before >= 2);
  await control('/scenario', { name: 'smoke' });
  assert.ok((await control('/requests')).length >= before);
  const cats = await fetch(`${base('qbit')}/api/v2/torrents/categories`, { headers: { Cookie: cookie } });
  assert.equal(cats.status, 200, 'session survived the scenario switch');
  assert.ok((await cats.json()).keep);
});

test('qbit: a finished torrent that is paused reports pausedUP at 100%', async () => {
  await loadDef({ name: 'unit-pause', book: 'phm', releases: [{ id: 'p', title: '{{title}} pause', fixture: 'phm-mp3', download: { completeMs: 100 } }] });
  const cookie = await qbitLogin();
  const [rel] = await search('Fixture Book One');
  const form = (o) => ({ method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o) });
  await fetch(`${base('qbit')}/api/v2/torrents/add`, form({ urls: rel.magnetUrl || `magnet:?xt=urn:btih:${rel.infoHash}` }));
  const info = async () => (await fetch(`${base('qbit')}/api/v2/torrents/info?hashes=${rel.infoHash}`, { headers: { Cookie: cookie } }).then((r) => r.json()))[0];
  await waitFor(async () => (await info()).state === 'uploading');
  await fetch(`${base('qbit')}/api/v2/torrents/pause`, form({ hashes: rel.infoHash }));
  const paused = await info();
  assert.equal(paused.state, 'pausedUP');
  assert.equal(paused.progress, 1);
});

test('sab: mode=pause is a global queue pause; queue&name=pause pauses one job', async () => {
  await loadDef({ name: 'unit-sabpause', book: 'phm', indexers: [{ id: 2, name: 'U', protocol: 'usenet' }], releases: [
    { id: 'a', protocol: 'usenet', indexerId: 2, title: '{{title}} a', fixture: 'phm-mp3', download: { completeMs: 60000 } },
    { id: 'b', protocol: 'usenet', indexerId: 2, title: '{{title}} b', fixture: 'phm-mp3', download: { completeMs: 60000 } },
  ] });
  const api = (q) => fetch(`${base('sab')}/api?${new URLSearchParams({ output: 'json', apikey: 'sabkey', ...q })}`).then((r) => r.json());
  const ids = [];
  for (const rel of await search('Fixture Book One')) {
    const fd = new FormData();
    fd.append('nzbfile', new Blob([Buffer.from(await (await fetch(rel.downloadUrl)).arrayBuffer())]), 'x.nzb');
    for (const [k, v] of Object.entries({ mode: 'addfile', cat: 'readmeabook', output: 'json', apikey: 'sabkey' })) fd.append(k, v);
    ids.push((await fetch(`${base('sab')}/api`, { method: 'POST', body: fd }).then((r) => r.json())).nzo_ids[0]);
  }
  await api({ mode: 'queue', name: 'pause', value: ids[0] });
  let q = (await api({ mode: 'queue' })).queue;
  assert.equal(q.paused, false);
  assert.deepEqual(q.slots.map((s) => s.status).sort(), ['Downloading', 'Paused']);
  await api({ mode: 'pause', value: ids[1] }); // value ignored: whole queue
  q = (await api({ mode: 'queue' })).queue;
  assert.equal(q.paused, true);
  assert.deepEqual(q.slots.map((s) => s.status), ['Paused', 'Paused']);
  await api({ mode: 'resume' });
  q = (await api({ mode: 'queue' })).queue;
  assert.deepEqual(q.slots.map((s) => s.status).sort(), ['Downloading', 'Paused'], 'per-job pause survives a global resume');
});

test('prowlarr search honours categories, limit and type', async () => {
  await loadDef({ name: 'unit-filters', book: 'phm', releases: [
    { id: 'a1', title: '{{title}} a1', fixture: 'phm-mp3' },
    { id: 'a2', title: '{{title}} a2', fixture: 'phm-mp3' },
    { id: 'e1', title: '{{title}} e1', fixture: 'phm-mp3', categories: [7020] },
  ] });
  const q = (extra) => fetch(`${base('prowlarr')}/api/v1/search?query=Fixture&${extra}`, { headers: { 'X-Api-Key': KEY } });
  assert.equal((await (await q('type=search&categories=3030')).json()).length, 2);
  assert.equal((await (await q('type=search&categories=7020')).json()).length, 1);
  assert.equal((await (await q('type=search&categories=3030&categories=7020&limit=2')).json()).length, 2);
  assert.equal((await q('type=nonsense')).status, 400);
});
